import { Link } from 'react-router-dom';
import type { CompareResult } from '../lib/types';
import { formatDate } from '../lib/format';
import { Change, DemoBadge, FreshnessBadge, Price } from './ui';

export function CompareTable({ result }: { result: CompareResult }) {
  const specKeys = [...new Set(result.rows.flatMap((r) => Object.keys(r.product.specs ?? {})))];
  return (
    <div>
      {result.warning && (
        <div role="alert" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <strong>Currency mismatch.</strong> {result.warning}
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <caption className="sr-only">Product comparison{result.currency ? ` in ${result.currency}` : ''}</caption>
          <thead>
            <tr className="border-b bg-slate-50 text-left">
              <th scope="col" className="p-3">Attribute</th>
              {result.rows.map((r) => (
                <th scope="col" key={r.product.id} className="p-3 font-semibold">
                  <Link className="hover:underline" to={`/app/products/${r.product.id}`}>{r.product.name}</Link>
                  {result.cheapestProductId === r.product.id && <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">Lowest latest price</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            <Row label={`Latest recorded price${result.currency ? ` (${result.currency})` : ''}`}>
              {result.rows.map((r) => (
                <td key={r.product.id} className="p-3">
                  {r.latest ? <Price price={r.latest.price} currency={r.latest.currency} /> : <span className="text-slate-600">Not available — {r.missingReason}{r.currencies.length ? ` (has ${r.currencies.join(', ')})` : ''}</span>}
                </td>
              ))}
            </Row>
            <Row label="Observed">{result.rows.map((r) => <td key={r.product.id} className="p-3">{r.latest ? <>{formatDate(r.latest.observedAt)} <DemoBadge demo={r.latest.isDemo} /></> : '—'}</td>)}</Row>
            <Row label="Source">{result.rows.map((r) => <td key={r.product.id} className="p-3">{r.latest?.sourceName ?? '—'}</td>)}</Row>
            <Row label="Difference from lowest">{result.rows.map((r) => <td key={r.product.id} className="p-3">{r.differenceFromCheapest ? (r.differenceFromCheapest.amount === '0.00' ? 'Lowest' : <>+{r.differenceFromCheapest.amount} (<Change percent={r.differenceFromCheapest.percent} />)</>) : '—'}</td>)}</Row>
            <Row label="Change vs previous observation">{result.rows.map((r) => <td key={r.product.id} className="p-3">{r.changeVsPrevious ? <Change percent={r.changeVsPrevious.percent} /> : <span className="text-slate-500">n/a</span>}</td>)}</Row>
            <Row label="Lowest recorded">{result.rows.map((r) => <td key={r.product.id} className="p-3">{r.lowestRecorded && result.currency ? <Price price={r.lowestRecorded} currency={result.currency} /> : '—'}</td>)}</Row>
            <Row label="Data freshness">{result.rows.map((r) => <td key={r.product.id} className="p-3"><FreshnessBadge f={r.freshness} /></td>)}</Row>
            <Row label="Source coverage">{result.rows.map((r) => <td key={r.product.id} className="p-3">{r.sourceCount} source(s), {r.observationCount} observation(s)</td>)}</Row>
            <Row label="Category">{result.rows.map((r) => <td key={r.product.id} className="p-3">{r.product.category}</td>)}</Row>
            {specKeys.map((k) => (
              <Row key={k} label={k}>{result.rows.map((r) => <td key={r.product.id} className="p-3">{r.product.specs?.[k] ?? '—'}</td>)}</Row>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <th scope="row" className="whitespace-nowrap bg-slate-50 p-3 text-left font-medium text-slate-700">{label}</th>
      {children}
    </tr>
  );
}
