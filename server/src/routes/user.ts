import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncH, HttpError, parse, requireAuth } from '../http.js';
import { Decimal, parseCurrency, parsePrice, type DecimalValue } from '../lib/money.js';
import { targetStatus } from '../services/alerts.js';
import { freshness } from '../services/analytics.js';

export const userRouter = Router();
userRouter.use(requireAuth);

const m = (d: DecimalValue) => new Decimal(d).toFixed(2);

// ---------- alerts (always scoped to the signed-in user) ----------
const alertSelect = { include: { product: { select: { id: true, name: true, imageUrl: true } } } } as const;

async function serializeAlert(a: Awaited<ReturnType<typeof prisma.targetAlert.findFirstOrThrow<typeof alertSelect>>>) {
  const obs = await prisma.priceObservation.findMany({ where: { productId: a.productId }, select: { price: true, currency: true, observedAt: true } });
  return { id: a.id, product: a.product, targetPrice: m(a.targetPrice), currency: a.currency, status: a.status, notifyInApp: a.notifyInApp, notifyEmail: a.notifyEmail, createdAt: a.createdAt.toISOString(), target: targetStatus(a.targetPrice, a.currency, obs) };
}

userRouter.get('/alerts', asyncH(async (req, res) => {
  const rows = await prisma.targetAlert.findMany({ where: { userId: req.user!.id }, ...alertSelect, orderBy: { createdAt: 'desc' } });
  res.json({ alerts: await Promise.all(rows.map(serializeAlert)) });
}));

const alertBody = z.object({ productId: z.string().max(40), targetPrice: z.string().or(z.number().transform(String)), currency: z.string(), notifyInApp: z.boolean().default(true), notifyEmail: z.boolean().default(false) });

userRouter.post('/alerts', asyncH(async (req, res) => {
  const b = parse(alertBody, req.body);
  const price = parsePrice(b.targetPrice);
  const currency = parseCurrency(b.currency);
  if (!(await prisma.product.findUnique({ where: { id: b.productId }, select: { id: true } }))) throw new HttpError(404, 'Product not found');
  try {
    const a = await prisma.targetAlert.create({ data: { userId: req.user!.id, productId: b.productId, targetPrice: price.toFixed(2), currency, notifyInApp: b.notifyInApp, notifyEmail: b.notifyEmail }, ...alertSelect });
    res.status(201).json({ alert: await serializeAlert(a) });
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') throw new HttpError(409, 'You already have an alert for this product and currency');
    throw e;
  }
}));

userRouter.patch('/alerts/:id', asyncH(async (req, res) => {
  const b = parse(z.object({ targetPrice: z.string().or(z.number().transform(String)).optional(), notifyInApp: z.boolean().optional(), notifyEmail: z.boolean().optional(), status: z.enum(['ACTIVE', 'PAUSED']).optional() }).strict(), req.body);
  const own = await prisma.targetAlert.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
  if (!own) throw new HttpError(404, 'Alert not found');
  const rearm = b.status === 'ACTIVE' || (b.targetPrice !== undefined && own.status === 'TRIGGERED');
  const a = await prisma.targetAlert.update({
    where: { id: own.id },
    data: { ...(b.targetPrice !== undefined ? { targetPrice: parsePrice(b.targetPrice).toFixed(2) } : {}), notifyInApp: b.notifyInApp, notifyEmail: b.notifyEmail, status: b.status ?? (rearm ? 'ACTIVE' : undefined), ...(rearm ? { armedAt: new Date() } : {}) },
    ...alertSelect,
  });
  res.json({ alert: await serializeAlert(a) });
}));

userRouter.delete('/alerts/:id', asyncH(async (req, res) => {
  const r = await prisma.targetAlert.deleteMany({ where: { id: req.params.id, userId: req.user!.id } });
  if (!r.count) throw new HttpError(404, 'Alert not found');
  res.status(204).end();
}));

