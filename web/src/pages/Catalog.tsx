import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApi } from '../lib/hooks';
import type { ProductCardData } from '../lib/types';
import { ProductCard } from '../components/ProductCard';
import { Empty, ErrorBox, PageHeader, Spinner } from '../components/ui';
import { addToDefaultWishlist } from '../lib/wishlist';

interface Res { total: number; page: number; pageSize: number; items: ProductCardData[] }

export function Catalog() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const q = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  const sort = params.get('sort') ?? 'name';
  const page = Number(params.get('page') ?? '1');
  const [text, setText] = useState(q);
  const [selected, setSelected] = useState<string[]>([]);
  const [msg, setMsg] = useState('');

  useEffect(() => setText(q), [q]);

  const qs = new URLSearchParams({ sort, page: String(page), pageSize: '12', ...(q ? { q } : {}), ...(category ? { category } : {}) });
  const { data, error, loading, reload } = useApi<Res>(`/products?${qs}`);
  const cats = useApi<{ categories: { name: string; count: number }[] }>('/products/categories');

  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < 4 ? [...s, id] : s));
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <PageHeader title="Product catalog">
        <button className="btn-primary" disabled={selected.length < 2} onClick={() => nav(`/app/compare?ids=${selected.join(',')}`)}>Compare selected ({selected.length})</button>
        {selected.length > 0 && <button className="btn-secondary" onClick={() => setSelected([])}>Clear selection</button>}
      </PageHeader>
      <form role="search" className="card mb-4 grid gap-3 sm:grid-cols-[1fr_200px_160px_auto]" onSubmit={(e) => { e.preventDefault(); set({ q: text.trim() }); }}>
        <div><label className="label" htmlFor="q">Search</label><input id="q" className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Name, brand or SKU" /></div>
        <div><label className="label" htmlFor="cat">Category</label>
          <select id="cat" className="input" value={category} onChange={(e) => set({ category: e.target.value })}>
            <option value="">All categories</option>
            {cats.data?.categories.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
          </select></div>
        <div><label className="label" htmlFor="sort">Sort</label>
          <select id="sort" className="input" value={sort} onChange={(e) => set({ sort: e.target.value })}><option value="name">Name</option><option value="newest">Newest</option></select></div>
        <div className="flex items-end gap-2"><button className="btn-primary">Search</button>{(q || category) && <button type="button" className="btn-secondary" onClick={() => setParams(new URLSearchParams())}>Reset</button>}</div>
      </form>
      <p role="status" aria-live="polite" className="mb-2 min-h-5 text-sm text-slate-600">{msg}</p>
      {loading && !data ? <Spinner label="Loading products" /> : error ? <ErrorBox error={error} onRetry={reload} /> : data!.items.length === 0 ? (
        <Empty title="No products match your filters">Try a different search term or reset the filters.</Empty>
      ) : (
        <>
          <p className="mb-2 text-sm text-slate-600">{data!.total} product(s)</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data!.items.map((p) => <ProductCard key={p.id} p={p} selected={selected.includes(p.id)} compareDisabled={selected.length >= 4} onToggleCompare={toggle} onAddWishlist={async (id) => setMsg(await addToDefaultWishlist(id))} />)}
          </div>
          <nav aria-label="Pagination" className="mt-6 flex items-center justify-center gap-3">
            <button className="btn-secondary" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>Previous</button>
            <span className="text-sm">Page {page} of {pages}</span>
            <button className="btn-secondary" disabled={page >= pages} onClick={() => set({ page: String(page + 1) })}>Next</button>
          </nav>
        </>
      )}
    </div>
  );
}
