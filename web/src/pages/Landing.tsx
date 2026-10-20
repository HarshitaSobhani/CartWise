import { Link } from 'react-router-dom';
import { useAuth } from '../auth';

const features = [
  ['Compare side by side', 'Line products up on latest recorded price, freshness and source coverage. Currencies are never silently mixed.'],
  ['Real price history', 'Charts are drawn only from stored observations. No guessed prices, no invented “all-time lows”.'],
  ['Target-price alerts', 'Get an in-app notification only when a real observation meets your target. Optional email when configured.'],
  ['Wishlists & budgets', 'Prioritise what you want and track spending against budgets, exactly to the cent.'],
  ['CSV in, CSV out', 'Import products and price history with row-level validation. Export your lists and history any time.'],
  ['Honest data labels', 'Demo, imported and external data are labelled, with freshness shown on every price.'],
];

export function Landing() {
  const { user } = useAuth();
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <span className="text-xl font-bold text-brand-700">CartWise</span>
        <nav aria-label="Account" className="flex gap-2">
          {user ? <Link className="btn-primary" to="/app">Open dashboard</Link> : (<><Link className="btn-secondary" to="/login">Sign in</Link><Link className="btn-primary" to="/register">Get started</Link></>)}
        </nav>
      </header>
      <main>
        <section className="bg-gradient-to-b from-brand-50 to-slate-50">
          <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:py-24">
            <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">Shop on evidence, not hunches.</h1>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600">CartWise helps you compare products, follow real price movements and buy at the right time.</p>
            <div className="mt-8 flex justify-center gap-3">
              <Link className="btn-primary px-6 py-3" to="/register">Create free account</Link>
              <Link className="btn-secondary px-6 py-3" to="/login">Sign in</Link>
            </div>
            <p className="mt-4 text-sm text-slate-500">Runs locally with a clearly labelled demo catalog. No retailer credentials required.</p>
          </div>
        </section>
        <section aria-labelledby="features" className="mx-auto max-w-6xl px-4 py-12">
          <h2 id="features" className="mb-6 text-2xl font-bold">Everything you need to decide</h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(([t, d]) => (
              <li key={t} className="card"><h3 className="font-semibold">{t}</h3><p className="mt-1 text-sm text-slate-600">{d}</p></li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
