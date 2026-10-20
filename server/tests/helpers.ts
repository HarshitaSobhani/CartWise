import request from 'supertest';
import { prisma } from '../src/db.js';
import { createApp } from '../src/app.js';
import { ingestObservations } from '../src/services/observations.js';

export const app = createApp();

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE "NotificationEvent","TargetAlert","WishlistItem","Wishlist","Expense","Budget","PriceObservation","ProductIdentifier","BackgroundJob","Import","Product","Source","User" RESTART IDENTITY CASCADE`,
  );
}

export async function register(email: string, name = 'Test User') {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register').send({ email, name, password: 'correct-horse-battery' });
  if (res.status !== 201) throw new Error(`register failed ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, user: res.body.user as { id: string; role: string } };
}

export async function makeSource(slug = 'demo', isDemo = true) {
  return prisma.source.create({ data: { slug, name: `Source ${slug}`, kind: isDemo ? 'DEMO' : 'CSV', isDemo } });
}

export async function makeProduct(sourceId: string, ref: string, name = `Product ${ref}`, category = 'Gadgets') {
  return prisma.product.create({ data: { sourceId, externalRef: ref, name, category } });
}

export async function addObs(productId: string, sourceId: string, price: string, observedAt: string, currency = 'USD', origin: 'DEMO' | 'CSV_IMPORT' | 'EXTERNAL' = 'DEMO') {
  const r = await ingestObservations(prisma, [{ productId, sourceId, price, currency, observedAt: new Date(observedAt), origin }]);
  return r.inserted[0];
}

export async function waitFor<T>(fn: () => Promise<T | null | false | undefined>, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('waitFor timed out');
}
