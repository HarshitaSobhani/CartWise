import type { PrismaClient } from '@prisma/client';
import { Decimal, percentChange } from '../lib/money.js';
import { freshness, serializeObs } from './analytics.js';

/**
 * Compare products on their latest recorded observation in ONE currency.
 * Prices in different currencies are never compared as equivalent: if the
 * products have no common currency the result is flagged and no ranking is made.
 */
export async function compareProducts(db: PrismaClient, ids: string[], requestedCurrency?: string, now = new Date()) {
  const products = await db.product.findMany({ where: { id: { in: ids } }, include: { source: { select: { name: true, isDemo: true } } } });
  const ordered = ids.map((id) => products.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => Boolean(p));
  const obs = await db.priceObservation.findMany({ where: { productId: { in: ids } }, orderBy: { observedAt: 'desc' }, include: { source: { select: { name: true, isDemo: true } } } });

  const perProduct = ordered.map((p) => {
    const mine = obs.filter((o) => o.productId === p.id);
    const currencies = [...new Set(mine.map((o) => o.currency))].sort();
    return { p, mine, currencies };
  });

  const allCurrencies = [...new Set(perProduct.flatMap((x) => x.currencies))].sort();
  // Pick comparison currency: requested, else the currency held by the most products.
  let currency = requestedCurrency?.toUpperCase();
  if (!currency && allCurrencies.length) {
    currency = allCurrencies
      .map((c) => ({ c, n: perProduct.filter((x) => x.currencies.includes(c)).length }))
      .sort((a, b) => b.n - a.n || a.c.localeCompare(b.c))[0].c;
  }
  const missingCurrencyProducts = perProduct.filter((x) => currency && !x.currencies.includes(currency)).map((x) => x.p.id);
  const mismatch = allCurrencies.length > 1;

  const rows = perProduct.map(({ p, mine, currencies }) => {
    const inCur = currency ? mine.filter((o) => o.currency === currency) : [];
    const latest = inCur[0] ?? null;
    const sameSrc = latest ? inCur.filter((o) => o.sourceId === latest.sourceId) : [];
    const prev = sameSrc[1] ?? null;
    const sources = new Set(mine.map((o) => o.sourceId));
    return {
      product: { id: p.id, name: p.name, brand: p.brand, category: p.category, imageUrl: p.imageUrl, specs: p.specs, sourceName: p.source.name },
      currencies,
      latest: latest ? { ...serializeObs(latest), sourceName: latest.source.name, isDemo: latest.source.isDemo || latest.origin === 'DEMO' } : null,
      changeVsPrevious: latest && prev ? { percent: percentChange(prev.price, latest.price), from: new Decimal(prev.price).toFixed(2) } : null,
      freshness: freshness(latest?.observedAt, now),
      sourceCount: sources.size,
      observationCount: mine.length,
      lowestRecorded: inCur.length ? new Decimal(inCur.reduce((m, o) => (new Decimal(o.price).lt(m.price) ? o : m)).price).toFixed(2) : null,
      missingReason: latest ? null : mine.length ? `No observations in ${currency}` : 'No price observations recorded',
    };
  });

  const priced = rows.filter((r) => r.latest);
  const cheapest = priced.length >= 2 ? priced.reduce((m, r) => (new Decimal(r.latest!.price).lt(m.latest!.price) ? r : m)) : null;
  const withDiff = rows.map((r) => ({
    ...r,
    differenceFromCheapest:
      cheapest && r.latest ? { amount: new Decimal(r.latest.price).minus(cheapest.latest!.price).toFixed(2), percent: percentChange(cheapest.latest!.price, r.latest.price) } : null,
  }));

  return {
    currency: currency ?? null,
    availableCurrencies: allCurrencies,
    currencyMismatch: mismatch,
    warning: mismatch
      ? `Products have observations in multiple currencies (${allCurrencies.join(', ')}). Only ${currency} values are compared; no currency conversion is applied.`
      : null,
    notComparable: missingCurrencyProducts,
    cheapestProductId: cheapest?.product.id ?? null,
    rows: withDiff,
  };
}
