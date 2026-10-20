import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useApi } from '../lib/hooks';
import type { AlertData, Coverage, Point, Stats } from '../lib/types';
import { formatDate, formatDateTime, formatMoney } from '../lib/format';
import { Change, DemoBadge, ErrorBox, Field, FreshnessBadge, PageHeader, Price, Spinner } from '../components/ui';
import { PriceChart } from '../components/PriceChart';
import { addToDefaultWishlist } from '../lib/wishlist';

interface Detail {
  product: { id: string; name: string; brand: string | null; category: string; description: string | null; specs: Record<string, string> | null; identifiers: { type: string; value: string }[]; source: { name: string; isDemo: boolean; lastSyncedAt: string | null } };
  stats: Stats; coverage: Coverage[]; alerts: AlertData[];
}
interface History { stats: Stats; points: Point[] }

const RANGES = [['30', '30 days'], ['90', '90 days'], ['365', '1 year'], ['', 'All time']] as const;

export function ProductDetail() {
  const { id } = useParams();
  const detail = useApi<Detail>(`/products/${id}`);
  const [currency, setCurrency] = useState('');
  const [days, setDays] = useState('90');
  const [msg, setMsg] = useState('');

  const cur = currency || detail.data?.stats.latest?.currency || '';
  const histPath = detail.data ? `/products/${id}/history?${new URLSearchParams({ ...(days ? { days } : {}), ...(cur ? { currency: cur } : {}) })}` : null;
  const history = useApi<History>(histPath);

  if (detail.loading && !detail.data) return <Spinner label="Loading product" />;
  if (detail.error) return <ErrorBox error={detail.error} onRetry={detail.reload} />;
  const { product, stats, coverage, alerts } = detail.data!;
  const h = history.data?.stats;

  return (
    <div>
      <p className="mb-2 text-sm"><Link className="text-brand-700 underline" to="/app/catalog">← Catalog</Link></p>
      <PageHeader title={product.name}>
        <button className="btn-secondary" onClick={async () => setMsg(await addToDefaultWishlist(product.id))}>Add to wishlist</button>
        <a className="btn-secondary" href={`/api/exports/price-history.csv?productId=${product.id}`}>Export price history (CSV)</a>
      </PageHeader>
      <p role="status" aria-live="polite" className="mb-3 min-h-5 text-sm text-slate-700">{msg}</p>
      <p className="mb-4 text-slate-600">{[product.brand, product.category].filter(Boolean).join(' · ')}{product.description ? ` — ${product.description}` : ''}</p>

      {stats.currencyMismatch && <div role="alert" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Observations exist in multiple currencies ({stats.currencies.join(', ')}). They are shown separately and never converted or compared.</div>}

      <section aria-labelledby="summary" className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <h2 id="summary" className="sr-only">Price summary</h2>
        <div className="card"><p className="text-sm text-slate-600">Latest recorded</p>{stats.latest ? <><Price price={stats.latest.price} currency={stats.latest.currency} /><p className="text-xs text-slate-500">{formatDateTime(stats.latest.observedAt)}</p></> : <p>No observations</p>}</div>
        <div className="card"><p className="text-sm text-slate-600">Change vs previous ({cur || '—'})</p>{h?.changeVsPrevious ? <p className="text-lg font-semibold"><Change percent={h.changeVsPrevious.percent} /></p> : <p>n/a (needs two comparable observations)</p>}</div>
        <div className="card"><p className="text-sm text-slate-600">Lowest recorded in range</p>{h?.lowestRecorded ? <><Price price={h.lowestRecorded.price} currency={h.lowestRecorded.currency} /><p className="text-xs text-slate-500">{formatDate(h.lowestRecorded.observedAt)} — from stored observations only</p></> : <p>n/a</p>}</div>
        <div className="card"><p className="text-sm text-slate-600">Data freshness</p><FreshnessBadge f={stats.freshness} /><p className="mt-1 text-xs text-slate-500">{stats.count} observation(s) in total</p></div>
      </section>

      <section aria-labelledby="hist" className="card mb-6">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 id="hist" className="text-lg font-semibold">Price history</h2>
          <div className="flex gap-3">
            {stats.currencies.length > 1 && (
              <div><label className="label" htmlFor="chart-cur">Currency</label><select id="chart-cur" className="input" value={cur} onChange={(e) => setCurrency(e.target.value)}>{stats.currencies.map((c) => <option key={c}>{c}</option>)}</select></div>
            )}
            <div><label className="label" htmlFor="range">Range</label><select id="range" className="input" value={days} onChange={(e) => setDays(e.target.value)}>{RANGES.map(([v, l]) => <option key={l} value={v}>{l}</option>)}</select></div>
          </div>
        </div>
        {history.loading && !history.data ? <Spinner label="Loading history" /> : history.error ? <ErrorBox error={history.error} onRetry={history.reload} /> : <PriceChart points={history.data!.points} currency={cur} />}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="cov" className="card">
          <h2 id="cov" className="mb-2 text-lg font-semibold">Source coverage & attribution</h2>
          {coverage.length === 0 ? <p className="text-slate-600">No sources have reported a price for this product.</p> : (
            <ul className="divide-y">{coverage.map((c) => (
              <li key={`${c.sourceId}${c.currency}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div><p className="font-medium">{c.sourceName} <DemoBadge demo={c.isDemo} /></p><p className="text-xs text-slate-500">{c.observationCount} observation(s) in {c.currency} · latest {formatMoney(c.latest.price, c.currency)} on {formatDate(c.latest.observedAt)}{c.latest.sourceUrl ? <> · <a className="underline" href={c.latest.sourceUrl} rel="noopener noreferrer" target="_blank">source link</a></> : null}</p></div>
                <FreshnessBadge f={c.freshness} />
              </li>
            ))}</ul>
          )}
          {product.source.lastSyncedAt && <p className="mt-2 text-xs text-slate-500">Source last refreshed {formatDateTime(product.source.lastSyncedAt)}</p>}
        </section>
        <AlertPanel productId={product.id} alerts={alerts} defaultCurrency={stats.latest?.currency ?? 'USD'} currencies={stats.currencies} onChange={detail.reload} />
      </div>

      {(Object.keys(product.specs ?? {}).length > 0 || product.identifiers.length > 0) && (
        <section aria-labelledby="specs" className="card mt-6">
          <h2 id="specs" className="mb-2 text-lg font-semibold">Details</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
            {Object.entries(product.specs ?? {}).map(([k, v]) => <div key={k}><dt className="text-slate-500">{k}</dt><dd>{v}</dd></div>)}
            {product.identifiers.map((i) => <div key={i.type + i.value}><dt className="text-slate-500">{i.type}</dt><dd>{i.value}</dd></div>)}
          </dl>
        </section>
      )}
    </div>
  );
}

function AlertPanel({ productId, alerts, defaultCurrency, currencies, onChange }: { productId: string; alerts: AlertData[]; defaultCurrency: string; currencies: string[]; onChange: () => void }) {
  const [target, setTarget] = useState('');
  const [currency, setCurrency] = useState(defaultCurrency);
  const [email, setEmail] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api('/me/alerts', { method: 'POST', body: { productId, targetPrice: target, currency, notifyInApp: true, notifyEmail: email } });
      setTarget('');
      onChange();
    } catch (x) { setErr(errorMessage(x)); } finally { setBusy(false); }
  }
  const labels: Record<string, string> = { 'no-data': 'No price data yet', 'currency-mismatch': 'No observations in this currency', 'above-target': 'Above target', met: 'Target met by latest observation' };
  return (
    <section aria-labelledby="alert" className="card">
      <h2 id="alert" className="mb-2 text-lg font-semibold">Target price alert</h2>
      {alerts.map((a) => (
        <div key={a.id} className="mb-3 rounded-lg bg-slate-50 p-3 text-sm">
          <p>Target <strong>{formatMoney(a.targetPrice, a.currency)}</strong> · {a.status.toLowerCase()}</p>
          <p className={a.target.status === 'met' ? 'text-emerald-700' : 'text-slate-600'}>{labels[a.target.status]}{a.target.latestPrice ? ` (latest ${formatMoney(a.target.latestPrice, a.currency)})` : ''}</p>
        </div>
      ))}
      <form onSubmit={submit} className="space-y-3">
        {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
        <div className="grid grid-cols-[1fr_96px] gap-2">
          <Field label="Target price" id="target"><input id="target" className="input" inputMode="decimal" required value={target} onChange={(e) => setTarget(e.target.value)} placeholder="e.g. 199.99" /></Field>
          <Field label="Currency" id="tcur">
            <input id="tcur" className="input" list="cur-list" maxLength={3} required value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
            <datalist id="cur-list">{currencies.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> Also email me (needs email notifications enabled in Settings and server mail config)</label>
        <button className="btn-primary" disabled={busy}>Set alert</button>
      </form>
      <p className="mt-2 text-xs text-slate-500">Alerts fire only when a newly recorded observation in the same currency is at or below your target.</p>
    </section>
  );
}
