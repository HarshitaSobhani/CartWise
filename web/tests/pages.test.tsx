import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import App from '../src/App';
import { Catalog } from '../src/pages/Catalog';
import { Compare } from '../src/pages/Compare';
import { Admin } from '../src/pages/Admin';
import { ME, mockApi, renderApp } from './helpers';

const card = (id: string, name: string) => ({ id, name, brand: null, category: 'Laptops', imageUrl: null, source: { id: 's', name: 'Demo', isDemo: true }, latest: { price: '10.00', currency: 'USD', observedAt: '2026-01-01T00:00:00Z', isDemo: true, sourceName: 'Demo' }, otherCurrencies: [], freshness: { status: 'fresh', ageHours: 1, lastObservedAt: 'x' } });

describe('landing and auth', () => {
  it('renders the landing page with calls to action when signed out', async () => {
    mockApi([(u) => (u === '/api/auth/me' ? { status: 401, body: { error: 'Authentication required' } } : undefined)]);
    renderApp(<App />, '/');
    expect(await screen.findByRole('heading', { level: 1, name: /Shop on evidence/ })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Sign in/ }).length).toBeGreaterThan(0);
  });
  it('redirects protected routes to login', async () => {
    mockApi([(u) => (u === '/api/auth/me' ? { status: 401, body: { error: 'x' } } : undefined)]);
    renderApp(<App />, '/app/catalog');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
  it('shows server validation errors on failed login and signs in on success', async () => {
    let ok = false;
    mockApi([
      (u) => (u === '/api/auth/me' ? (ok ? { body: ME } : { status: 401, body: { error: 'x' } }) : undefined),
      (u, i) => (u === '/api/auth/login' && i?.method === 'POST' ? (JSON.parse(String(i.body)).password === 'rightpassword' ? ((ok = true), { body: ME }) : { status: 401, body: { error: 'Invalid email or password' } }) : undefined),
      (u) => (u.startsWith('/api/me/') || u.startsWith('/api/products') ? { body: { alerts: [], wishlists: [], budgets: [], notifications: [], unread: 0 } } : undefined),
    ]);
    renderApp(<App />, '/login');
    await userEvent.type(await screen.findByLabelText('Email'), 'a@b.c');
    await userEvent.type(screen.getByLabelText('Password'), 'wrongpassword');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    await userEvent.clear(screen.getByLabelText('Password'));
    await userEvent.type(screen.getByLabelText('Password'), 'rightpassword');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/Welcome, Ann/)).toBeInTheDocument();
  });
});

describe('catalog', () => {
  it('shows loading, results, filters via the API, and empty state', async () => {
    const calls = mockApi([
      (u) => (u.startsWith('/api/products/categories') ? { body: { categories: [{ name: 'Laptops', count: 1 }] } } : undefined),
      (u) => (u.startsWith('/api/products?') ? (u.includes('q=zzz') ? { body: { total: 0, page: 1, pageSize: 12, items: [] } } : { body: { total: 1, page: 1, pageSize: 12, items: [card('p1', 'Alpha Laptop')] } }) : undefined),
    ]);
    renderApp(<Routes><Route path="/" element={<Catalog />} /></Routes>);
    expect(screen.getByText('Loading products…')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Alpha Laptop' })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'Laptops');
    await waitFor(() => expect(calls.some((c) => c.url.includes('category=Laptops'))).toBe(true));
    await userEvent.type(screen.getByLabelText('Search'), 'zzz');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('No products match your filters')).toBeInTheDocument();
  });
  it('shows an error with retry', async () => {
    mockApi([(u) => (u.startsWith('/api/products') ? { status: 500, body: { error: 'Internal server error' } } : undefined)]);
    renderApp(<Routes><Route path="/" element={<Catalog />} /></Routes>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
  it('limits comparison to enabling after two selections', async () => {
    mockApi([
      (u) => (u.startsWith('/api/products/categories') ? { body: { categories: [] } } : undefined),
      (u) => (u.startsWith('/api/products?') ? { body: { total: 2, page: 1, pageSize: 12, items: [card('p1', 'Alpha'), card('p2', 'Beta')] } } : undefined),
    ]);
    renderApp(<Routes><Route path="/" element={<Catalog />} /></Routes>);
    await screen.findByRole('link', { name: 'Alpha' });
    const btn = screen.getByRole('button', { name: /Compare selected/ });
    expect(btn).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /Compare Alpha/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Compare Beta/ }));
    expect(btn).toBeEnabled();
  });
});

describe('compare page', () => {
  it('asks for at least two products', () => {
    mockApi([]);
    renderApp(<Routes><Route path="/" element={<Compare />} /></Routes>, '/?ids=a');
    expect(screen.getByText(/Select at least two products/)).toBeInTheDocument();
  });
});

describe('admin import', () => {
  it('validates a CSV, shows row errors, and only then enables import', async () => {
    const calls = mockApi([
      (u) => (u === '/api/admin/imports/preview' ? { body: { totalRows: 2, validRows: 1, errorRows: 1, fatal: null, errors: [{ line: 3, message: 'name: Too small' }], preview: [{ line: 2, externalRef: 'A1', name: 'Widget', category: 'Tools' }] } } : undefined),
      (u, i) => (u === '/api/admin/imports' && i?.method === 'POST' ? { status: 202, body: { import: { id: 'i1' } } } : undefined),
      (u) => (u === '/api/admin/imports' ? { body: { imports: [] } } : undefined),
    ]);
    renderApp(<Admin />);
    await userEvent.click(screen.getByRole('tab', { name: 'New import' }));
    const start = screen.getByRole('button', { name: /Start import/ });
    expect(start).toBeDisabled();
    const file = new File(['external_ref,name,category\nA1,Widget,Tools\nA2,,Tools\n'], 'p.csv', { type: 'text/csv' });
    await userEvent.upload(screen.getByLabelText(/CSV file/), file);
    await userEvent.click(screen.getByRole('button', { name: 'Validate & preview' }));
    expect(await screen.findByText(/Line 3: name: Too small/)).toBeInTheDocument();
    expect(screen.getByText('Widget')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Start import \(1 valid rows\)/ }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/admin/imports' && c.init?.method === 'POST')).toBe(true));
    expect(await screen.findByRole('tab', { name: 'Imports', selected: true })).toBeInTheDocument();
  });
  it('lists failed jobs with a working retry', async () => {
    let retried = false;
    const calls = mockApi([
      (u, i) => (u.startsWith('/api/admin/jobs/j1/retry') && i?.method === 'POST' ? ((retried = true), { status: 202, body: { ok: true } }) : undefined),
      (u) => (u.startsWith('/api/admin/jobs') ? { body: { queue: { mode: 'inline', counts: null }, jobs: [{ id: 'j1', type: 'REFRESH_SOURCE', status: retried ? 'QUEUED' : 'FAILED', attempts: 3, maxAttempts: 3, lastError: 'upstream 503', source: 'Flaky', createdAt: '2026-01-01T00:00:00Z' }] } } : undefined),
    ]);
    renderApp(<Admin />);
    await userEvent.click(screen.getByRole('tab', { name: 'Jobs & queue' }));
    expect(await screen.findByText('upstream 503')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('/retry'))).toBe(true));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument());
  });
});
