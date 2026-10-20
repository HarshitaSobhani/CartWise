import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { backoffMs, createRefreshJob, executeJob, MAX_ATTEMPTS } from '../src/services/jobs.js';
import { registerAdapter, unregisterAdapter } from '../src/adapters/registry.js';
import { demoAdapter } from '../src/adapters/demo.js';
import type { SourceAdapter } from '../src/adapters/types.js';
import { safeErrorMessage } from '../src/logger.js';
import { freshness } from '../src/services/analytics.js';
import { makeProduct, makeSource, register, resetDb } from './helpers.js';

beforeEach(resetDb);

const NOW = new Date('2026-03-01T10:00:00Z');
const deps = () => ({ db: prisma, now: () => NOW });

async function admin() {
  const { user } = await register('boss@example.com');
  expect(user.role).toBe('ADMIN');
  return user;
}

async function makeImport(type: 'CSV_PRODUCTS' | 'CSV_PRICES', csv: string) {
  const u = await admin().catch(async () => (await prisma.user.findFirstOrThrow()));
  const imp = await prisma.import.create({ data: { userId: u.id, type, filename: 'x.csv', payload: csv } });
  const job = await prisma.backgroundJob.create({ data: { type, importId: imp.id, idempotencyKey: `import:${imp.id}`, maxAttempts: MAX_ATTEMPTS } });
  return { imp, job };
}

describe('CSV import jobs', () => {
  it('imports products then prices; unknown refs and bad rows become visible errors', async () => {
    const p = await makeImport('CSV_PRODUCTS', 'external_ref,name,category,sku\nA1,Widget,Tools,SKU-1\nA2,Gizmo,Tools,SKU-2\n');
    expect(await executeJob(deps(), p.job.id)).toBe('done');
    expect(await prisma.product.count()).toBe(2);
    expect(await prisma.productIdentifier.count()).toBe(2);

    const csv = 'external_ref,price,currency,observed_at,source_url\nA1,10.00,USD,2026-02-01T00:00:00Z,\nA1,10.00,USD,2026-02-01T00:00:00Z,\nA1,9.50,USD,2026-02-10T00:00:00Z,\nZZ,5.00,USD,2026-02-10T00:00:00Z,\nA2,bad,USD,2026-02-10T00:00:00Z,\n';
    const r = await makeImport('CSV_PRICES', csv);
    await executeJob(deps(), r.job.id);
    const imp = await prisma.import.findUniqueOrThrow({ where: { id: r.imp.id } });
    expect(imp.status).toBe('SUCCEEDED');
    expect(imp.okRows).toBe(2); // exact duplicate row skipped
    expect(imp.errorRows).toBe(2);
    expect((imp.errors as { message: string }[]).map((e) => e.message).join(' ')).toMatch(/Unknown product/);
    const obs = await prisma.priceObservation.findMany();
    expect(obs.every((o) => o.origin === 'CSV_IMPORT')).toBe(true);
  });

  it('re-running a finished job is a no-op (idempotent)', async () => {
    const p = await makeImport('CSV_PRODUCTS', 'external_ref,name,category\nA1,Widget,Tools\n');
    expect(await executeJob(deps(), p.job.id)).toBe('done');
    expect(await executeJob(deps(), p.job.id)).toBe('skipped');
    expect(await prisma.product.count()).toBe(1);
    expect((await prisma.backgroundJob.findUniqueOrThrow({ where: { id: p.job.id } })).attempts).toBe(1);
  });

  it('re-importing the same price file inserts nothing new', async () => {
    const p = await makeImport('CSV_PRODUCTS', 'external_ref,name,category\nA1,Widget,Tools\n');
    await executeJob(deps(), p.job.id);
    const csv = 'external_ref,price,currency,observed_at\nA1,10.00,USD,2026-02-01T00:00:00Z\n';
    for (let i = 0; i < 2; i++) {
      const r = await makeImport('CSV_PRICES', csv);
      await executeJob(deps(), r.job.id);
    }
    expect(await prisma.priceObservation.count()).toBe(1);
  });

  it('permanent failure (malformed file) marks job and import FAILED without retry', async () => {
    const r = await makeImport('CSV_PRICES', 'external_ref,price\nA1,1\n');
    expect(await executeJob(deps(), r.job.id)).toBe('done');
    const job = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: r.job.id } });
    expect(job.status).toBe('FAILED');
    expect(job.lastError).toMatch(/Missing required column/);
    expect((await prisma.import.findUniqueOrThrow({ where: { id: r.imp.id } })).status).toBe('FAILED');
  });
});

