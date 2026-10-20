import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useApi } from '../lib/hooks';
import type { Freshness } from '../lib/types';
import { DemoBadge, Empty, ErrorBox, FreshnessBadge, PageHeader, Price, Spinner } from '../components/ui';
import { formatMoney } from '../lib/format';

interface Item { id: string; priority: number; note: string | null; product: { id: string; name: string; category: string }; latest: { price: string; currency: string; isDemo: boolean } | null; freshness: Freshness }
interface WL { id: string; name: string; items: Item[]; totalsByCurrency: Record<string, string> }

export function Wishlists() {
  const { data, error, loading, reload } = useApi<{ wishlists: WL[] }>('/me/wishlists');
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function act(fn: () => Promise<unknown>) {
    setErr(null);
    try { await fn(); await reload(); } catch (e) { setErr(errorMessage(e)); }
  }
  async function create(e: FormEvent) { e.preventDefault(); await act(() => api('/me/wishlists', { method: 'POST', body: { name } })); setName(''); }

  if (loading && !data) return <Spinner label="Loading wishlists" />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <div>
      <PageHeader title="Wishlists"><a className="btn-secondary" href="/api/exports/wishlists.csv">Export (CSV)</a></PageHeader>
      {err && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{err}</p>}
      <form onSubmit={create} className="card mb-6 flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1"><label className="label" htmlFor="wl-name">New wishlist name</label><input id="wl-name" className="input" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <button className="btn-primary">Create wishlist</button>
      </form>
      <div className="space-y-6">
        {data!.wishlists.map((w) => (
          <section key={w.id} className="card" aria-labelledby={`wl-${w.id}`}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 id={`wl-${w.id}`} className="text-lg font-semibold">{w.name}</h2>
              <button className="btn-danger px-3 py-1" onClick={() => confirm(`Delete wishlist “${w.name}”?`) && act(() => api(`/me/wishlists/${w.id}`, { method: 'DELETE' }))}>Delete list</button>
            </div>
            {w.items.length === 0 ? <Empty title="This wishlist is empty"><Link className="text-brand-700 underline" to="/app/catalog">Browse the catalog</Link> to add products.</Empty> : (
              <ul className="divide-y">
                {w.items.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-48 flex-1">
                      <Link className="font-medium hover:underline" to={`/app/products/${i.product.id}`}>{i.product.name}</Link>
                      <p className="text-xs text-slate-500">{i.product.category}</p>
                    </div>
                    <div className="text-sm">{i.latest ? <><Price price={i.latest.price} currency={i.latest.currency} /> <DemoBadge demo={i.latest.isDemo} /></> : 'No price data'}</div>
                    <FreshnessBadge f={i.freshness} />
                    <div>
                      <label className="sr-only" htmlFor={`prio-${i.id}`}>Priority for {i.product.name}</label>
                      <select id={`prio-${i.id}`} className="input w-36" value={i.priority} onChange={(e) => act(() => api(`/me/wishlists/${w.id}/items/${i.id}`, { method: 'PATCH', body: { priority: Number(e.target.value) } }))}>
                        {[1, 2, 3, 4, 5].map((p) => <option key={p} value={p}>Priority {p}{p === 1 ? ' (highest)' : p === 5 ? ' (lowest)' : ''}</option>)}
                      </select>
                    </div>
                    <button className="btn-danger px-3 py-1" aria-label={`Remove ${i.product.name}`} onClick={() => act(() => api(`/me/wishlists/${w.id}/items/${i.id}`, { method: 'DELETE' }))}>Remove</button>
                  </li>
                ))}
              </ul>
            )}
            {Object.keys(w.totalsByCurrency).length > 0 && (
              <p className="mt-3 text-sm text-slate-700">Latest recorded total: {Object.entries(w.totalsByCurrency).map(([c, t]) => formatMoney(t, c)).join(' + ')} <span className="text-slate-500">(currencies are not combined)</span></p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
