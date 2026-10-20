import { Link } from 'react-router-dom';
import type { ProductCardData } from '../lib/types';
import { formatDate } from '../lib/format';
import { DemoBadge, FreshnessBadge, Price } from './ui';

export function ProductCard({ p, selected, onToggleCompare, onAddWishlist, compareDisabled }: {
  p: ProductCardData; selected: boolean; compareDisabled: boolean;
  onToggleCompare: (id: string) => void; onAddWishlist: (id: string) => void;
}) {
  return (
    <article className="card flex flex-col gap-3" aria-label={p.name}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold leading-tight"><Link className="hover:underline" to={`/app/products/${p.id}`}>{p.name}</Link></h3>
          <p className="text-xs text-slate-500">{[p.brand, p.category].filter(Boolean).join(' · ')}</p>
        </div>
        {p.latest ? <DemoBadge demo={p.latest.isDemo} /> : null}
      </div>
      {p.latest ? (
        <div>
          <Price price={p.latest.price} currency={p.latest.currency} />
          <p className="text-xs text-slate-500">Observed {formatDate(p.latest.observedAt)} via {p.latest.sourceName}</p>
          {p.otherCurrencies.length > 0 && <p className="text-xs text-amber-700">Also recorded in {p.otherCurrencies.join(', ')} (not converted)</p>}
        </div>
      ) : (
        <p className="text-sm text-slate-600">No price observations yet.</p>
      )}
      <FreshnessBadge f={p.freshness} />
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" aria-label={`Compare ${p.name}`} checked={selected} disabled={compareDisabled && !selected} onChange={() => onToggleCompare(p.id)} />
          Compare
        </label>
        <button className="btn-secondary ml-auto px-3 py-1" onClick={() => onAddWishlist(p.id)} aria-label={`Add ${p.name} to wishlist`}>+ Wishlist</button>
      </div>
    </article>
  );
}
