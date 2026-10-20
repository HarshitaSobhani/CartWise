import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { errorMessage } from '../lib/api';
import { Field } from '../components/ui';

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { user, login, register } = useAuth();
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/app" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await login(email, password);
      else await register(name, email, password);
      nav('/app');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const isLogin = mode === 'login';
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <Link to="/" className="mb-6 text-center text-2xl font-bold text-brand-700">CartWise</Link>
      <form onSubmit={submit} className="card space-y-4" aria-labelledby="auth-title">
        <h1 id="auth-title" className="text-xl font-bold">{isLogin ? 'Sign in' : 'Create your account'}</h1>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {!isLogin && <Field label="Name" id="name"><input id="name" className="input" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>}
        <Field label="Email" id="email"><input id="email" type="email" className="input" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></Field>
        <Field label="Password" id="password">
          <input id="password" type="password" className="input" required minLength={isLogin ? 1 : 10} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={isLogin ? 'current-password' : 'new-password'} aria-describedby={isLogin ? undefined : 'pw-hint'} />
          {!isLogin && <p id="pw-hint" className="mt-1 text-xs text-slate-500">At least 10 characters.</p>}
        </Field>
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Please wait…' : isLogin ? 'Sign in' : 'Create account'}</button>
        <p className="text-center text-sm text-slate-600">
          {isLogin ? <>New here? <Link className="text-brand-700 underline" to="/register">Create an account</Link></> : <>Already registered? <Link className="text-brand-700 underline" to="/login">Sign in</Link></>}
        </p>
      </form>
    </main>
  );
}
