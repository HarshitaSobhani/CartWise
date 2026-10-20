import { createHash } from 'node:crypto';
import type { ObservationOrigin, Prisma, PrismaClient } from '@prisma/client';
import { Decimal, type DecimalValue } from '../lib/money.js';

export interface NewObservation {
  productId: string;
  sourceId: string;
  price: DecimalValue;
  currency: string;
  observedAt: Date;
  origin: ObservationOrigin;
  sourceRef?: string;
  sourceUrl?: string;
  importId?: string;
}

export function dedupeKey(o: Pick<NewObservation, 'productId' | 'sourceId' | 'price' | 'currency' | 'observedAt'>): string {
  const canonical = [o.productId, o.sourceId, new Decimal(o.price).toFixed(2), o.currency.toUpperCase(), o.observedAt.toISOString()].join('|');
  return createHash('sha256').update(canonical).digest('hex');
}

/** Insert observations, skipping exact repeats. Returns inserted ids and the skipped count. */
export async function ingestObservations(
  db: PrismaClient | Prisma.TransactionClient,
  items: NewObservation[],
): Promise<{ inserted: { id: string; productId: string }[]; duplicates: number }> {
  const byKey = new Map<string, NewObservation>();
  for (const it of items) byKey.set(dedupeKey(it), it); // in-batch dedupe
  const keys = [...byKey.keys()];
  const existing = new Set((await db.priceObservation.findMany({ where: { dedupeKey: { in: keys } }, select: { dedupeKey: true } })).map((e) => e.dedupeKey));
  const fresh = keys.filter((k) => !existing.has(k));
  const inserted: { id: string; productId: string }[] = [];
  for (const k of fresh) {
    const it = byKey.get(k)!;
    try {
      const row = await db.priceObservation.create({
        data: {
          productId: it.productId,
          sourceId: it.sourceId,
          price: new Decimal(it.price).toFixed(2),
          currency: it.currency.toUpperCase(),
          observedAt: it.observedAt,
          origin: it.origin,
          sourceRef: it.sourceRef,
          sourceUrl: it.sourceUrl,
          importId: it.importId,
          dedupeKey: k,
        },
        select: { id: true, productId: true },
      });
      inserted.push(row);
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') continue; // raced with another writer: still a duplicate
      throw e;
    }
  }
  return { inserted, duplicates: items.length - inserted.length };
}
