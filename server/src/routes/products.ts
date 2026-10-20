import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncH, HttpError, idParam, parse, requireAuth } from '../http.js';
import { freshness, productAnalytics, sourceCoverage } from '../services/analytics.js';
import { compareProducts } from '../services/compare.js';
import { targetStatus } from '../services/alerts.js';
import { Decimal } from '../lib/money.js';

export const productsRouter = Router();
productsRouter.use(requireAuth);

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(60).optional(),
  sourceId: z.string().max(40).optional(),
  sort: z.enum(['name', 'newest']).default('name'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(12),
});

/** Latest observation per (product, currency, source) for the given products. */
async function latestFor(productIds: string[]) {
  if (!productIds.length) return [];
  return prisma.$queryRaw<{ productId: string; price: Prisma.Decimal; currency: string; observedAt: Date; origin: string; sourceName: string; isDemo: boolean }[]>`
    SELECT DISTINCT ON (o."productId", o."currency") o."productId", o."price", o."currency", o."observedAt", o."origin"::text AS origin, s."name" AS "sourceName", s."isDemo" AS "isDemo"
    FROM "PriceObservation" o JOIN "Source" s ON s."id" = o."sourceId"
    WHERE o."productId" IN (${Prisma.join(productIds)})
    ORDER BY o."productId", o."currency", o."observedAt" DESC`;
}

productsRouter.get('/', asyncH(async (req, res) => {
  const q = parse(listQuery, req.query);
  const where: Prisma.ProductWhereInput = {
    ...(q.category ? { category: q.category } : {}),
    ...(q.sourceId ? { sourceId: q.sourceId } : {}),
    ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { brand: { contains: q.q, mode: 'insensitive' } }, { identifiers: { some: { value: q.q } } }] } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({ where, orderBy: q.sort === 'newest' ? { createdAt: 'desc' } : { name: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { source: { select: { id: true, name: true, isDemo: true } } } }),
  ]);
  const latest = await latestFor(items.map((i) => i.id));
  res.json({
    total, page: q.page, pageSize: q.pageSize,
    items: items.map((p) => {
      const mine = latest.filter((l) => l.productId === p.id).sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime());
      const l = mine[0];
      return {
        id: p.id, name: p.name, brand: p.brand, category: p.category, imageUrl: p.imageUrl, source: p.source,
        latest: l ? { price: new Decimal(l.price).toFixed(2), currency: l.currency, observedAt: l.observedAt.toISOString(), isDemo: l.isDemo || l.origin === 'DEMO', sourceName: l.sourceName } : null,
        otherCurrencies: mine.slice(1).map((m) => m.currency),
        freshness: freshness(l?.observedAt),
      };
    }),
  });
}));

productsRouter.get('/categories', asyncH(async (_req, res) => {
  const rows = await prisma.product.groupBy({ by: ['category'], _count: { _all: true }, orderBy: { category: 'asc' } });
  res.json({ categories: rows.map((r) => ({ name: r.category, count: r._count._all })) });
}));

productsRouter.get('/compare', asyncH(async (req, res) => {
  const q = parse(z.object({ ids: z.string().transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)).pipe(z.array(idParam).min(2).max(4)), currency: z.string().length(3).optional() }), req.query);
  res.json(await compareProducts(prisma, [...new Set(q.ids)], q.currency));
}));

productsRouter.get('/:id', asyncH(async (req, res) => {
  const product = await prisma.product.findUnique({ where: { id: req.params.id }, include: { source: true, identifiers: true } });
  if (!product) throw new HttpError(404, 'Product not found');
  const [analytics, coverage, alert] = await Promise.all([
    productAnalytics(prisma, product.id),
    sourceCoverage(prisma, product.id),
    prisma.targetAlert.findMany({ where: { userId: req.user!.id, productId: product.id } }),
  ]);
  const obsForTarget = analytics.points.map((p) => ({ price: p.price, currency: p.currency, observedAt: new Date(p.observedAt) }));
  res.json({
    product: { id: product.id, name: product.name, brand: product.brand, category: product.category, description: product.description, imageUrl: product.imageUrl, specs: product.specs, identifiers: product.identifiers.map((i) => ({ type: i.type, value: i.value })), source: { id: product.source.id, name: product.source.name, isDemo: product.source.isDemo, kind: product.source.kind, lastSyncedAt: product.source.lastSyncedAt?.toISOString() ?? null } },
    stats: analytics.stats,
    coverage,
    alerts: alert.map((a) => ({ id: a.id, targetPrice: new Decimal(a.targetPrice).toFixed(2), currency: a.currency, status: a.status, notifyInApp: a.notifyInApp, notifyEmail: a.notifyEmail, target: targetStatus(a.targetPrice, a.currency, obsForTarget) })),
  });
}));

productsRouter.get('/:id/history', asyncH(async (req, res) => {
  const q = parse(z.object({ days: z.coerce.number().int().min(1).max(3650).optional(), currency: z.string().length(3).optional(), sourceId: z.string().max(40).optional() }), req.query);
  const exists = await prisma.product.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!exists) throw new HttpError(404, 'Product not found');
  res.json(await productAnalytics(prisma, req.params.id, { days: q.days, currency: q.currency?.toUpperCase(), sourceId: q.sourceId }));
}));
