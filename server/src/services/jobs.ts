import type { Prisma, PrismaClient, JobType } from '@prisma/client';
import { logger, safeErrorMessage } from '../logger.js';
import { parsePricesCsv, parseProductsCsv, MAX_STORED_ERRORS, type RowError } from '../lib/csv.js';
import { getAdapter } from '../adapters/registry.js';
import { ingestObservations, type NewObservation } from './observations.js';
import { evaluateAlerts } from './alerts.js';
import type { Mailer } from './mail.js';

export const MAX_ATTEMPTS = 3;
/** Exponential backoff in ms for the n-th retry (1-based): 5s, 10s, 20s ... capped at 5 min. */
export const backoffMs = (attempt: number) => Math.min(5_000 * 2 ** (attempt - 1), 300_000);

export const CSV_SOURCE_SLUG = 'csv-import';

export interface JobDeps {
  db: PrismaClient;
  mailer?: Mailer | null;
  now?: () => Date;
}

export class PermanentJobError extends Error {}

async function ensureCsvSource(db: PrismaClient) {
  return db.source.upsert({
    where: { slug: CSV_SOURCE_SLUG },
    update: {},
    create: { slug: CSV_SOURCE_SLUG, name: 'CSV imports (user supplied)', kind: 'CSV', isDemo: false },
  });
}

async function runProductsImport(deps: JobDeps, importId: string) {
  const imp = await deps.db.import.findUniqueOrThrow({ where: { id: importId } });
  const parsed = parseProductsCsv(imp.payload ?? '');
  if (parsed.fatal) throw new PermanentJobError(parsed.fatal);
  const source = await ensureCsvSource(deps.db);
  let ok = 0;
  const errors: RowError[] = [...parsed.errors];
  for (const { line, data } of parsed.rows) {
    try {
      await deps.db.$transaction(async (tx) => {
        const p = await tx.product.upsert({
          where: { sourceId_externalRef: { sourceId: source.id, externalRef: data.externalRef } },
          update: { name: data.name, brand: data.brand, category: data.category, description: data.description, imageUrl: data.imageUrl },
          create: { sourceId: source.id, externalRef: data.externalRef, name: data.name, brand: data.brand, category: data.category, description: data.description, imageUrl: data.imageUrl },
        });
        for (const id of data.identifiers) {
          const existing = await tx.productIdentifier.findUnique({ where: { type_value: { type: id.type, value: id.value } } });
          if (existing && existing.productId !== p.id) throw new Error(`${id.type} ${id.value} already belongs to another product`);
          if (!existing) await tx.productIdentifier.create({ data: { productId: p.id, ...id } });
        }
      });
      ok++;
    } catch (e) {
      errors.push({ line, message: safeErrorMessage(e) });
    }
  }
  return { totalRows: parsed.totalRows, ok, errors, duplicates: 0 };
}

async function runPricesImport(deps: JobDeps, importId: string) {
  const imp = await deps.db.import.findUniqueOrThrow({ where: { id: importId } });
  const parsed = parsePricesCsv(imp.payload ?? '', deps.now?.());
  if (parsed.fatal) throw new PermanentJobError(parsed.fatal);
  const source = await ensureCsvSource(deps.db);
  const products = await deps.db.product.findMany({ where: { sourceId: source.id, externalRef: { in: [...new Set(parsed.rows.map((r) => r.data.externalRef))] } }, select: { id: true, externalRef: true } });
  const idByRef = new Map(products.map((p) => [p.externalRef, p.id]));
  const errors: RowError[] = [...parsed.errors];
  const batch: NewObservation[] = [];
  for (const { line, data } of parsed.rows) {
    const productId = idByRef.get(data.externalRef);
    if (!productId) {
      errors.push({ line, message: `Unknown product external_ref "${data.externalRef}" (import products first)` });
      continue;
    }
    batch.push({ productId, sourceId: source.id, price: data.price, currency: data.currency, observedAt: data.observedAt, origin: 'CSV_IMPORT', sourceUrl: data.sourceUrl, sourceRef: `import:${importId}:L${line}`, importId });
  }
  const { inserted, duplicates } = await ingestObservations(deps.db, batch);
  await evaluateAlerts(deps.db, { productIds: [...new Set(inserted.map((i) => i.productId))], mailer: deps.mailer });
  return { totalRows: parsed.totalRows, ok: inserted.length, errors, duplicates };
}

