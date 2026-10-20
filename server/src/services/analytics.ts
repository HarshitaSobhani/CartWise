import type { ObservationOrigin, PrismaClient } from '@prisma/client';
import { Decimal, percentChange, type DecimalValue } from '../lib/money.js';
import { config } from '../config.js';

export interface Obs {
  id: string;
  sourceId: string;
  price: DecimalValue;
  currency: string;
  observedAt: Date;
  origin: ObservationOrigin;
  sourceUrl?: string | null;
}

export type Freshness = { status: 'none' | 'fresh' | 'stale'; ageHours: number | null; lastObservedAt: string | null };

export function freshness(lastObservedAt: Date | null | undefined, now = new Date(), staleAfterHours = config.STALE_AFTER_HOURS): Freshness {
  if (!lastObservedAt) return { status: 'none', ageHours: null, lastObservedAt: null };
  const ageHours = Math.max(0, (now.getTime() - lastObservedAt.getTime()) / 3_600_000);
  return { status: ageHours > staleAfterHours ? 'stale' : 'fresh', ageHours: Math.round(ageHours * 10) / 10, lastObservedAt: lastObservedAt.toISOString() };
}

export const serializeObs = (o: Obs) => ({
  id: o.id,
  sourceId: o.sourceId,
  price: new Decimal(o.price).toFixed(2),
  currency: o.currency,
  observedAt: o.observedAt.toISOString(),
  origin: o.origin,
  sourceUrl: o.sourceUrl ?? null,
});

const byTimeAsc = (a: Obs, b: Obs) => a.observedAt.getTime() - b.observedAt.getTime();

/**
 * Pure price-history statistics. A "valid comparison" requires identical
 * currency and source; observations of other currencies/sources are never mixed.
 * Lowest/highest are the lowest/highest *recorded* values, not market lows.
 */
export function historyStats(observations: Obs[], now = new Date()) {
  const currencies = [...new Set(observations.map((o) => o.currency))].sort();
  const sorted = [...observations].sort(byTimeAsc);
  const latest = sorted.at(-1) ?? null;
  type Change = { percent: string | null; from: string; to: string; fromAt: string; toAt: string };
  let change: Change | null = null;
  let lowest: ReturnType<typeof serializeObs> | null = null;
  let highest: ReturnType<typeof serializeObs> | null = null;
  let windowChange: Change | null = null;
  if (latest) {
    const comparable = sorted.filter((o) => o.currency === latest.currency && o.sourceId === latest.sourceId);
    const prev = comparable.length > 1 ? comparable.at(-2)! : null;
    if (prev) {
      change = { percent: percentChange(prev.price, latest.price), from: new Decimal(prev.price).toFixed(2), to: new Decimal(latest.price).toFixed(2), fromAt: prev.observedAt.toISOString(), toAt: latest.observedAt.toISOString() };
      const first = comparable[0];
      windowChange = { percent: percentChange(first.price, latest.price), from: new Decimal(first.price).toFixed(2), to: new Decimal(latest.price).toFixed(2), fromAt: first.observedAt.toISOString(), toAt: latest.observedAt.toISOString() };
    }
    const same = comparable;
    lowest = serializeObs(same.reduce((m, o) => (new Decimal(o.price).lt(m.price) ? o : m), same[0]));
    highest = serializeObs(same.reduce((m, o) => (new Decimal(o.price).gt(m.price) ? o : m), same[0]));
  }
  return {
    count: observations.length,
    currencies,
    currencyMismatch: currencies.length > 1,
    latest: latest ? serializeObs(latest) : null,
    changeVsPrevious: change,
    changeOverWindow: windowChange,
    lowestRecorded: lowest,
    highestRecorded: highest,
    freshness: freshness(latest?.observedAt, now),
  };
}

export async function productAnalytics(db: PrismaClient, productId: string, opts: { currency?: string; sourceId?: string; days?: number } = {}, now = new Date()) {
  const where = {
    productId,
    ...(opts.sourceId ? { sourceId: opts.sourceId } : {}),
    ...(opts.currency ? { currency: opts.currency } : {}),
    ...(opts.days ? { observedAt: { gte: new Date(now.getTime() - opts.days * 86_400_000) } } : {}),
  };
  const all = await db.priceObservation.findMany({ where, orderBy: { observedAt: 'asc' }, include: { source: { select: { id: true, name: true, isDemo: true } } } });
  // Stats are computed within a single (latest) currency to avoid mixing.
  const stats = historyStats(all, now);
  const latestCur = stats.latest?.currency;
  const statsScoped = opts.currency || !latestCur ? stats : historyStats(all.filter((o) => o.currency === latestCur), now);
  return {
    stats: { ...statsScoped, currencies: stats.currencies, currencyMismatch: stats.currencyMismatch },
    points: all.map((o) => ({ ...serializeObs(o), sourceName: o.source.name, isDemo: o.source.isDemo || o.origin === 'DEMO' })),
  };
}

/** Latest observation for every (source, currency) pair of a product: source coverage. */
export async function sourceCoverage(db: PrismaClient, productId: string, now = new Date()) {
  const rows = await db.priceObservation.findMany({ where: { productId }, orderBy: { observedAt: 'desc' }, include: { source: true } });
  const seen = new Map<string, (typeof rows)[number]>();
  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = `${r.sourceId}|${r.currency}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
    if (!seen.has(k)) seen.set(k, r);
  }
  return [...seen.entries()].map(([k, r]) => ({
    sourceId: r.sourceId,
    sourceName: r.source.name,
    isDemo: r.source.isDemo || r.origin === 'DEMO',
    origin: r.origin,
    currency: r.currency,
    observationCount: counts.get(k)!,
    latest: serializeObs(r),
    freshness: freshness(r.observedAt, now),
  }));
}
