import { Router, type Response } from 'express';
import { prisma } from '../db.js';
import { asyncH, HttpError, requireAuth } from '../http.js';
import { toCsv } from '../lib/csv.js';
import { Decimal } from '../lib/money.js';

export const exportsRouter = Router();
exportsRouter.use(requireAuth);

const send = (res: Response, name: string, body: string) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(body);
};

exportsRouter.get('/wishlists.csv', asyncH(async (req, res) => {
  const items = await prisma.wishlistItem.findMany({ where: { wishlist: { userId: req.user!.id } }, include: { wishlist: true, product: true }, orderBy: [{ wishlistId: 'asc' }, { priority: 'asc' }] });
  send(res, 'wishlists.csv', toCsv(['wishlist', 'product', 'brand', 'category', 'priority', 'note'], items.map((i) => [i.wishlist.name, i.product.name, i.product.brand, i.product.category, i.priority, i.note])));
}));

exportsRouter.get('/alerts.csv', asyncH(async (req, res) => {
  const rows = await prisma.targetAlert.findMany({ where: { userId: req.user!.id }, include: { product: true }, orderBy: { createdAt: 'asc' } });
  send(res, 'alerts.csv', toCsv(['product', 'target_price', 'currency', 'status', 'notify_in_app', 'notify_email', 'created_at'], rows.map((a) => [a.product.name, new Decimal(a.targetPrice).toFixed(2), a.currency, a.status, a.notifyInApp, a.notifyEmail, a.createdAt])));
}));

exportsRouter.get('/budgets.csv', asyncH(async (req, res) => {
  const rows = await prisma.expense.findMany({ where: { budget: { userId: req.user!.id } }, include: { budget: true }, orderBy: { spentAt: 'asc' } });
  send(res, 'budgets.csv', toCsv(['budget', 'currency', 'description', 'amount', 'spent_at'], rows.map((e) => [e.budget.name, e.budget.currency, e.description, new Decimal(e.amount).toFixed(2), e.spentAt])));
}));

exportsRouter.get('/price-history.csv', asyncH(async (req, res) => {
  const productId = String(req.query.productId ?? '');
  if (!productId) throw new HttpError(400, 'productId is required');
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new HttpError(404, 'Product not found');
  const obs = await prisma.priceObservation.findMany({ where: { productId }, orderBy: { observedAt: 'asc' }, include: { source: true } });
  send(res, 'price-history.csv', toCsv(['product', 'source', 'data_type', 'price', 'currency', 'observed_at', 'source_url'], obs.map((o) => [product.name, o.source.name, o.source.isDemo || o.origin === 'DEMO' ? 'DEMO' : o.origin, new Decimal(o.price).toFixed(2), o.currency, o.observedAt, o.sourceUrl])));
}));
