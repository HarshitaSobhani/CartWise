import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { api } from '../lib/api';

const links = [
  ['/app', 'Dashboard'], ['/app/catalog', 'Catalog'], ['/app/wishlists', 'Wishlists'], ['/app/alerts', 'Alerts'], ['/app/budgets', 'Budgets'],
] as const;

export function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    const tick = () => api<{ unread: number }>('/me/notifications').then((r) => live && setUnread(r.unread)).catch(() => undefined);
    void tick();
    const t = setInterval(tick, 60_000);
    return () => { live = false; clearInterval(t); };
  }, []);

  const cls = ({ isActive }: { isActive: boolean }) => `rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-100'}`;
  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2">Skip to content</a>
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/app" className="text-lg font-bold text-brand-700">CartWise</Link>
          <button className="btn-secondary md:hidden" aria-expanded={open} aria-controls="main-nav" onClick={() => setOpen(!open)}>Menu</button>
          <nav id="main-nav" aria-label="Main" className={`${open ? 'flex' : 'hidden'} absolute left-0 right-0 top-14 z-40 flex-col gap-1 border-b bg-white p-3 md:static md:flex md:flex-row md:items-center md:border-0 md:p-0`}>
            {links.map(([to, label]) => <NavLink key={to} to={to} end={to === '/app'} className={cls} onClick={() => setOpen(false)}>{label}</NavLink>)}
            {user?.role === 'ADMIN' && <NavLink to="/app/admin" className={cls} onClick={() => setOpen(false)}>Admin</NavLink>}
            <NavLink to="/app/notifications" className={cls} onClick={() => setOpen(false)}>
              Inbox{unread > 0 && <span className="ml-1.5 rounded-full bg-red-600 px-1.5 py-0.5 text-xs text-white" aria-label={`${unread} unread`}>{unread}</span>}
            </NavLink>
            <NavLink to="/app/settings" className={cls} onClick={() => setOpen(false)}>Settings</NavLink>
            <button className="btn-secondary md:ml-2" onClick={async () => { await logout(); nav('/'); }}>Sign out</button>
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-6"><Outlet /></main>
      <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-slate-500">Catalog prices labelled “Demo data” are synthetic and for demonstration only.</footer>
    </div>
  );
}
