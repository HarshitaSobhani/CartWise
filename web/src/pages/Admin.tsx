import { useState, type ChangeEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { useApi } from '../lib/hooks';
import { Empty, ErrorBox, PageHeader, Spinner } from '../components/ui';
import { formatDateTime } from '../lib/format';

type Tab = 'overview' | 'import' | 'imports' | 'jobs' | 'sources' | 'quality';
const TABS: [Tab, string][] = [['overview', 'Overview'], ['import', 'New import'], ['imports', 'Imports'], ['jobs', 'Jobs & queue'], ['sources', 'Sources'], ['quality', 'Data quality']];

export function Admin() {
  const [tab, setTab] = useState<Tab>('overview');
  return (
    <div>
      <PageHeader title="Administration" />
      <div role="tablist" aria-label="Admin sections" className="mb-4 flex flex-wrap gap-1 border-b">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" id={`tab-${k}`} aria-selected={tab === k} aria-controls="panel" onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>{l}</button>
        ))}
      </div>
      <div role="tabpanel" id="panel" aria-labelledby={`tab-${tab}`}>
        {tab === 'overview' && <Overview />}
        {tab === 'import' && <NewImport onDone={() => setTab('imports')} />}
        {tab === 'imports' && <Imports />}
        {tab === 'jobs' && <Jobs />}
        {tab === 'sources' && <Sources />}
        {tab === 'quality' && <Quality />}
      </div>
    </div>
  );
}

function Overview() {
  const { data, error, loading, reload } = useApi<{ users: number; products: number; observations: number; failedJobs: number; pendingJobs: number; queue: { mode: string; counts: Record<string, number> | null } }>('/admin/overview');
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const d = data!;
  return (
    <dl className="grid grid-cols-2 gap-4 lg:grid-cols-3">
      {[['Users', d.users], ['Products', d.products], ['Price observations', d.observations], ['Failed jobs', d.failedJobs], ['Pending jobs', d.pendingJobs], ['Queue mode', d.queue.mode === 'redis' ? 'Redis / BullMQ' : 'Inline (no Redis)']].map(([k, v]) => (
        <div key={String(k)} className="card"><dt className="text-sm text-slate-600">{k}</dt><dd className="text-2xl font-bold">{v}</dd></div>
      ))}
    </dl>
  );
}

