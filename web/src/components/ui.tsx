import type { ReactNode } from 'react';
import type { Freshness } from '../lib/types';
import { formatAge, formatMoney, signedPercent } from '../lib/format';
import { errorMessage } from '../lib/api';

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2 p-6 text-slate-600">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <p>{errorMessage(error)}</p>
      {onRetry && <button className="btn-secondary mt-2" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <p className="font-medium text-slate-800">{title}</p>
      {children && <div className="mt-2 text-sm text-slate-600">{children}</div>}
    </div>
  );
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold">{title}</h1>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

export function DemoBadge({ demo }: { demo: boolean }) {
  return demo ? (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800" title="Synthetic demonstration data, not a real retailer price">Demo data</span>
  ) : (
    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800" title="Recorded from an imported or external source">Recorded</span>
  );
}

export function FreshnessBadge({ f }: { f: Freshness }) {
  if (f.status === 'none') return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">No price data</span>;
  const stale = f.status === 'stale';
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${stale ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'}`}>
      {stale ? 'Stale' : 'Fresh'} · {formatAge(f.ageHours)}
    </span>
  );
}

export function Price({ price, currency }: { price: string; currency: string }) {
  return <span className="font-semibold tabular-nums">{formatMoney(price, currency)}</span>;
}

export function Change({ percent }: { percent: string | null | undefined }) {
  if (percent === null || percent === undefined) return <span className="text-slate-500">n/a</span>;
  const n = Number(percent);
  const cls = n < 0 ? 'text-emerald-700' : n > 0 ? 'text-red-700' : 'text-slate-600';
  return <span className={`tabular-nums ${cls}`}>{signedPercent(percent)}</span>;
}

export function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}
