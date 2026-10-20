import { describe, expect, it } from 'vitest';
import { csvCell, parsePricesCsv, parseProductsCsv, toCsv, MAX_CSV_ROWS } from '../src/lib/csv.js';
import { parsePrice, parseCurrency, percentChange } from '../src/lib/money.js';

describe('money normalization', () => {
  it('parses decimal-safe prices', () => {
    expect(parsePrice('19.9').toFixed(2)).toBe('19.90');
    expect(parsePrice('0.10').plus(parsePrice('0.20')).toFixed(2)).toBe('0.30');
  });
  it.each(['', 'abc', '-1', '0', '1.999', '1,299.00', '$5', '1e3'])('rejects invalid price %j', (v) => {
    expect(() => parsePrice(v)).toThrow();
  });
  it('normalizes currency and rejects bad codes', () => {
    expect(parseCurrency('usd')).toBe('USD');
    expect(() => parseCurrency('US')).toThrow();
    expect(() => parseCurrency('US1')).toThrow();
  });
  it('percentChange is null from zero', () => {
    expect(percentChange('100', '90')).toBe('-10.00');
    expect(percentChange('0', '5')).toBeNull();
  });
});

describe('products CSV', () => {
  it('parses valid rows with identifiers and BOM/whitespace', () => {
    const r = parseProductsCsv('﻿external_ref, name ,category,brand,gtin,sku\nA1, Widget ,Tools,Acme,12345678,SKU-1\n');
    expect(r.errors).toEqual([]);
    expect(r.rows[0].data).toMatchObject({ externalRef: 'A1', name: 'Widget', category: 'Tools', brand: 'Acme' });
    expect(r.rows[0].data.identifiers).toEqual([{ type: 'GTIN', value: '12345678' }, { type: 'SKU', value: 'SKU-1' }]);
  });
  it('reports row-level errors with line numbers and keeps valid rows', () => {
    const r = parseProductsCsv('external_ref,name,category,gtin\nA1,Ok,Tools,\nA2,,Tools,\nA3,Bad gtin,Tools,abc\nA1,Dup,Tools,\n');
    expect(r.rows).toHaveLength(1);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4, 5]);
  });
  it('rejects missing required columns', () => {
    const r = parseProductsCsv('name,category\nx,y\n');
    expect(r.fatal).toMatch(/external_ref/);
  });
  it('rejects malformed CSV (inconsistent columns / unterminated quote)', () => {
    expect(parseProductsCsv('external_ref,name,category\nA1,Widget\n').fatal).toMatch(/Malformed/);
    expect(parseProductsCsv('external_ref,name,category\nA1,"Widget,Tools\n').fatal).toMatch(/Malformed/);
  });
  it('rejects empty files and oversized row counts', () => {
    expect(parseProductsCsv('external_ref,name,category\n').fatal).toBeTruthy();
    const big = 'external_ref,name,category\n' + Array.from({ length: MAX_CSV_ROWS + 1 }, (_, i) => `r${i},n,c`).join('\n');
    expect(parseProductsCsv(big).fatal).toMatch(/Too many rows/);
  });
  it('rejects non-http image urls', () => {
    const r = parseProductsCsv('external_ref,name,category,image_url\nA1,W,C,javascript:alert(1)\n');
    expect(r.rows).toHaveLength(0);
    expect(r.errors[0].message).toMatch(/image_url/);
  });
});

describe('prices CSV', () => {
  const now = new Date('2026-01-10T00:00:00Z');
  it('parses and normalizes prices', () => {
    const r = parsePricesCsv('external_ref,price,currency,observed_at,source_url\nA1,19.9,usd,2026-01-01T00:00:00Z,https://x.test/a\n', now);
    expect(r.errors).toEqual([]);
    expect(r.rows[0].data.price.toFixed(2)).toBe('19.90');
    expect(r.rows[0].data.currency).toBe('USD');
    expect(r.rows[0].data.observedAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
  it('flags bad price, currency, date, future date and url per row', () => {
    const csv = ['external_ref,price,currency,observed_at,source_url', 'A,abc,USD,2026-01-01,', 'A,1.00,US,2026-01-01,', 'A,1.00,USD,notadate,', 'A,1.00,USD,2027-01-01,', 'A,1.00,USD,2026-01-01,ftp://x', 'A,1.00,USD,2026-01-01,'].join('\n');
    const r = parsePricesCsv(csv, now);
    expect(r.rows).toHaveLength(1);
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4, 5, 6]);
  });
});

describe('export formula-injection protection', () => {
  it.each(['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tx', '\rx'])('neutralises %j', (v) => {
    expect(csvCell(v).replace(/^"/, '')).toMatch(/^'/);
  });
  it('quotes commas, quotes and newlines (RFC 4180)', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('l1\nl2')).toBe('"l1\nl2"');
  });
  it('leaves numbers, dates and null intact', () => {
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(null)).toBe('');
    expect(csvCell(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01T00:00:00.000Z');
  });
  it('builds a full document', () => {
    expect(toCsv(['a', 'b'], [['=x', 1]])).toBe("a,b\r\n'=x,1\r\n");
  });
});
