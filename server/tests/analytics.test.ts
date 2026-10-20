import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { freshness, historyStats, productAnalytics, sourceCoverage } from '../src/services/analytics.js';
import { compareProducts } from '../src/services/compare.js';
import { dedupeKey, ingestObservations } from '../src/services/observations.js';
import { addObs, makeProduct, makeSource, resetDb } from './helpers.js';

beforeEach(resetDb);

describe('observation ingestion', () => {
  it('deduplicates exact repeats within a batch and across runs', async () => {
    const s = await makeSource();
    const p = await makeProduct(s.id, 'p1');
    const o = { productId: p.id, sourceId: s.id, price: '10.5', currency: 'usd', observedAt: new Date('2026-01-01T00:00:00Z'), origin: 'DEMO' as const };
    const first = await ingestObservations(prisma, [o, { ...o, price: '10.50' }]);
    expect(first.inserted).toHaveLength(1);
    expect(first.duplicates).toBe(1);
    const second = await ingestObservations(prisma, [o]);
    expect(second.inserted).toHaveLength(0);
    expect(await prisma.priceObservation.count()).toBe(1);
  });
  it('dedupe key differs by price, currency, time and source', () => {
    const base = { productId: 'a', sourceId: 's', price: '1.00', currency: 'USD', observedAt: new Date('2026-01-01T00:00:00Z') };
    const keys = new Set([dedupeKey(base), dedupeKey({ ...base, price: '1.01' }), dedupeKey({ ...base, currency: 'EUR' }), dedupeKey({ ...base, observedAt: new Date('2026-01-02T00:00:00Z') }), dedupeKey({ ...base, sourceId: 't' })]);
    expect(keys.size).toBe(5);
    expect(dedupeKey(base)).toBe(dedupeKey({ ...base, price: '1', currency: 'usd' }));
  });
  it('stores money as exact decimals', async () => {
    const s = await makeSource();
    const p = await makeProduct(s.id, 'p1');
    await addObs(p.id, s.id, '0.10', '2026-01-01T00:00:00Z');
    await addObs(p.id, s.id, '0.20', '2026-01-02T00:00:00Z');
    const rows = await prisma.priceObservation.findMany();
    expect(rows.reduce((a, r) => a.plus(r.price), rows[0].price.minus(rows[0].price)).toFixed(2)).toBe('0.30');
  });
});

describe('price-history calculations', () => {
  const mk = (price: string, at: string, currency = 'USD', sourceId = 's1') => ({ id: at + price, sourceId, price, currency, observedAt: new Date(at), origin: 'DEMO' as const });
  const now = new Date('2026-01-10T00:00:00Z');

  it('computes change, lowest and highest from stored observations only', () => {
    const s = historyStats([mk('100', '2026-01-01T00:00:00Z'), mk('80', '2026-01-05T00:00:00Z'), mk('90', '2026-01-09T00:00:00Z')], now);
    expect(s.latest?.price).toBe('90.00');
    expect(s.changeVsPrevious?.percent).toBe('12.50');
    expect(s.changeOverWindow?.percent).toBe('-10.00');
    expect(s.lowestRecorded?.price).toBe('80.00');
    expect(s.highestRecorded?.price).toBe('100.00');
    expect(s.freshness.status).toBe('fresh');
  });
  it('returns no change with a single observation (no invented values)', () => {
    const s = historyStats([mk('100', '2026-01-09T00:00:00Z')], now);
    expect(s.changeVsPrevious).toBeNull();
    expect(s.changeOverWindow).toBeNull();
  });
  it('handles no observations', () => {
    const s = historyStats([], now);
    expect(s.latest).toBeNull();
    expect(s.freshness.status).toBe('none');
    expect(s.lowestRecorded).toBeNull();
  });
  it('never compares across currencies or sources', () => {
    const s = historyStats([mk('100', '2026-01-01T00:00:00Z', 'EUR'), mk('50', '2026-01-09T00:00:00Z', 'USD')], now);
    expect(s.currencyMismatch).toBe(true);
    expect(s.changeVsPrevious).toBeNull();
    const t = historyStats([mk('100', '2026-01-01T00:00:00Z', 'USD', 's1'), mk('50', '2026-01-09T00:00:00Z', 'USD', 's2')], now);
    expect(t.changeVsPrevious).toBeNull();
  });
  it('flags stale data', () => {
    expect(freshness(new Date('2026-01-01T00:00:00Z'), now, 48).status).toBe('stale');
    expect(freshness(new Date('2026-01-09T12:00:00Z'), now, 48).status).toBe('fresh');
  });
  it('productAnalytics scopes stats to one currency and filters by days', async () => {
    await resetDb();
    const s = await makeSource();
    const p = await makeProduct(s.id, 'p1');
    await addObs(p.id, s.id, '10', '2026-01-01T00:00:00Z', 'USD');
    await addObs(p.id, s.id, '12', '2026-01-09T00:00:00Z', 'USD');
    await addObs(p.id, s.id, '99', '2026-01-09T01:00:00Z', 'EUR');
    const all = await productAnalytics(prisma, p.id, {}, now);
    expect(all.stats.currencyMismatch).toBe(true);
    expect(all.stats.latest?.currency).toBe('EUR');
    const usd = await productAnalytics(prisma, p.id, { currency: 'USD' }, now);
    expect(usd.stats.changeVsPrevious?.percent).toBe('20.00');
    const recent = await productAnalytics(prisma, p.id, { currency: 'USD', days: 3 }, now);
    expect(recent.points).toHaveLength(1);
  });
  it('reports source coverage with demo labelling', async () => {
    const demo = await makeSource('demo', true);
    const csv = await makeSource('csv-import', false);
    const p = await makeProduct(demo.id, 'p1');
    await addObs(p.id, demo.id, '10', '2026-01-01T00:00:00Z');
    await addObs(p.id, csv.id, '11', '2026-01-02T00:00:00Z', 'USD', 'CSV_IMPORT');
    const cov = await sourceCoverage(prisma, p.id, now);
    expect(cov).toHaveLength(2);
    expect(cov.find((c) => c.sourceId === demo.id)?.isDemo).toBe(true);
    expect(cov.find((c) => c.sourceId === csv.id)?.isDemo).toBe(false);
  });
});

