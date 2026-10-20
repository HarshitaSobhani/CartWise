import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { AuthProvider } from '../src/auth';
import type { ReactNode } from 'react';

type Handler = (url: string, init?: RequestInit) => { status?: number; body?: unknown } | undefined;

/** Mock fetch with route handlers; first handler returning a value wins. */
export function mockApi(handlers: Handler[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    for (const h of handlers) {
      const r = h(url, init);
      if (r) return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body ?? {} } as Response;
    }
    return { ok: false, status: 404, json: async () => ({ error: `unmocked ${url}` }) } as Response;
  }));
  return calls;
}

export const ME = { user: { id: 'u1', email: 'a@b.c', name: 'Ann', role: 'USER', emailNotifs: false, inAppNotifs: true } };

export function renderApp(ui: ReactNode, route = '/') {
  return render(<MemoryRouter initialEntries={[route]}><AuthProvider>{ui}</AuthProvider></MemoryRouter>);
}
