import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useApi } from '../src/lib/hooks';
import { mockApi } from './helpers';

describe('useApi', () => {
  it('reports loading (not an empty ready state) when a path appears after mount', async () => {
    mockApi([() => ({ body: { ok: 1 } })]);
    const { result, rerender } = renderHook(({ p }: { p: string | null }) => useApi<{ ok: number }>(p), { initialProps: { p: null as string | null } });
    expect(result.current.loading).toBe(false);
    rerender({ p: '/x' });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data).toEqual({ ok: 1 }));
    expect(result.current.loading).toBe(false);
  });
  it('exposes errors', async () => {
    mockApi([() => ({ status: 500, body: { error: 'boom' } })]);
    const { result } = renderHook(() => useApi('/x'));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.loading).toBe(false);
  });
});
