import { useState } from 'react';
import { useAuth } from '../auth';
import { api, errorMessage } from '../lib/api';
import type { User } from '../lib/types';
import { PageHeader } from '../components/ui';

export function Settings() {
  const { user, setUser } = useAuth();
  const [msg, setMsg] = useState('');
  if (!user) return null;
  async function save(patch: Partial<Pick<User, 'emailNotifs' | 'inAppNotifs'>>) {
    try { setUser((await api<{ user: User }>('/auth/me', { method: 'PATCH', body: patch })).user); setMsg('Preferences saved.'); } catch (e) { setMsg(errorMessage(e)); }
  }
  return (
    <div>
      <PageHeader title="Settings" />
      <section className="card max-w-xl space-y-4" aria-labelledby="np">
        <h2 id="np" className="text-lg font-semibold">Notification preferences</h2>
        <label className="flex items-start gap-3"><input type="checkbox" className="mt-1" checked={user.inAppNotifs} onChange={(e) => save({ inAppNotifs: e.target.checked })} /><span><span className="font-medium">In-app notifications</span><br /><span className="text-sm text-slate-600">Show triggered alerts in your inbox.</span></span></label>
        <label className="flex items-start gap-3"><input type="checkbox" className="mt-1" checked={user.emailNotifs} onChange={(e) => save({ emailNotifs: e.target.checked })} /><span><span className="font-medium">Email notifications</span><br /><span className="text-sm text-slate-600">Only sent when the server operator has configured SMTP and the alert also opts in.</span></span></label>
        <p role="status" aria-live="polite" className="min-h-5 text-sm text-slate-700">{msg}</p>
        <p className="text-sm text-slate-500">Signed in as {user.email}.</p>
      </section>
    </div>
  );
}
