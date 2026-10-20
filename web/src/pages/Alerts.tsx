import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useApi } from '../lib/hooks';
import type { AlertData } from '../lib/types';
import { Empty, ErrorBox, PageHeader, Spinner } from '../components/ui';
import { formatMoney } from '../lib/format';

export function Alerts() {
  const { data, error, loading, reload } = useApi<{ alerts: AlertData[] }>('/me/alerts');
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState('');

  async function act(fn: () => Promise<unknown>) {
    setErr(null);
    try { await fn(); setEditing(null); await reload(); } catch (e) { setErr(errorMessage(e)); }
  }
  if (loading && !data) return <Spinner label="Loading alerts" />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const label: Record<string, string> = { 'no-data': 'No price data', 'currency-mismatch': 'No observations in this currency', 'above-target': 'Above target', met: 'Target met' };
  return (
    <div>
      <PageHeader title="Price alerts"><a className="btn-secondary" href="/api/exports/alerts.csv">Export (CSV)</a></PageHeader>
      {err && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{err}</p>}
      {data!.alerts.length === 0 ? <Empty title="No alerts yet">Open a <Link className="text-brand-700 underline" to="/app/catalog">product</Link> and set a target price.</Empty> : (
        <ul className="space-y-3">
          {data!.alerts.map((a) => (
            <li key={a.id} className="card flex flex-wrap items-center gap-3">
              <div className="min-w-48 flex-1">
                <Link className="font-medium hover:underline" to={`/app/products/${a.product!.id}`}>{a.product!.name}</Link>
                <p className="text-sm text-slate-600">Target {formatMoney(a.targetPrice, a.currency)} · {a.target.latestPrice ? `latest ${formatMoney(a.target.latestPrice, a.currency)} · ` : ''}{label[a.target.status]}</p>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${a.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : a.status === 'TRIGGERED' ? 'bg-brand-100 text-brand-700' : 'bg-slate-200 text-slate-700'}`}>{a.status === 'TRIGGERED' ? 'Triggered' : a.status === 'ACTIVE' ? 'Active' : 'Paused'}</span>
              {editing === a.id ? (
                <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void act(() => api(`/me/alerts/${a.id}`, { method: 'PATCH', body: { targetPrice: value } })); }}>
                  <label className="sr-only" htmlFor={`t-${a.id}`}>New target price</label>
                  <input id={`t-${a.id}`} className="input w-28" inputMode="decimal" required value={value} onChange={(e) => setValue(e.target.value)} />
                  <button className="btn-primary px-3 py-1">Save</button>
                  <button type="button" className="btn-secondary px-3 py-1" onClick={() => setEditing(null)}>Cancel</button>
                </form>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button className="btn-secondary px-3 py-1" onClick={() => { setEditing(a.id); setValue(a.targetPrice); }}>Edit target</button>
                  {a.status === 'ACTIVE' ? <button className="btn-secondary px-3 py-1" onClick={() => act(() => api(`/me/alerts/${a.id}`, { method: 'PATCH', body: { status: 'PAUSED' } }))}>Pause</button>
                    : <button className="btn-secondary px-3 py-1" onClick={() => act(() => api(`/me/alerts/${a.id}`, { method: 'PATCH', body: { status: 'ACTIVE' } }))}>{a.status === 'TRIGGERED' ? 'Re-arm' : 'Resume'}</button>}
                  <button className="btn-danger px-3 py-1" aria-label={`Delete alert for ${a.product!.name}`} onClick={() => act(() => api(`/me/alerts/${a.id}`, { method: 'DELETE' }))}>Delete</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
