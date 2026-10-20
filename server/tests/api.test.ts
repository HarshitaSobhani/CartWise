import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../src/db.js';
import { addObs, app, makeProduct, makeSource, register, resetDb, waitFor } from './helpers.js';

beforeEach(resetDb);

describe('authentication', () => {
  it('registers, logs in, rejects bad credentials, weak passwords and duplicates', async () => {
    const { agent } = await register('u@example.com');
    expect((await agent.get('/api/auth/me')).body.user.email).toBe('u@example.com');
    expect((await request(app).post('/api/auth/register').send({ email: 'u@example.com', name: 'x', password: 'correct-horse-battery' })).status).toBe(409);
    expect((await request(app).post('/api/auth/register').send({ email: 'v@example.com', name: 'x', password: 'short' })).status).toBe(400);
    expect((await request(app).post('/api/auth/login').send({ email: 'u@example.com', password: 'wrong-password-1' })).status).toBe(401);
    const ok = await request(app).post('/api/auth/login').send({ email: 'u@example.com', password: 'correct-horse-battery' });
    expect(ok.status).toBe(200);
    expect(ok.headers['set-cookie'][0]).toMatch(/HttpOnly/);
    expect(JSON.stringify(ok.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
  });
  it('stores a hashed password only', async () => {
    await register('u@example.com');
    const u = await prisma.user.findFirstOrThrow();
    expect(u.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(u.passwordHash).not.toContain('correct-horse');
  });
  it('protects private routes and rejects forged tokens', async () => {
    for (const path of ['/api/products', '/api/me/alerts', '/api/me/budgets', '/api/me/wishlists', '/api/exports/wishlists.csv', '/api/admin/jobs']) {
      expect((await request(app).get(path)).status).toBe(401);
    }
    expect((await request(app).get('/api/products').set('Cookie', 'cw_session=garbage')).status).toBe(401);
  });
  it('regular users cannot reach admin routes; configured admin email can', async () => {
    const { agent } = await register('plain@example.com');
    expect((await agent.get('/api/admin/jobs')).status).toBe(403);
    expect((await agent.post('/api/admin/imports').send({ type: 'CSV_PRODUCTS', filename: 'a.csv', csv: 'x' })).status).toBe(403);
    const { agent: boss } = await register('boss@example.com');
    expect((await boss.get('/api/admin/jobs')).status).toBe(200);
  });
  it('cannot self-promote via profile update', async () => {
    const { agent } = await register('plain@example.com');
    expect((await agent.patch('/api/auth/me').send({ role: 'ADMIN' })).status).toBe(400);
  });
});

describe('ownership enforcement (IDOR)', () => {
  it('blocks access to another user\'s alerts, wishlists, budgets and notifications by id', async () => {
    const s = await makeSource();
    const p = await makeProduct(s.id, 'p1');
    const a = await register('a@example.com');
    const b = await register('b@example.com');

    const alert = (await a.agent.post('/api/me/alerts').send({ productId: p.id, targetPrice: '10', currency: 'USD' })).body.alert;
    expect((await b.agent.patch(`/api/me/alerts/${alert.id}`).send({ targetPrice: '99' })).status).toBe(404);
    expect((await b.agent.delete(`/api/me/alerts/${alert.id}`)).status).toBe(404);
    expect((await b.agent.get('/api/me/alerts')).body.alerts).toHaveLength(0);

    const wl = (await a.agent.get('/api/me/wishlists')).body.wishlists[0];
    expect((await b.agent.post(`/api/me/wishlists/${wl.id}/items`).send({ productId: p.id })).status).toBe(404);
    expect((await b.agent.delete(`/api/me/wishlists/${wl.id}`)).status).toBe(404);
    const item = (await a.agent.post(`/api/me/wishlists/${wl.id}/items`).send({ productId: p.id, priority: 1 })).body.item;
    expect((await b.agent.patch(`/api/me/wishlists/${wl.id}/items/${item.id}`).send({ priority: 5 })).status).toBe(404);
    expect(JSON.stringify((await b.agent.get('/api/me/wishlists')).body)).not.toContain(item.id);

    const budget = (await a.agent.post('/api/me/budgets').send({ name: 'Tech', currency: 'USD', limit: '500' })).body.budget;
    expect((await b.agent.post(`/api/me/budgets/${budget.id}/expenses`).send({ description: 'x', amount: '5' })).status).toBe(404);
    expect((await b.agent.patch(`/api/me/budgets/${budget.id}`).send({ limit: '1' })).status).toBe(404);
    expect((await b.agent.delete(`/api/me/budgets/${budget.id}`)).status).toBe(404);
    expect((await b.agent.get('/api/me/budgets')).body.budgets).toHaveLength(0);

    await addObs(p.id, s.id, '5', '2026-01-02T00:00:00Z');
    const { evaluateAlerts } = await import('../src/services/alerts.js');
    await new Promise((r) => setTimeout(r, 15));
    await addObs(p.id, s.id, '4', '2026-01-03T00:00:00Z');
    await evaluateAlerts(prisma);
    const n = (await a.agent.get('/api/me/notifications')).body.notifications[0];
    expect(n).toBeTruthy();
    expect((await b.agent.post(`/api/me/notifications/${n.id}/read`)).status).toBe(404);
    expect((await b.agent.get('/api/me/notifications')).body.notifications).toHaveLength(0);
  });
});

describe('budgets, wishlists and alerts API', () => {
  it('tracks expenses with exact decimals and flags overspend', async () => {
    const { agent } = await register('a@example.com');
    const bud = (await agent.post('/api/me/budgets').send({ name: 'Tech', currency: 'usd', limit: '0.30' })).body.budget;
    await agent.post(`/api/me/budgets/${bud.id}/expenses`).send({ description: 'a', amount: '0.10' }).expect(201);
    await agent.post(`/api/me/budgets/${bud.id}/expenses`).send({ description: 'b', amount: '0.20' }).expect(201);
    let b = (await agent.get('/api/me/budgets')).body.budgets[0];
    expect(b.spent).toBe('0.30');
    expect(b.remaining).toBe('0.00');
    expect(b.overBudget).toBe(false);
    await agent.post(`/api/me/budgets/${bud.id}/expenses`).send({ description: 'c', amount: '0.01' }).expect(201);
    b = (await agent.get('/api/me/budgets')).body.budgets[0];
    expect(b.overBudget).toBe(true);
    expect(b.remaining).toBe('-0.01');
    expect((await agent.post('/api/me/budgets').send({ name: 'x', currency: 'USD', limit: '-5' })).status).toBe(400);
  });
  it('wishlists prioritise items and total per currency', async () => {
    const s = await makeSource();
    const p1 = await makeProduct(s.id, 'p1');
    const p2 = await makeProduct(s.id, 'p2');
    await addObs(p1.id, s.id, '10', '2026-01-02T00:00:00Z', 'USD');
    await addObs(p2.id, s.id, '20', '2026-01-02T00:00:00Z', 'EUR');
    const { agent } = await register('a@example.com');
    const wl = (await agent.get('/api/me/wishlists')).body.wishlists[0];
    await agent.post(`/api/me/wishlists/${wl.id}/items`).send({ productId: p1.id, priority: 4 }).expect(201);
    await agent.post(`/api/me/wishlists/${wl.id}/items`).send({ productId: p2.id, priority: 1 }).expect(201);
    expect((await agent.post(`/api/me/wishlists/${wl.id}/items`).send({ productId: p2.id })).status).toBe(409);
    const got = (await agent.get('/api/me/wishlists')).body.wishlists[0];
    expect(got.items.map((i: { product: { id: string } }) => i.product.id)).toEqual([p2.id, p1.id]);
    expect(got.totalsByCurrency).toEqual({ USD: '10.00', EUR: '20.00' });
  });
  it('rejects duplicate alerts, bad prices, unknown products', async () => {
    const s = await makeSource();
    const p = await makeProduct(s.id, 'p1');
    const { agent } = await register('a@example.com');
    await agent.post('/api/me/alerts').send({ productId: p.id, targetPrice: '10', currency: 'USD' }).expect(201);
    expect((await agent.post('/api/me/alerts').send({ productId: p.id, targetPrice: '9', currency: 'USD' })).status).toBe(409);
    expect((await agent.post('/api/me/alerts').send({ productId: p.id, targetPrice: 'abc', currency: 'EUR' })).status).toBe(400);
    expect((await agent.post('/api/me/alerts').send({ productId: 'nope', targetPrice: '9', currency: 'EUR' })).status).toBe(404);
  });
});

describe('catalog API', () => {
  it('searches, filters, paginates and shows demo labels, stale flags, other currencies', async () => {
    const s = await makeSource();
    const a = await makeProduct(s.id, 'a', 'Alpha Laptop', 'Laptops');
    await makeProduct(s.id, 'b', 'Beta Phone', 'Phones');
    await addObs(a.id, s.id, '10', '2020-01-01T00:00:00Z', 'USD');
    await addObs(a.id, s.id, '9', '2020-01-02T00:00:00Z', 'EUR');
    const { agent } = await register('a@example.com');
    const all = (await agent.get('/api/products')).body;
    expect(all.total).toBe(2);
    const search = (await agent.get('/api/products?q=alpha')).body;
    expect(search.items).toHaveLength(1);
    expect(search.items[0].latest.isDemo).toBe(true);
    expect(search.items[0].freshness.status).toBe('stale');
    expect(search.items[0].otherCurrencies).toHaveLength(1);
    expect((await agent.get('/api/products?category=Phones')).body.items[0].latest).toBeNull();
    expect((await agent.get('/api/products?pageSize=1&page=2')).body.items).toHaveLength(1);
    expect((await agent.get('/api/products/categories')).body.categories).toHaveLength(2);
    const detail = (await agent.get(`/api/products/${a.id}`)).body;
    expect(detail.stats.currencyMismatch).toBe(true);
    expect(detail.coverage.length).toBe(2);
    expect((await agent.get('/api/products/missing')).status).toBe(404);
    const cmp = (await agent.get(`/api/products/compare?ids=${a.id},missing`)).body;
    expect(cmp.rows).toHaveLength(1);
    expect((await agent.get('/api/products/compare?ids=onlyone')).status).toBe(400);
  });
});

describe('CSV import flow and admin monitoring', () => {
  it('previews without writing, imports via queue, exposes jobs, retries failures', async () => {
    const { agent } = await register('boss@example.com');
    const csv = 'external_ref,name,category\nA1,Widget,Tools\nA2,,Tools\n';
    const prev = await agent.post('/api/admin/imports/preview').send({ type: 'CSV_PRODUCTS', filename: 'p.csv', csv });
    expect(prev.body).toMatchObject({ totalRows: 2, validRows: 1, errorRows: 1 });
    expect(prev.body.errors[0].line).toBe(3);
    expect(await prisma.product.count()).toBe(0);

    const res = await agent.post('/api/admin/imports').send({ type: 'CSV_PRODUCTS', filename: 'p.csv', csv });
    expect(res.status).toBe(202);
    const done = await waitFor(async () => (await prisma.import.findUnique({ where: { id: res.body.import.id } }))?.status === 'SUCCEEDED');
    expect(done).toBe(true);
    expect(await prisma.product.count()).toBe(1);
    const list = (await agent.get('/api/admin/imports')).body.imports;
    expect(list[0]).toMatchObject({ okRows: 1, errorRows: 1, status: 'SUCCEEDED' });

    const bad = await agent.post('/api/admin/imports').send({ type: 'CSV_PRICES', filename: 'x.csv', csv: 'foo,bar\n1,2\n' });
    expect(bad.status).toBe(400);

    // a failed job is visible and can be retried
    const imp = await prisma.import.create({ data: { userId: (await prisma.user.findFirstOrThrow()).id, type: 'CSV_PRODUCTS', filename: 'f.csv', payload: csv, status: 'FAILED' } });
    const job = await prisma.backgroundJob.create({ data: { type: 'CSV_PRODUCTS', importId: imp.id, idempotencyKey: `import:${imp.id}`, status: 'FAILED', attempts: 3, lastError: 'boom' } });
    expect((await agent.get('/api/admin/jobs?status=FAILED')).body.jobs[0].lastError).toBe('boom');
    expect((await agent.post(`/api/admin/jobs/${job.id}/retry`)).status).toBe(202);
    await waitFor(async () => (await prisma.backgroundJob.findUnique({ where: { id: job.id } }))?.status === 'SUCCEEDED');
    expect((await agent.post(`/api/admin/jobs/${job.id}/retry`)).status).toBe(409);
  });
  it('reports data-quality problems', async () => {
    const s = await makeSource();
    const empty = await makeProduct(s.id, 'empty');
    const stale = await makeProduct(s.id, 'stale');
    await addObs(stale.id, s.id, '10', '2020-01-01T00:00:00Z');
    const { agent } = await register('boss@example.com');
    const dq = (await agent.get('/api/admin/data-quality')).body;
    expect(dq.noData.map((x: { id: string }) => x.id)).toEqual([empty.id]);
    expect(dq.stale.map((x: { id: string }) => x.id)).toEqual([stale.id]);
  });
});

describe('exports', () => {
  it('exports only the user\'s own data and neutralises formula injection', async () => {
    const s = await makeSource();
    const evil = await prisma.product.create({ data: { sourceId: s.id, externalRef: 'e', name: '=HYPERLINK("http://evil","x")', category: '@SUM(A1)', brand: '+cmd' } });
    await addObs(evil.id, s.id, '10', '2026-01-02T00:00:00Z');
    const a = await register('a@example.com');
    const b = await register('b@example.com');
    const wl = (await a.agent.get('/api/me/wishlists')).body.wishlists[0];
    await a.agent.post(`/api/me/wishlists/${wl.id}/items`).send({ productId: evil.id, note: '-2+3' }).expect(201);
    const csvA = await a.agent.get('/api/exports/wishlists.csv');
    expect(csvA.headers['content-type']).toMatch(/text\/csv/);
    expect(csvA.headers['content-disposition']).toMatch(/attachment/);
    expect(csvA.text).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(csvA.text).toContain(`'@SUM(A1)`);
    expect(csvA.text).toContain(`'+cmd`);
    expect(csvA.text).toContain(`'-2+3`);
    expect(csvA.text.split('\r\n').filter(Boolean)).toHaveLength(2);
    expect((await b.agent.get('/api/exports/wishlists.csv')).text.split('\r\n').filter(Boolean)).toHaveLength(1); // header only
    const hist = await a.agent.get(`/api/exports/price-history.csv?productId=${evil.id}`);
    expect(hist.text).toContain('DEMO');
    expect(hist.text).toContain("'=HYPERLINK");
    expect(hist.text).toContain('10.00,USD,2026-01-02T00:00:00.000Z');
    expect((await a.agent.get('/api/exports/price-history.csv')).status).toBe(400);
    await a.agent.post('/api/me/budgets').send({ name: '=cmd', currency: 'USD', limit: '5' });
    expect((await a.agent.get('/api/exports/alerts.csv')).status).toBe(200);
    expect((await a.agent.get('/api/exports/budgets.csv')).status).toBe(200);
  });
});

describe('request hardening', () => {
  it('rejects malformed JSON and oversized bodies without leaking internals', async () => {
    const { agent } = await register('a@example.com');
    const bad = await agent.post('/api/me/budgets').set('Content-Type', 'application/json').send('{oops');
    expect(bad.status).toBe(400);
    const big = await agent.post('/api/admin/imports/preview').send({ csv: 'x'.repeat(4 * 1024 * 1024) });
    expect(big.status).toBe(413);
    expect((await request(app).get('/api/nope')).status).toBe(404);
  });
});