function NewImport({ onDone }: { onDone: () => void }) {
  const [type, setType] = useState<'CSV_PRODUCTS' | 'CSV_PRICES'>('CSV_PRODUCTS');
  const [filename, setFilename] = useState('');
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<{ totalRows: number; validRows: number; errorRows: number; fatal: string | null; errors: { line: number; message: string }[]; preview: Record<string, unknown>[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setPreview(null); setErr(null);
    if (f.size > 2 * 1024 * 1024) { setErr('File is larger than 2 MB.'); return; }
    setFilename(f.name);
    setCsv(await f.text());
  }
  async function run(path: string, then: (r: never) => void) {
    setBusy(true); setErr(null);
    try { then((await api(path, { method: 'POST', body: { type, filename, csv } })) as never); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  const cols = preview?.preview[0] ? Object.keys(preview.preview[0]).filter((k) => k !== 'identifiers') : [];
  return (
    <div className="card space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label" htmlFor="imp-type">Import type</label>
          <select id="imp-type" className="input" value={type} onChange={(e) => { setType(e.target.value as typeof type); setPreview(null); }}>
            <option value="CSV_PRODUCTS">Products (external_ref, name, category, brand, description, image_url, gtin, sku)</option>
            <option value="CSV_PRICES">Price history (external_ref, price, currency, observed_at, source_url)</option>
          </select></div>
        <div><label className="label" htmlFor="imp-file">CSV file (max 2 MB, 5000 rows)</label><input id="imp-file" type="file" accept=".csv,text/csv" className="input" onChange={onFile} /></div>
      </div>
      {err && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{err}</p>}
      <div className="flex gap-2">
        <button className="btn-secondary" disabled={!csv || busy} onClick={() => run('/admin/imports/preview', setPreview)}>Validate & preview</button>
        <button className="btn-primary" disabled={!preview || preview.validRows === 0 || !!preview.fatal || busy} onClick={() => run('/admin/imports', () => onDone())}>Start import ({preview?.validRows ?? 0} valid rows)</button>
      </div>
      {preview && (
        <div aria-live="polite">
          <p className="text-sm"><strong>{preview.validRows}</strong> of {preview.totalRows} rows valid · <strong className={preview.errorRows ? 'text-red-700' : ''}>{preview.errorRows}</strong> with errors. Rows with errors are skipped; nothing is written until you start the import.</p>
          {preview.errors.length > 0 && (
            <div className="mt-2"><h3 className="text-sm font-semibold">Errors</h3>
              <ul className="max-h-48 list-disc overflow-auto pl-5 text-sm text-red-800">{preview.errors.map((e, i) => <li key={i}>Line {e.line}: {e.message}</li>)}</ul></div>
          )}
          {cols.length > 0 && (
            <div className="mt-3 overflow-x-auto"><table className="min-w-full text-xs"><caption className="sr-only">First valid rows</caption>
              <thead><tr className="border-b text-left">{cols.map((c) => <th key={c} scope="col" className="p-1">{c}</th>)}</tr></thead>
              <tbody>{preview.preview.map((r, i) => <tr key={i} className="border-b">{cols.map((c) => <td key={c} className="p-1">{String(r[c] ?? '')}</td>)}</tr>)}</tbody></table></div>
          )}
        </div>
      )}
    </div>
  );
}

const statusCls = (s: string) => (s === 'SUCCEEDED' ? 'bg-emerald-100 text-emerald-800' : s === 'FAILED' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800');

function Imports() {
  const { data, error, loading, reload } = useApi<{ imports: { id: string; type: string; filename: string; status: string; totalRows: number; okRows: number; errorRows: number; errors: { line: number; message: string }[]; createdAt: string; by: string; job: { attempts: number; maxAttempts: number; lastError: string | null } | null }[] }>('/admin/imports');
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <div className="space-y-3">
      <button className="btn-secondary" onClick={reload}>Refresh</button>
      {data!.imports.length === 0 ? <Empty title="No imports yet" /> : data!.imports.map((i) => (
        <article key={i.id} className="card" aria-label={`Import ${i.filename}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{i.filename} <span className="text-xs text-slate-500">({i.type === 'CSV_PRODUCTS' ? 'products' : 'prices'} · {i.by} · {formatDateTime(i.createdAt)})</span></p>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusCls(i.status)}`}>{i.status}</span>
          </div>
          <p className="text-sm text-slate-700">{i.okRows} imported · {i.errorRows} errors · {i.totalRows} rows{i.job ? ` · attempts ${i.job.attempts}/${i.job.maxAttempts}` : ''}</p>
          {i.job?.lastError && <p className="text-sm text-red-700">Failure: {i.job.lastError}</p>}
          {i.errors.length > 0 && <details className="mt-1 text-sm"><summary className="cursor-pointer">Row errors ({i.errors.length})</summary><ul className="list-disc pl-5 text-red-800">{i.errors.slice(0, 50).map((e, k) => <li key={k}>Line {e.line}: {e.message}</li>)}</ul></details>}
        </article>
      ))}
    </div>
  );
}

function Jobs() {
  const [status, setStatus] = useState('');
  const { data, error, loading, reload } = useApi<{ queue: { mode: string; counts: Record<string, number> | null }; jobs: { id: string; type: string; status: string; attempts: number; maxAttempts: number; lastError: string | null; source: string | null; createdAt: string }[] }>(`/admin/jobs${status ? `?status=${status}` : ''}`);
  const [err, setErr] = useState<string | null>(null);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <div className="space-y-3">
      <div className="card text-sm">Queue: <strong>{data!.queue.mode === 'redis' ? 'Redis / BullMQ' : 'inline (REDIS_URL not set)'}</strong>{data!.queue.counts && <> · {Object.entries(data!.queue.counts).map(([k, v]) => `${k}: ${v}`).join(' · ')}</>}</div>
      <div className="flex items-end gap-3">
        <div><label className="label" htmlFor="job-status">Status</label><select id="job-status" className="input" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'].map((s) => <option key={s}>{s}</option>)}</select></div>
        <button className="btn-secondary" onClick={reload}>Refresh</button>
      </div>
      {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
      {data!.jobs.length === 0 ? <Empty title="No jobs" /> : (
        <div className="overflow-x-auto rounded-xl border bg-white"><table className="min-w-full text-sm"><caption className="sr-only">Background jobs</caption>
          <thead><tr className="border-b bg-slate-50 text-left"><th scope="col" className="p-2">Type</th><th scope="col">Source</th><th scope="col">Status</th><th scope="col">Attempts</th><th scope="col">Last error</th><th scope="col">Created</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{data!.jobs.map((j) => (
            <tr key={j.id} className="border-b"><td className="p-2">{j.type}</td><td>{j.source ?? '—'}</td><td><span className={`rounded-full px-2 py-0.5 text-xs ${statusCls(j.status)}`}>{j.status}</span></td><td>{j.attempts}/{j.maxAttempts}</td><td className="max-w-xs truncate text-red-700" title={j.lastError ?? ''}>{j.lastError ?? '—'}</td><td>{formatDateTime(j.createdAt)}</td>
              <td>{j.status === 'FAILED' && <button className="btn-secondary px-3 py-1" onClick={async () => { try { await api(`/admin/jobs/${j.id}/retry`, { method: 'POST' }); await reload(); } catch (e) { setErr(errorMessage(e)); } }}>Retry</button>}</td></tr>
          ))}</tbody></table></div>
      )}
    </div>
  );
}

function Sources() {
  const { data, error, loading, reload } = useApi<{ sources: { id: string; name: string; kind: string; isDemo: boolean; enabled: boolean; lastSyncedAt: string | null; hasAdapter: boolean; products: number; observations: number }[] }>('/admin/sources');
  const [msg, setMsg] = useState('');
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <div className="space-y-3">
      <p role="status" aria-live="polite" className="min-h-5 text-sm">{msg}</p>
      {data!.sources.map((s) => (
        <article key={s.id} className="card flex flex-wrap items-center justify-between gap-3" aria-label={s.name}>
          <div><p className="font-medium">{s.name} {s.isDemo && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Demo</span>}</p>
            <p className="text-sm text-slate-600">{s.kind} · {s.products} products · {s.observations} observations · last refreshed {s.lastSyncedAt ? formatDateTime(s.lastSyncedAt) : 'never'}</p></div>
          <div className="flex gap-2">
            <button className="btn-secondary px-3 py-1" onClick={async () => { await api(`/admin/sources/${s.id}`, { method: 'PATCH', body: { enabled: !s.enabled } }); await reload(); }}>{s.enabled ? 'Disable' : 'Enable'}</button>
            <button className="btn-primary px-3 py-1" disabled={!s.hasAdapter || !s.enabled} title={s.hasAdapter ? '' : 'CSV sources are updated by import'} onClick={async () => { try { await api(`/admin/sources/${s.id}/refresh`, { method: 'POST' }); setMsg(`Refresh queued for ${s.name}. See Jobs & queue.`); } catch (e) { setMsg(errorMessage(e)); } }}>Refresh now</button>
          </div>
        </article>
      ))}
    </div>
  );
}

function Quality() {
  const { data, error, loading, reload } = useApi<{ staleAfterHours: number; noData: { id: string; name: string }[]; stale: { id: string; name: string; lastObservedAt: string }[]; mixedCurrency: { id: string; name: string; currencies: string[] }[]; noIdentifiers: { id: string; name: string }[]; failedImports: { id: string; filename: string; status: string; errorRows: number }[] }>('/admin/data-quality');
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const d = data!;
  const Section = ({ title, items }: { title: string; items: string[] }) => (
    <section className="card"><h2 className="font-semibold">{title} ({items.length})</h2>{items.length === 0 ? <p className="text-sm text-emerald-700">No problems found.</p> : <ul className="mt-1 max-h-48 list-disc overflow-auto pl-5 text-sm">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>}</section>
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Products without any price observation" items={d.noData.map((p) => p.name)} />
      <Section title={`Stale products (no observation in ${d.staleAfterHours}h)`} items={d.stale.map((p) => `${p.name} — last ${formatDateTime(p.lastObservedAt)}`)} />
      <Section title="Products with multiple currencies" items={d.mixedCurrency.map((p) => `${p.name}: ${p.currencies.join(', ')}`)} />
      <Section title="Products without identifiers (SKU/GTIN)" items={d.noIdentifiers.map((p) => p.name)} />
      <Section title="Imports with failures or row errors" items={d.failedImports.map((i) => `${i.filename} — ${i.status}, ${i.errorRows} error row(s)`)} />
    </div>
  );
}
