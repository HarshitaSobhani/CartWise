import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncH, HttpError, parse, requireAdmin, requireAuth } from '../http.js';
import { parsePricesCsv, parseProductsCsv, MAX_CSV_BYTES } from '../lib/csv.js';
import { createRefreshJob, MAX_ATTEMPTS } from '../services/jobs.js';
import { enqueueJob, queueStats } from '../queue.js';
import { config } from '../config.js';
import { getAdapter } from '../adapters/registry.js';
import { randomUUID } from 'node:crypto';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

const importBody = z.object({ type: z.enum(['CSV_PRODUCTS', 'CSV_PRICES']), filename: z.string().trim().min(1).max(200), csv: z.string().min(1).max(MAX_CSV_BYTES) });

/** Dry-run: validates and previews rows; writes nothing. */
adminRouter.post('/imports/preview', asyncH(async (req, res) => {
  const b = parse(importBody, req.body);
  const r = b.type === 'CSV_PRODUCTS' ? parseProductsCsv(b.csv) : parsePricesCsv(b.csv);
  const preview = r.rows.slice(0, 20).map((x) => {
    const d = JSON.parse(JSON.stringify(x.data)) as Record<string, unknown>;
    if ('price' in x.data) d.price = (x.data as { price: { toFixed(n: number): string } }).price.toFixed(2);
    return { line: x.line, ...d };
  });
  res.json({ type: b.type, totalRows: r.totalRows, validRows: r.rows.length, errorRows: r.errors.length, fatal: r.fatal ?? null, errors: r.errors.slice(0, 100), preview });
}));

adminRouter.post('/imports', asyncH(async (req, res) => {
  const b = parse(importBody, req.body);
  const r = b.type === 'CSV_PRODUCTS' ? parseProductsCsv(b.csv) : parsePricesCsv(b.csv);
  if (r.fatal) throw new HttpError(400, r.fatal);
  const imp = await prisma.import.create({ data: { userId: req.user!.id, type: b.type, filename: b.filename, payload: b.csv, totalRows: r.totalRows } });
  const job = await prisma.backgroundJob.create({ data: { type: b.type, importId: imp.id, idempotencyKey: `import:${imp.id}`, maxAttempts: MAX_ATTEMPTS } });
  await enqueueJob(job.id, job.idempotencyKey);
  res.status(202).json({ import: { id: imp.id, status: imp.status }, jobId: job.id });
}));

adminRouter.get('/imports', asyncH(async (_req, res) => {
  const rows = await prisma.import.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { user: { select: { email: true } }, jobs: { select: { id: true, status: true, attempts: true, maxAttempts: true, lastError: true } } } });
  res.json({ imports: rows.map((i) => ({ id: i.id, type: i.type, filename: i.filename, status: i.status, totalRows: i.totalRows, okRows: i.okRows, errorRows: i.errorRows, errors: i.errors, createdAt: i.createdAt.toISOString(), finishedAt: i.finishedAt?.toISOString() ?? null, by: i.user.email, job: i.jobs[0] ?? null })) });
}));

adminRouter.get('/jobs', asyncH(async (req, res) => {
  const q = parse(z.object({ status: z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED']).optional() }), req.query);
  const rows = await prisma.backgroundJob.findMany({ where: q.status ? { status: q.status } : {}, orderBy: { createdAt: 'desc' }, take: 100, include: { source: { select: { name: true } } } });
  res.json({ queue: await queueStats(), jobs: rows.map((j) => ({ id: j.id, type: j.type, status: j.status, attempts: j.attempts, maxAttempts: j.maxAttempts, lastError: j.lastError, result: j.result, source: j.source?.name ?? null, createdAt: j.createdAt.toISOString(), finishedAt: j.finishedAt?.toISOString() ?? null })) });
}));

adminRouter.post('/jobs/:id/retry', asyncH(async (req, res) => {
  const job = await prisma.backgroundJob.findUnique({ where: { id: req.params.id } });
  if (!job) throw new HttpError(404, 'Job not found');
  if (job.status !== 'FAILED') throw new HttpError(409, 'Only failed jobs can be retried');
  await prisma.backgroundJob.update({ where: { id: job.id }, data: { status: 'QUEUED', attempts: 0, lastError: null, finishedAt: null } });
  if (job.importId) await prisma.import.update({ where: { id: job.importId }, data: { status: 'QUEUED', finishedAt: null } });
  await enqueueJob(job.id, job.idempotencyKey);
  res.status(202).json({ ok: true });
}));

adminRouter.get('/sources', asyncH(async (_req, res) => {
  const rows = await prisma.source.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { products: true, observations: true } } } });
  res.json({ sources: rows.map((s) => ({ id: s.id, slug: s.slug, name: s.name, kind: s.kind, isDemo: s.isDemo, enabled: s.enabled, lastSyncedAt: s.lastSyncedAt?.toISOString() ?? null, hasAdapter: Boolean(getAdapter(s.slug)), products: s._count.products, observations: s._count.observations })) });
}));

