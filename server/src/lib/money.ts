import { Prisma } from '@prisma/client';

export const Decimal = Prisma.Decimal;
export type Decimal = Prisma.Decimal;
export type DecimalValue = Prisma.Decimal.Value;

const PRICE_RE = /^\d{1,12}(\.\d{1,2})?$/;
const CURRENCY_RE = /^[A-Za-z]{3}$/;

export class ValidationError extends Error {}

/** Strict decimal-safe price parse. Rejects >2 decimals instead of silently rounding. */
export function parsePrice(input: string): Decimal {
  const s = String(input ?? '').trim();
  if (!PRICE_RE.test(s)) throw new ValidationError(`Invalid price "${s}" (expected e.g. 19.99, max 2 decimals)`);
  const d = new Decimal(s);
  if (d.lte(0)) throw new ValidationError('Price must be greater than zero');
  return d.toDecimalPlaces(2);
}

export function parseCurrency(input: string): string {
  const s = String(input ?? '').trim();
  if (!CURRENCY_RE.test(s)) throw new ValidationError(`Invalid currency "${s}" (expected ISO 4217 code like USD)`);
  return s.toUpperCase();
}

/** Percentage change from `from` to `to`, rounded to 2dp; null when `from` is zero. */
export function percentChange(from: DecimalValue, to: DecimalValue): string | null {
  const a = new Decimal(from);
  if (a.isZero()) return null;
  return new Decimal(to).minus(a).div(a).times(100).toDecimalPlaces(2).toFixed(2);
}

export const money = (d: DecimalValue): string => new Decimal(d).toFixed(2);