describe('refresh jobs, retries and failures', () => {
  const flaky = (failures: number): SourceAdapter & { calls: number } => {
    const a = {
      ...demoAdapter, slug: 'flaky', calls: 0,
      async fetchObservations(ctx: Parameters<SourceAdapter['fetchObservations']>[0]) {
        a.calls++;
        if (a.calls <= failures) throw new Error('upstream 503 https://user:pw@api.example.com/x?token=abc');
        return demoAdapter.fetchObservations(ctx);
      },
    };
    return a;
  };
  afterEach(() => unregisterAdapter('flaky'));

  async function flakySource() {
    const s = await prisma.source.create({ data: { slug: 'flaky', name: 'Flaky', kind: 'API' } });
    await makeProduct(s.id, 'f1');
    return s;
  }

  it('demo refresh stores DEMO observations once per day (idempotent)', async () => {
    registerAdapter(demoAdapter);
    const s = await makeSource('demo', true);
    await makeProduct(s.id, 'd1');
    const j1 = await createRefreshJob(prisma, s.id, 'b1');
    await executeJob(deps(), j1.job.id);
    const j2 = await createRefreshJob(prisma, s.id, 'b2');
    await executeJob(deps(), j2.job.id);
    const obs = await prisma.priceObservation.findMany();
    expect(obs).toHaveLength(1);
    expect(obs[0].origin).toBe('DEMO');
    expect((await prisma.source.findUniqueOrThrow({ where: { id: s.id } })).lastSyncedAt).toEqual(NOW);
  });

  it('same bucket yields the same job (scheduler idempotency)', async () => {
    const s = await makeSource('demo', true);
    const a = await createRefreshJob(prisma, s.id, 'same');
    const b = await createRefreshJob(prisma, s.id, 'same');
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(a.job.id).toBe(b.job.id);
  });

  it('retries with a limit then fails visibly; secrets are not stored', async () => {
    const adapter = flaky(99);
    registerAdapter(adapter);
    const s = await flakySource();
    const { job } = await createRefreshJob(prisma, s.id, 'x');
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      await expect(executeJob(deps(), job.id)).rejects.toThrow();
      expect((await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('QUEUED');
    }
    await expect(executeJob(deps(), job.id)).rejects.toThrow();
    const failed = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(failed.status).toBe('FAILED');
    expect(failed.attempts).toBe(MAX_ATTEMPTS);
    expect(failed.lastError).toContain('503');
    expect(failed.lastError).not.toMatch(/user:pw|token=abc/);
    expect(await prisma.priceObservation.count()).toBe(0); // nothing fabricated on failure
  });

  it('recovers after a transient failure', async () => {
    const adapter = flaky(1);
    registerAdapter(adapter);
    const s = await flakySource();
    const { job } = await createRefreshJob(prisma, s.id, 'x');
    await expect(executeJob(deps(), job.id)).rejects.toThrow();
    expect(await executeJob(deps(), job.id)).toBe('done');
    const done = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status).toBe('SUCCEEDED');
    expect(done.lastError).toBeNull();
    expect(await prisma.priceObservation.count()).toBe(1);
  });

  it('source failure leaves existing data intact and it is reported stale', async () => {
    registerAdapter(flaky(99));
    const s = await flakySource();
    const p = await prisma.product.findFirstOrThrow();
    await prisma.priceObservation.create({ data: { productId: p.id, sourceId: s.id, price: '10.00', currency: 'USD', observedAt: new Date('2026-01-01T00:00:00Z'), origin: 'EXTERNAL', dedupeKey: 'k1' } });
    const { job } = await createRefreshJob(prisma, s.id, 'x');
    await expect(executeJob(deps(), job.id)).rejects.toThrow();
    expect(await prisma.priceObservation.count()).toBe(1);
    expect(freshness(new Date('2026-01-01T00:00:00Z'), NOW, 48).status).toBe('stale');
  });

  it('disabled sources and missing adapters fail permanently without retrying', async () => {
    const s = await prisma.source.create({ data: { slug: 'noadapter', name: 'No adapter', kind: 'API' } });
    const { job } = await createRefreshJob(prisma, s.id, 'x');
    expect(await executeJob(deps(), job.id)).toBe('done');
    const j = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(j.status).toBe('FAILED');
    expect(j.attempts).toBe(1);
  });

  it('backoff grows exponentially and is capped', () => {
    expect([1, 2, 3].map(backoffMs)).toEqual([5000, 10000, 20000]);
    expect(backoffMs(20)).toBe(300000);
  });

  it('safeErrorMessage strips credentials', () => {
    const m = safeErrorMessage(new Error('connect postgresql://u:secret@db/x failed password=hunter2'));
    expect(m).not.toMatch(/secret|hunter2/);
  });
});