adminRouter.patch('/sources/:id', asyncH(async (req, res) => {
  const b = parse(z.object({ enabled: z.boolean() }).strict(), req.body);
  const r = await prisma.source.updateMany({ where: { id: req.params.id }, data: b });
  if (!r.count) throw new HttpError(404, 'Source not found');
  res.status(204).end();
}));

/** Manual refresh. Uses a unique bucket so an admin can force a run; observations still dedupe. */
adminRouter.post('/sources/:id/refresh', asyncH(async (req, res) => {
  const s = await prisma.source.findUnique({ where: { id: req.params.id } });
  if (!s) throw new HttpError(404, 'Source not found');
  if (!getAdapter(s.slug)) throw new HttpError(400, 'This source has no refresh adapter (CSV sources are updated by import)');
  const { job } = await createRefreshJob(prisma, s.id, `manual-${randomUUID()}`);
  await enqueueJob(job.id, job.idempotencyKey);
  res.status(202).json({ jobId: job.id });
}));

adminRouter.get('/data-quality', asyncH(async (_req, res) => {
  const staleCutoff = new Date(Date.now() - config.STALE_AFTER_HOURS * 3_600_000);
  const products = await prisma.product.findMany({ select: { id: true, name: true, source: { select: { name: true, isDemo: true } }, observations: { select: { currency: true, observedAt: true, origin: true } } } });
  const noData = products.filter((p) => p.observations.length === 0).map((p) => ({ id: p.id, name: p.name, source: p.source.name }));
  const stale = products
    .filter((p) => p.observations.length > 0)
    .map((p) => ({ p, last: p.observations.reduce((m, o) => (o.observedAt > m ? o.observedAt : m), new Date(0)) }))
    .filter((x) => x.last < staleCutoff)
    .map((x) => ({ id: x.p.id, name: x.p.name, source: x.p.source.name, lastObservedAt: x.last.toISOString() }));
  const mixedCurrency = products.filter((p) => new Set(p.observations.map((o) => o.currency)).size > 1).map((p) => ({ id: p.id, name: p.name, currencies: [...new Set(p.observations.map((o) => o.currency))] }));
  const noIdentifiers = await prisma.product.findMany({ where: { identifiers: { none: {} } }, select: { id: true, name: true }, take: 100 });
  const failedImports = await prisma.import.findMany({ where: { OR: [{ status: 'FAILED' }, { errorRows: { gt: 0 } }] }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, filename: true, status: true, errorRows: true } });
  res.json({ staleAfterHours: config.STALE_AFTER_HOURS, noData, stale, mixedCurrency, noIdentifiers, failedImports });
}));

adminRouter.get('/overview', asyncH(async (_req, res) => {
  const [users, products, observations, failedJobs, runningJobs] = await Promise.all([prisma.user.count(), prisma.product.count(), prisma.priceObservation.count(), prisma.backgroundJob.count({ where: { status: 'FAILED' } }), prisma.backgroundJob.count({ where: { status: { in: ['QUEUED', 'RUNNING'] } } })]);
  res.json({ users, products, observations, failedJobs, pendingJobs: runningJobs, queue: await queueStats() });
}));
