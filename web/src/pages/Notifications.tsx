import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { Empty, ErrorBox, PageHeader, Spinner } from '../components/ui';
import { formatDateTime } from '../lib/format';

interface N { id: string; title: string; body: string; productId: string | null; read: boolean; createdAt: string }

export function Notifications() {
  const { data, error, loading, reload } = useApi<{ unread: number; notifications: N[] }>('/me/notifications');
  if (loading && !data) return <Spinner label="Loading inbox" />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <div>
      <PageHeader title="Notification inbox">
        <button className="btn-secondary" disabled={data!.unread === 0} onClick={async () => { await api('/me/notifications/read-all', { method: 'POST' }); await reload(); }}>Mark all as read</button>
      </PageHeader>
      {data!.notifications.length === 0 ? <Empty title="Your inbox is empty">Alerts appear here when a recorded price meets your target.</Empty> : (
        <ul className="space-y-3">
          {data!.notifications.map((n) => (
            <li key={n.id} className={`card ${n.read ? '' : 'border-brand-500 bg-brand-50'}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><p className="font-semibold">{!n.read && <span className="mr-2 rounded-full bg-brand-600 px-2 py-0.5 text-xs text-white">New</span>}{n.title}</p>
                  <p className="text-sm text-slate-700">{n.body}</p>
                  <p className="mt-1 text-xs text-slate-500">{formatDateTime(n.createdAt)}</p></div>
                <div className="flex gap-2">
                  {n.productId && <Link className="btn-secondary px-3 py-1" to={`/app/products/${n.productId}`}>View product</Link>}
                  {!n.read && <button className="btn-secondary px-3 py-1" onClick={async () => { await api(`/me/notifications/${n.id}/read`, { method: 'POST' }); await reload(); }}>Mark read</button>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
