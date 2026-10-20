import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../lib/hooks';
import type { CompareResult } from '../lib/types';
import { CompareTable } from '../components/CompareTable';
import { Empty, ErrorBox, PageHeader, Spinner } from '../components/ui';

export function Compare() {
  const [params, setParams] = useSearchParams();
  const ids = params.get('ids') ?? '';
  const currency = params.get('currency') ?? '';
  const valid = ids.split(',').filter(Boolean).length >= 2;
  const { data, error, loading, reload } = useApi<CompareResult>(valid ? `/products/compare?ids=${encodeURIComponent(ids)}${currency ? `&currency=${currency}` : ''}` : null);

  if (!valid) return <Empty title="Select at least two products to compare"><Link className="text-brand-700 underline" to="/app/catalog">Go to the catalog</Link></Empty>;
  return (
    <div>
      <PageHeader title="Compare products">
        {data && data.availableCurrencies.length > 1 && (
          <div className="flex items-center gap-2">
            <label htmlFor="cur" className="text-sm">Currency</label>
            <select id="cur" className="input w-28" value={data.currency ?? ''} onChange={(e) => setParams({ ids, currency: e.target.value })}>
              {data.availableCurrencies.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        )}
      </PageHeader>
      {loading && !data ? <Spinner label="Comparing" /> : error ? <ErrorBox error={error} onRetry={reload} /> : <CompareTable result={data!} />}
    </div>
  );
}
