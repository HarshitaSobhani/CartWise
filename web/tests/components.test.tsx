import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CompareTable } from '../src/components/CompareTable';
import { PriceChart } from '../src/components/PriceChart';
import { ProductCard } from '../src/components/ProductCard';
import { FreshnessBadge, DemoBadge, Change } from '../src/components/ui';
import type { CompareResult, Point, ProductCardData } from '../src/lib/types';
import { formatAge, signedPercent } from '../src/lib/format';

const fresh = { status: 'fresh' as const, ageHours: 3, lastObservedAt: '2026-01-01T00:00:00Z' };
const obs = (price: string, currency = 'USD') => ({ id: 'o', sourceId: 's', price, currency, observedAt: '2026-01-01T00:00:00Z', origin: 'DEMO', sourceUrl: null, sourceName: 'Demo Provider', isDemo: true });

function result(over: Partial<CompareResult> = {}): CompareResult {
  const row = (id: string, name: string, latest: ReturnType<typeof obs> | null) => ({
    product: { id, name, brand: null, category: 'Laptops', specs: { RAM: '16 GB' }, sourceName: 'Demo' },
    currencies: latest ? [latest.currency] : [], latest, changeVsPrevious: null, freshness: latest ? fresh : { status: 'none' as const, ageHours: null, lastObservedAt: null },
    sourceCount: latest ? 1 : 0, observationCount: latest ? 1 : 0, lowestRecorded: latest?.price ?? null, missingReason: latest ? null : 'No price observations recorded',
    differenceFromCheapest: latest ? { amount: id === 'a' ? '0.00' : '20.00', percent: id === 'a' ? '0.00' : '25.00' } : null,
  });
  return { currency: 'USD', availableCurrencies: ['USD'], currencyMismatch: false, warning: null, notComparable: [], cheapestProductId: 'a', rows: [row('a', 'Alpha', obs('80.00')), row('b', 'Beta', obs('100.00'))], ...over };
}

describe('CompareTable', () => {
  it('renders prices, lowest badge, specs and freshness', () => {
    render(<MemoryRouter><CompareTable result={result()} /></MemoryRouter>);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Lowest latest price')).toBeInTheDocument();
    expect(screen.getAllByText('$80.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$100.00').length).toBeGreaterThan(0);
    expect(screen.getByRole('rowheader', { name: 'RAM' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('shows a currency-mismatch warning and does not invent a missing value', () => {
    const r = result({ currencyMismatch: true, warning: 'Products have observations in multiple currencies (EUR, USD). No currency conversion is applied.', cheapestProductId: null, availableCurrencies: ['EUR', 'USD'] });
    r.rows[1] = { ...r.rows[1], latest: null, currencies: ['EUR'], missingReason: 'No observations in USD', differenceFromCheapest: null };
    render(<MemoryRouter><CompareTable result={r} /></MemoryRouter>);
    expect(screen.getByRole('alert')).toHaveTextContent(/Currency mismatch/);
    expect(screen.getByText(/Not available — No observations in USD \(has EUR\)/)).toBeInTheDocument();
    expect(screen.queryByText('Lowest latest price')).not.toBeInTheDocument();
  });
});

describe('PriceChart', () => {
  it('shows an empty state when there are no observations for the currency', () => {
    render(<PriceChart points={[]} currency="USD" />);
    expect(screen.getByText(/No price observations to chart for USD/)).toBeInTheDocument();
  });
  it('is described accessibly and plots only the requested currency', () => {
    const pts = [obs('10.00'), { ...obs('20.00', 'EUR'), id: 'e' }] as Point[];
    render(<PriceChart points={pts} currency="USD" />);
    expect(screen.getByRole('img')).toHaveAccessibleName(/1 observations in USD|in USD: 1 observations/);
  });
});

describe('ProductCard', () => {
  const p: ProductCardData = { id: 'p1', name: 'Alpha Laptop', brand: 'Acme', category: 'Laptops', imageUrl: null, source: { id: 's', name: 'Demo', isDemo: true }, latest: { price: '99.50', currency: 'USD', observedAt: '2026-01-01T00:00:00Z', isDemo: true, sourceName: 'Demo' }, otherCurrencies: ['EUR'], freshness: fresh };
  it('shows labelled demo price, other currencies and wires its actions', async () => {
    const toggle = vi.fn(); const add = vi.fn();
    render(<MemoryRouter><ProductCard p={p} selected={false} compareDisabled={false} onToggleCompare={toggle} onAddWishlist={add} /></MemoryRouter>);
    expect(screen.getByText('Demo data')).toBeInTheDocument();
    expect(screen.getByText(/Also recorded in EUR \(not converted\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: /Compare/ }));
    expect(toggle).toHaveBeenCalledWith('p1');
    await userEvent.click(screen.getByRole('button', { name: 'Add Alpha Laptop to wishlist' }));
    expect(add).toHaveBeenCalledWith('p1');
  });
  it('handles products with no price data', () => {
    render(<MemoryRouter><ProductCard p={{ ...p, latest: null, otherCurrencies: [], freshness: { status: 'none', ageHours: null, lastObservedAt: null } }} selected={false} compareDisabled onToggleCompare={vi.fn()} onAddWishlist={vi.fn()} /></MemoryRouter>);
    expect(screen.getByText('No price observations yet.')).toBeInTheDocument();
    expect(screen.getByText('No price data')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });
});

describe('badges and formatting', () => {
  it('marks stale data', () => {
    render(<FreshnessBadge f={{ status: 'stale', ageHours: 100, lastObservedAt: 'x' }} />);
    expect(screen.getByText(/Stale · 4 days ago/)).toBeInTheDocument();
  });
  it('distinguishes demo vs recorded', () => {
    const { rerender } = render(<DemoBadge demo />);
    expect(screen.getByText('Demo data')).toBeInTheDocument();
    rerender(<DemoBadge demo={false} />);
    expect(screen.getByText('Recorded')).toBeInTheDocument();
  });
  it('formats changes without inventing values', () => {
    render(<div data-testid="c"><Change percent={null} /></div>);
    expect(within(screen.getByTestId('c')).getByText('n/a')).toBeInTheDocument();
    expect(signedPercent('5.00')).toBe('+5.00%');
    expect(signedPercent('-5.00')).toBe('-5.00%');
    expect(formatAge(0.2)).toMatch(/less than 1 hour/);
  });
});
