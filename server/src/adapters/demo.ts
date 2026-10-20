import { createHash } from 'node:crypto';
import type { SourceAdapter } from './types.js';
import { Decimal } from '../lib/money.js';

export const DEMO_SLUG = 'demo';

/** Deterministic pseudo-random in [0,1) from a string seed. */
export function seeded(seed: string): number {
  const h = createHash('sha256').update(seed).digest();
  return h.readUInt32BE(0) / 0x1_0000_0000;
}

/** Deterministic demo price for a product on a UTC day. NOT a real retailer price. */
export function demoPrice(externalRef: string, day: string, base: number): string {
  const wave = Math.sin(new Date(day).getTime() / 86_400_000 / 9 + seeded(externalRef) * 6) * 0.08;
  const noise = (seeded(`${externalRef}:${day}`) - 0.5) * 0.06;
  return new Decimal(base * (1 + wave + noise)).toDecimalPlaces(2).toFixed(2);
}

export function demoBase(externalRef: string): number {
  return 20 + Math.floor(seeded(`base:${externalRef}`) * 480);
}

export const dayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * Demonstration provider. Generates deterministic, synthetic prices (one per
 * UTC day) so the app works offline. Every observation it produces is stored
 * with origin DEMO and shown as demo data in the UI.
 */
export const demoAdapter: SourceAdapter = {
  slug: DEMO_SLUG,
  name: 'CartWise Demo Provider (synthetic)',
  kind: 'DEMO',
  isDemo: true,
  origin: 'DEMO',
  async fetchObservations({ products, now }) {
    const day = dayStart(now);
    const key = day.toISOString().slice(0, 10);
    return products.map((p) => ({
      externalRef: p.externalRef,
      price: demoPrice(p.externalRef, key, demoBase(p.externalRef)),
      currency: 'USD',
      observedAt: day,
      sourceRef: `demo:${p.externalRef}:${key}`,
    }));
  },
};
