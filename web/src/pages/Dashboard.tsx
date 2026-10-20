import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { useApi } from '../lib/hooks';
import type { AlertData } from '../lib/types';
import { Empty, ErrorBox, PageHeader, Spinner } from '../components/ui';

interface Notif { id: string; title: string; body: string; read: boolean; createdAt: string }
interface Budget { id: string; name: string; currency: string; limit: string; spent: string; remaining: string; percentUsed: string | null; overBudget: boolean }
interface WL { id: string; name: string; items: { id: string }[] }

export function Dashboard() {
  const { user } = useAuth();
  const alerts = useApi<{ alerts: AlertData[] }>('/me/alerts');
  const notifs = useApi<{ unread: number; notifications: Notif[] }>('/me/notifications');
  const budgets = useApi<{ budgets: Budget[] }>('/me/budgets');
  const wl = useApi<{ wishlists: WL[] }>('/me/wishlists');

  if (alerts.loading || notifs.loading || budgets.loading || wl.loading) return <Spinner label="Loading dashboard" />;
  const err = alerts.error ?? notifs.error ?? budgets.error ?? wl.error;
  if (err) return <ErrorBox error={err} onRetry={() => { void alerts.reload(); void notifs.reload(); void budgets.reload(); void wl.reload(); }} />;

  const active = alerts.data!.alerts.filter((a) => a.status === 'ACTIVE');
  const met = alerts.data!.alerts.filter((a) => a.target.status === 'met');
  const items = wl.data!.wishlists.reduce((n, w) => n + w.items.length, 0);

  return (
    <div>
      <PageHeader title={`Welcome, ${user?.name}`}><Link className="btn-primary" to="/app/catalog">Browse catalog</Link></PageHeader>
      <dl className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[['Unread notifications', notifs.data!.unread], ['Active alerts', active.length], ['Targets currently met', met.length], ['Wishlist items', items]].map(([k, v]) => (
          <div key={String(k)} className="card"><dt className="text-sm text-slate-600">{k}</dt><dd className="text-3xl font-bold">{v}</dd></div>
        ))}
      </dl>
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="recent"><h2 id="recent" className="mb-2 text-lg font-semibold">Recent notifications</h2>
          {notifs.data!.notifications.length === 0 ? <Empty title="No notifications yet">Set a target price on a product to get alerted when a real observation meets it.</Empty> : (
            <ul className="space-y-2">{notifs.data!.notifications.slice(0, 5).map((n) => <li key={n.id} className={`card ${n.read ? '' : 'border-brand-500'}`}><p className="font-medium">{n.title}</p><p className="text-sm text-slate-600">{n.body}</p></li>)}</ul>
          )}
        </section>
        <section aria-labelledby="bud"><h2 id="bud" className="mb-2 text-lg font-semibold">Budgets</h2>
          {budgets.data!.budgets.length === 0 ? <Empty title="No budgets yet"><Link className="text-brand-700 underline" to="/app/budgets">Create a budget</Link></Empty> : (
            <ul className="space-y-2">{budgets.data!.budgets.map((b) => (
              <li key={b.id} className="card">
                <div className="flex justify-between"><span className="font-medium">{b.name}</span><span className={b.overBudget ? 'text-red-700' : 'text-slate-600'}>{b.currency} {b.spent} / {b.limit}</span></div>
                <progress className="mt-2 h-2 w-full" max={100} value={Math.min(100, Number(b.percentUsed ?? 0))} aria-label={`${b.name} budget used`} />
              </li>
            ))}</ul>
          )}
        </section>
      </div>
    </div>
  );
}