describe('product comparison', () => {
  const now = new Date('2026-01-10T00:00:00Z');
  it('ranks products in a shared currency', async () => {
    const s = await makeSource();
    const a = await makeProduct(s.id, 'a');
    const b = await makeProduct(s.id, 'b');
    await addObs(a.id, s.id, '100', '2026-01-09T00:00:00Z');
    await addObs(b.id, s.id, '80', '2026-01-09T00:00:00Z');
    const r = await compareProducts(prisma, [a.id, b.id], undefined, now);
    expect(r.currency).toBe('USD');
    expect(r.cheapestProductId).toBe(b.id);
    expect(r.rows[0].differenceFromCheapest).toEqual({ amount: '20.00', percent: '25.00' });
    expect(r.currencyMismatch).toBe(false);
  });
  it('flags currency mismatch, does not rank unconvertible values', async () => {
    const s = await makeSource();
    const a = await makeProduct(s.id, 'a');
    const b = await makeProduct(s.id, 'b');
    await addObs(a.id, s.id, '100', '2026-01-09T00:00:00Z', 'USD');
    await addObs(b.id, s.id, '80', '2026-01-09T00:00:00Z', 'EUR');
    const r = await compareProducts(prisma, [a.id, b.id], undefined, now);
    expect(r.currencyMismatch).toBe(true);
    expect(r.warning).toMatch(/no currency conversion/);
    expect(r.cheapestProductId).toBeNull();
    expect(r.availableCurrencies).toEqual(['EUR', 'USD']);
    expect(r.notComparable).toHaveLength(1);
    const unconverted = r.rows.find((x) => x.product.id === r.notComparable[0])!;
    expect(unconverted.latest).toBeNull();
    expect(unconverted.missingReason).toMatch(/No observations in/);
    expect(unconverted.currencies).toHaveLength(1);
  });
  it('handles missing data without inventing values', async () => {
    const s = await makeSource();
    const a = await makeProduct(s.id, 'a');
    const b = await makeProduct(s.id, 'b');
    await addObs(a.id, s.id, '100', '2026-01-09T00:00:00Z');
    const r = await compareProducts(prisma, [a.id, b.id], undefined, now);
    expect(r.cheapestProductId).toBeNull();
    const rb = r.rows.find((x) => x.product.id === b.id)!;
    expect(rb.latest).toBeNull();
    expect(rb.missingReason).toMatch(/No price observations/);
  });
  it('honours an explicit currency', async () => {
    const s = await makeSource();
    const a = await makeProduct(s.id, 'a');
    const b = await makeProduct(s.id, 'b');
    for (const p of [a, b]) {
      await addObs(p.id, s.id, '10', '2026-01-09T00:00:00Z', 'USD');
      await addObs(p.id, s.id, p === a ? '30' : '20', '2026-01-09T00:00:00Z', 'EUR');
    }
    const r = await compareProducts(prisma, [a.id, b.id], 'eur', now);
    expect(r.currency).toBe('EUR');
    expect(r.cheapestProductId).toBe(b.id);
  });
});
