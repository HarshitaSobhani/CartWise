import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { parseCurrency, parsePrice, ValidationError, Decimal } from './money.js';

export const MAX_CSV_BYTES = 2 * 1024 * 1024;
export const MAX_CSV_ROWS = 5000;
export const MAX_STORED_ERRORS = 100;

export interface RowError {
  line: number;
  message: string;
}

export interface ParseResult<T> {
  rows: { line: number; data: T }[];
  errors: RowError[];
  totalRows: number;
  fatal?: string;
}

const PRODUCT_COLUMNS = ['external_ref', 'name', 'category'] as const;
const PRICE_COLUMNS = ['external_ref', 'price', 'currency', 'observed_at'] as const;

export interface ProductRow {
  externalRef: string;
  name: string;
  brand?: string;
  category: string;
  description?: string;
  imageUrl?: string;
  identifiers: { type: string; value: string }[];
}

export interface PriceRow {
  externalRef: string;
  price: Decimal;
  currency: string;
  observedAt: Date;
  sourceUrl?: string;
}

function readRecords(text: string, required: readonly string[]): { records: Record<string, string>[]; fatal?: string } {
  if (Buffer.byteLength(text, 'utf8') > MAX_CSV_BYTES) return { records: [], fatal: `File exceeds ${MAX_CSV_BYTES} bytes` };
  let records: Record<string, string>[];
  try {
    records = parse(text, {
      columns: (h: string[]) => h.map((c) => c.trim().toLowerCase()),
      bom: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: false,
      max_record_size: 64 * 1024,
    });
  } catch (e) {
    return { records: [], fatal: `Malformed CSV: ${(e as Error).message}`.slice(0, 300) };
  }
  if (records.length === 0) return { records, fatal: 'CSV contains no data rows' };
  const header = Object.keys(records[0]);
  const missing = required.filter((c) => !header.includes(c));
  if (missing.length) return { records: [], fatal: `Missing required column(s): ${missing.join(', ')}` };
  if (records.length > MAX_CSV_ROWS) return { records: [], fatal: `Too many rows (max ${MAX_CSV_ROWS})` };
  return { records };
}

const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

const productSchema = z.object({
  external_ref: text(100).regex(/^[\w.\-:/]+$/, 'external_ref may only contain letters, digits and . _ - : /'),
  name: text(200),
  brand: optText(100),
  category: text(60),
  description: optText(2000),
  image_url: optText(500).refine((v) => !v || /^https?:\/\//i.test(v), 'image_url must be http(s)'),
  gtin: optText(14).refine((v) => !v || /^\d{8,14}$/.test(v), 'gtin must be 8-14 digits'),
  sku: optText(64),
});

export function parseProductsCsv(csv: string): ParseResult<ProductRow> {
  const { records, fatal } = readRecords(csv, PRODUCT_COLUMNS);
  if (fatal) return { rows: [], errors: [{ line: 1, message: fatal }], totalRows: 0, fatal };
  const rows: ParseResult<ProductRow>['rows'] = [];
  const errors: RowError[] = [];
  const seen = new Set<string>();
  records.forEach((rec, i) => {
    const line = i + 2;
    const r = productSchema.safeParse(rec);
    if (!r.success) {
      errors.push({ line, message: r.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') });
      return;
    }
    const d = r.data;
    if (seen.has(d.external_ref)) {
      errors.push({ line, message: `Duplicate external_ref "${d.external_ref}" in file` });
      return;
    }
    seen.add(d.external_ref);
    const identifiers: ProductRow['identifiers'] = [];
    if (d.gtin) identifiers.push({ type: 'GTIN', value: d.gtin });
    if (d.sku) identifiers.push({ type: 'SKU', value: d.sku });
    rows.push({
      line,
      data: { externalRef: d.external_ref, name: d.name, brand: d.brand, category: d.category, description: d.description, imageUrl: d.image_url, identifiers },
    });
  });
  return { rows, errors, totalRows: records.length };
}

export function parsePricesCsv(csv: string, now: Date = new Date()): ParseResult<PriceRow> {
  const { records, fatal } = readRecords(csv, PRICE_COLUMNS);
  if (fatal) return { rows: [], errors: [{ line: 1, message: fatal }], totalRows: 0, fatal };
  const rows: ParseResult<PriceRow>['rows'] = [];
  const errors: RowError[] = [];
  records.forEach((rec, i) => {
    const line = i + 2;
    try {
      const ref = (rec.external_ref ?? '').trim();
      if (!ref) throw new ValidationError('external_ref is required');
      const price = parsePrice(rec.price);
      const currency = parseCurrency(rec.currency);
      const iso = (rec.observed_at ?? '').trim();
      const observedAt = new Date(iso);
      if (!/^\d{4}-\d{2}-\d{2}/.test(iso) || Number.isNaN(observedAt.getTime())) throw new ValidationError(`Invalid observed_at "${iso}" (use ISO 8601)`);
      if (observedAt.getTime() > now.getTime() + 5 * 60_000) throw new ValidationError('observed_at is in the future');
      const sourceUrl = (rec.source_url ?? '').trim();
      if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) throw new ValidationError('source_url must be http(s)');
      rows.push({ line, data: { externalRef: ref, price, currency, observedAt, sourceUrl: sourceUrl || undefined } });
    } catch (e) {
      errors.push({ line, message: e instanceof ValidationError ? e.message : 'Invalid row' });
    }
  });
  return { rows, errors, totalRows: records.length };
}

// ---------- export helpers ----------

/** Neutralise spreadsheet formula injection and quote per RFC 4180. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