// ---------- notifications ----------
userRouter.get('/notifications', asyncH(async (req, res) => {
  const rows = await prisma.notificationEvent.findMany({ where: { userId: req.user!.id, inApp: true }, orderBy: { createdAt: 'desc' }, take: 100, include: { alert: { select: { productId: true } } } });
  res.json({ unread: rows.filter((r) => !r.readAt).length, notifications: rows.map((r) => ({ id: r.id, title: r.title, body: r.body, productId: r.alert?.productId ?? null, read: Boolean(r.readAt), createdAt: r.createdAt.toISOString() })) });
}));

userRouter.post('/notifications/:id/read', asyncH(async (req, res) => {
  const r = await prisma.notificationEvent.updateMany({ where: { id: req.params.id, userId: req.user!.id, readAt: null }, data: { readAt: new Date() } });
  if (!r.count && !(await prisma.notificationEvent.findFirst({ where: { id: req.params.id, userId: req.user!.id } }))) throw new HttpError(404, 'Notification not found');
  res.status(204).end();
}));

userRouter.post('/notifications/read-all', asyncH(async (req, res) => {
  await prisma.notificationEvent.updateMany({ where: { userId: req.user!.id, readAt: null }, data: { readAt: new Date() } });
  res.status(204).end();
}));

// ---------- wishlists ----------
const wlName = z.object({ name: z.string().trim().min(1).max(80) });

async function ownWishlist(userId: string, id: string) {
  const w = await prisma.wishlist.findFirst({ where: { id, userId } });
  if (!w) throw new HttpError(404, 'Wishlist not found'); // 404, not 403: do not reveal other users' ids
  return w;
}

userRouter.get('/wishlists', asyncH(async (req, res) => {
  const lists = await prisma.wishlist.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'asc' }, include: { items: { include: { product: { select: { id: true, name: true, imageUrl: true, category: true } } }, orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] } } });
  const ids = lists.flatMap((l) => l.items.map((i) => i.productId));
  const obs = ids.length ? await prisma.priceObservation.findMany({ where: { productId: { in: ids } }, orderBy: { observedAt: 'desc' }, include: { source: { select: { isDemo: true } } } }) : [];
  res.json({
    wishlists: lists.map((l) => {
      const items = l.items.map((i) => {
        const mine = obs.filter((o) => o.productId === i.productId);
        const latest = mine[0];
        return { id: i.id, priority: i.priority, note: i.note, product: i.product, latest: latest ? { price: m(latest.price), currency: latest.currency, observedAt: latest.observedAt.toISOString(), isDemo: latest.source.isDemo || latest.origin === 'DEMO' } : null, freshness: freshness(latest?.observedAt) };
      });
      // totals are kept per currency; different currencies are never summed together
      const totals: Record<string, string> = {};
      for (const it of items) if (it.latest) totals[it.latest.currency] = new Decimal(totals[it.latest.currency] ?? 0).plus(it.latest.price).toFixed(2);
      return { id: l.id, name: l.name, items, totalsByCurrency: totals };
    }),
  });
}));

userRouter.post('/wishlists', asyncH(async (req, res) => {
  const b = parse(wlName, req.body);
  try {
    const w = await prisma.wishlist.create({ data: { userId: req.user!.id, name: b.name } });
    res.status(201).json({ wishlist: { id: w.id, name: w.name } });
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') throw new HttpError(409, 'You already have a wishlist with this name');
    throw e;
  }
}));

userRouter.delete('/wishlists/:id', asyncH(async (req, res) => {
  const w = await ownWishlist(req.user!.id, req.params.id);
  await prisma.wishlist.delete({ where: { id: w.id } });
  res.status(204).end();
}));

userRouter.post('/wishlists/:id/items', asyncH(async (req, res) => {
  const w = await ownWishlist(req.user!.id, req.params.id);
  const b = parse(z.object({ productId: z.string().max(40), priority: z.number().int().min(1).max(5).default(3), note: z.string().trim().max(500).optional() }), req.body);
  if (!(await prisma.product.findUnique({ where: { id: b.productId }, select: { id: true } }))) throw new HttpError(404, 'Product not found');
  try {
    const item = await prisma.wishlistItem.create({ data: { wishlistId: w.id, productId: b.productId, priority: b.priority, note: b.note } });
    res.status(201).json({ item: { id: item.id, priority: item.priority, note: item.note } });
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') throw new HttpError(409, 'Product is already in this wishlist');
    throw e;
  }
}));

