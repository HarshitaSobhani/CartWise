import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { useApi } from '../lib/hooks';
import { Empty, ErrorBox, Field, PageHeader, Spinner } from '../components/ui';
import { formatDate, formatMoney } from '../lib/format';

interface B { id: string; name: string; currency: string; limit: string; spent: string; remaining: string; percentUsed: string | null; overBudget: boolean; expenses: { id: string; description: string; amount: string; spentAt: string }[] }

export function Budgets() {
  const { data, error, loading, reload } = useApi<{ budgets: B[] }>('/me/budgets');
  const [form, setForm] = useState({ name: '', currency: 'USD', limit: '' });
  const [err, setErr] = useState<string | null>(null);

  async function act(fn: () => Promise<unknown>) {
    setErr(null);
    try { await fn(); await reload(); } catch (e) { setErr(errorMessage(e)); }
  }
  async function create(e: FormEvent) {
    e.preventDefault();
    await act(() => api('/me/budgets', { method: 'POST', body: form }));
    setForm({ ...form, name: '', limit: '' });
  }
  if (loading && !data) return <Spinner label="Loading budgets" />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <div>
      <PageHeader title="Budgets"><a className="btn-secondary" href="/api/exports/budgets.csv">Export expenses (CSV)</a></PageHeader>
      {err && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{err}</p>}
      <form onSubmit={create} className="card mb-6 grid gap-3 sm:grid-cols-[1fr_100px_140px_auto] sm:items-end" aria-label="Create budget">
        <Field label="Budget name" id="b-name"><input id="b-name" className="input" required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Currency" id="b-cur"><input id="b-cur" className="input" required maxLength={3} minLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} /></Field>
        <Field label="Limit" id="b-limit"><input id="b-limit" className="input" required inputMode="decimal" value={form.limit} onChange={(e) => setForm({ ...form, limit: e.target.value })} /></Field>
        <button className="btn-primary">Create budget</button>
      </form>
      {data!.budgets.length === 0 ? <Empty title="No budgets yet">Create one above to start tracking spending.</Empty> : (
        <div className="space-y-6">{data!.budgets.map((b) => <BudgetCard key={b.id} b={b} act={act} />)}</div>
      )}
    </div>
  );
}

function BudgetCard({ b, act }: { b: B; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  return (
    <section className="card" aria-labelledby={`bud-${b.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`bud-${b.id}`} className="text-lg font-semibold">{b.name}</h2>
        <button className="btn-danger px-3 py-1" onClick={() => confirm(`Delete budget “${b.name}” and its expenses?`) && act(() => api(`/me/budgets/${b.id}`, { method: 'DELETE' }))}>Delete budget</button>
      </div>
      <p className={`mt-1 text-sm ${b.overBudget ? 'font-semibold text-red-700' : 'text-slate-700'}`}>
        {formatMoney(b.spent, b.currency)} spent of {formatMoney(b.limit, b.currency)} · {b.overBudget ? `over budget by ${formatMoney(String(Math.abs(Number(b.remaining))), b.currency)}` : `${formatMoney(b.remaining, b.currency)} remaining`}
      </p>
      <progress className="my-2 h-2 w-full" max={100} value={Math.min(100, Number(b.percentUsed ?? 0))} aria-label={`${b.name} used`} />
      <form className="mb-3 grid gap-2 sm:grid-cols-[1fr_140px_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); void act(() => api(`/me/budgets/${b.id}/expenses`, { method: 'POST', body: { description: desc, amount } })).then(() => { setDesc(''); setAmount(''); }); }}>
        <Field label="Expense description" id={`d-${b.id}`}><input id={`d-${b.id}`} className="input" required maxLength={200} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
        <Field label={`Amount (${b.currency})`} id={`a-${b.id}`}><input id={`a-${b.id}`} className="input" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <button className="btn-secondary">Add expense</button>
      </form>
      {b.expenses.length === 0 ? <p className="text-sm text-slate-600">No expenses recorded.</p> : (
        <table className="w-full text-sm"><caption className="sr-only">Expenses for {b.name}</caption>
          <thead><tr className="border-b text-left"><th scope="col" className="py-1">Date</th><th scope="col">Description</th><th scope="col" className="text-right">Amount</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{b.expenses.map((e) => (
            <tr key={e.id} className="border-b last:border-0"><td className="py-1">{formatDate(e.spentAt)}</td><td>{e.description}</td><td className="text-right tabular-nums">{formatMoney(e.amount, b.currency)}</td>
              <td className="text-right"><button className="text-red-700 underline" aria-label={`Delete expense ${e.description}`} onClick={() => act(() => api(`/me/budgets/${b.id}/expenses/${e.id}`, { method: 'DELETE' }))}>Delete</button></td></tr>
          ))}</tbody></table>
      )}
    </section>
  );
}