async function runRefresh(deps: JobDeps, sourceId: string) {
  const source = await deps.db.source.findUniqueOrThrow({ where: { id: sourceId } });
  if (!source.enabled) throw new PermanentJobError(`Source ${source.slug} is disabled`);
  const adapter = getAdapter(source.slug);
  if (!adapter) throw new PermanentJobError(`No adapter registered for source ${source.slug}`);
  const products = await deps.db.product.findMany({ where: { sourceId }, select: { id: true, externalRef: true } });
  const now = deps.now?.() ?? new Date();
  const fetched = await adapter.fetchObservations({ products, now }); // throws on failure => retry
  const idByRef = new Map(products.map((p) => [p.externalRef, p.id]));
  const batch: NewObservation[] = [];
  let skipped = 0;
  for (const o of fetched) {
    const productId = idByRef.get(o.externalRef);
    if (!productId || o.observedAt.getTime() > now.getTime() + 5 * 60_000) {
      skipped++;
      continue;
    }
    batch.push({ productId, sourceId, price: o.price, currency: o.currency, observedAt: o.observedAt, origin: adapter.origin, sourceRef: o.sourceRef, sourceUrl: o.sourceUrl });
  }
  const { inserted, duplicates } = await ingestObservations(deps.db, batch);
  await deps.db.source.update({ where: { id: sourceId }, data: { lastSyncedAt: now } });
  await evaluateAlerts(deps.db, { productIds: [...new Set(inserted.map((i) => i.productId))], mailer: deps.mailer });
  return { totalRows: fetched.length, ok: inserted.length, errors: [] as RowError[], duplicates, skipped };
}

/**
 * Execute one BackgroundJob row. Idempotent: SUCCEEDED jobs are never re-run and
 * observations are deduplicated, so a repeated delivery changes nothing.
 * Throws on retryable failure (attempts < max); marks FAILED when attempts are
 * exhausted or the error is permanent.
 */
export async function executeJob(deps: JobDeps, jobId: string): Promise<'done' | 'skipped'> {
  const { db } = deps;
  const claimed = await db.backgroundJob.updateMany({ where: { id: jobId, status: { in: ['QUEUED', 'FAILED', 'RUNNING'] } }, data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } } });
  if (claimed.count === 0) return 'skipped';
  const job = await db.backgroundJob.findUniqueOrThrow({ where: { id: jobId } });
  if (job.status === 'SUCCEEDED') return 'skipped';
  try {
    const type: JobType = job.type;
    const res =
      type === 'CSV_PRODUCTS' ? await runProductsImport(deps, job.importId!)
      : type === 'CSV_PRICES' ? await runPricesImport(deps, job.importId!)
      : await runRefresh(deps, job.sourceId!);
    const finished = new Date();
    await db.backgroundJob.update({ where: { id: jobId }, data: { status: 'SUCCEEDED', finishedAt: finished, lastError: null, result: { ok: res.ok, duplicates: res.duplicates, errorRows: res.errors.length, totalRows: res.totalRows } as Prisma.InputJsonValue } });
    if (job.importId) {
      await db.import.update({
        where: { id: job.importId },
        data: { status: 'SUCCEEDED', totalRows: res.totalRows, okRows: res.ok, errorRows: res.errors.length, errors: res.errors.slice(0, MAX_STORED_ERRORS) as unknown as Prisma.InputJsonValue, finishedAt: finished },
      });
    }
    return 'done';
  } catch (err) {
    const msg = safeErrorMessage(err);
    const permanent = err instanceof PermanentJobError;
    const exhausted = permanent || job.attempts >= job.maxAttempts;
    logger.warn({ jobId, attempts: job.attempts, permanent, err: msg }, 'job failed');
    await db.backgroundJob.update({ where: { id: jobId }, data: { status: exhausted ? 'FAILED' : 'QUEUED', lastError: msg, finishedAt: exhausted ? new Date() : null } });
    if (exhausted && job.importId) {
      await db.import.update({ where: { id: job.importId }, data: { status: 'FAILED', errors: [{ line: 0, message: msg }], finishedAt: new Date() } });
    }
    if (permanent) return 'done'; // do not let the queue retry
    throw err;
  }
}

export async function createRefreshJob(db: PrismaClient, sourceId: string, bucket: string) {
  const idempotencyKey = `refresh:${sourceId}:${bucket}`;
  const existing = await db.backgroundJob.findUnique({ where: { idempotencyKey } });
  if (existing) return { job: existing, created: false };
  try {
    const job = await db.backgroundJob.create({ data: { type: 'REFRESH_SOURCE', sourceId, idempotencyKey, maxAttempts: MAX_ATTEMPTS } });
    return { job, created: true };
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') return { job: await db.backgroundJob.findUniqueOrThrow({ where: { idempotencyKey } }), created: false };
    throw e;
  }
}

/** Hourly-resolution bucket so scheduled refreshes are idempotent within the same interval. */
export const refreshBucket = (now: Date, everyMinutes: number) => String(Math.floor(now.getTime() / (everyMinutes * 60_000)));