userRouter.patch('/wishlists/:id/items/:itemId', asyncH(async (req, res) => {
  const w = await ownWishlist(req.user!.id, req.params.id);
  const b = parse(z.object({ priority: z.number().int().min(1).max(5).optional(), note: z.string().trim().max(500).nullable().optional() }).strict(), req.body);
  const r = await prisma.wishlistItem.updateMany({ where: { id: req.params.itemId, wishlistId: w.id }, data: b });
  if (!r.count) throw new HttpError(404, 'Item not found');
  res.status(204).end();
}));

userRouter.delete('/wishlists/:id/items/:itemId', asyncH(async (req, res) => {
  const w = await ownWishlist(req.user!.id, req.params.id);
  const r = await prisma.wishlistItem.deleteMany({ where: { id: req.params.itemId, wishlistId: w.id } });
  if (!r.count) throw new HttpError(404, 'Item not found');
  res.status(204).end();
}));

// ---------- budgets & expenses ----------
async function ownBudget(userId: string, id: string) {
  const b = await prisma.budget.findFirst({ where: { id, userId } });
  if (!b) throw new HttpError(404, 'Budget not found');
  return b;
}

userRouter.get('/budgets', asyncH(async (req, res) => {
  const rows = await prisma.budget.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, include: { expenses: { orderBy: { spentAt: 'desc' } } } });
  res.json({
    budgets: rows.map((b) => {
      const spent = b.expenses.reduce((s, e) => s.plus(e.amount), new Decimal(0));
      const remaining = new Decimal(b.limit).minus(spent);
      return { id: b.id, name: b.name, currency: b.currency, limit: m(b.limit), spent: m(spent), remaining: m(remaining), percentUsed: new Decimal(b.limit).isZero() ? null : spent.div(b.limit).times(100).toDecimalPlaces(1).toFixed(1), overBudget: remaining.lt(0), expenses: b.expenses.map((e) => ({ id: e.id, description: e.description, amount: m(e.amount), spentAt: e.spentAt.toISOString() })) };
    }),
  });
}));

userRouter.post('/budgets', asyncH(async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(1).max(80), currency: z.string(), limit: z.string().or(z.number().transform(String)) }), req.body);
  const row = await prisma.budget.create({ data: { userId: req.user!.id, name: b.name, currency: parseCurrency(b.currency), limit: parsePrice(b.limit).toFixed(2) } });
  res.status(201).json({ budget: { id: row.id } });
}));

userRouter.patch('/budgets/:id', asyncH(async (req, res) => {
  const own = await ownBudget(req.user!.id, req.params.id);
  const b = parse(z.object({ name: z.string().trim().min(1).max(80).optional(), limit: z.string().or(z.number().transform(String)).optional() }).strict(), req.body);
  await prisma.budget.update({ where: { id: own.id }, data: { name: b.name, ...(b.limit !== undefined ? { limit: parsePrice(b.limit).toFixed(2) } : {}) } });
  res.status(204).end();
}));

userRouter.delete('/budgets/:id', asyncH(async (req, res) => {
  const own = await ownBudget(req.user!.id, req.params.id);
  await prisma.budget.delete({ where: { id: own.id } });
  res.status(204).end();
}));

userRouter.post('/budgets/:id/expenses', asyncH(async (req, res) => {
  const own = await ownBudget(req.user!.id, req.params.id);
  const b = parse(z.object({ description: z.string().trim().min(1).max(200), amount: z.string().or(z.number().transform(String)), spentAt: z.string().datetime().optional() }), req.body);
  const e = await prisma.expense.create({ data: { budgetId: own.id, description: b.description, amount: parsePrice(b.amount).toFixed(2), spentAt: b.spentAt ? new Date(b.spentAt) : undefined } });
  res.status(201).json({ expense: { id: e.id } });
}));

userRouter.delete('/budgets/:id/expenses/:expenseId', asyncH(async (req, res) => {
  const own = await ownBudget(req.user!.id, req.params.id);
  const r = await prisma.expense.deleteMany({ where: { id: req.params.expenseId, budgetId: own.id } });
  if (!r.count) throw new HttpError(404, 'Expense not found');
  res.status(204).end();
}));
