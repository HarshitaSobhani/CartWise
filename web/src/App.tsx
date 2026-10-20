import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { Landing } from './pages/Landing';
import { AuthPage } from './pages/AuthPages';
import { Dashboard } from './pages/Dashboard';
import { Catalog } from './pages/Catalog';
import { Compare } from './pages/Compare';
import { Wishlists } from './pages/Wishlists';
import { Alerts } from './pages/Alerts';
import { Notifications } from './pages/Notifications';
import { Budgets } from './pages/Budgets';
import { Settings } from './pages/Settings';

const ProductDetail = lazy(() => import('./pages/ProductDetail').then((m) => ({ default: m.ProductDetail })));
const Admin = lazy(() => import('./pages/Admin').then((m) => ({ default: m.Admin })));

function Protected({ admin, children }: { admin?: boolean; children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner label="Checking session" />;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  if (admin && user.role !== 'ADMIN') return <p role="alert" className="p-6">You do not have access to this page.</p>;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
      <Route path="/app" element={<Protected><Layout /></Protected>}>
        <Route index element={<Dashboard />} />
        <Route path="catalog" element={<Catalog />} />
        <Route path="products/:id" element={<Suspense fallback={<Spinner />}><ProductDetail /></Suspense>} />
        <Route path="compare" element={<Compare />} />
        <Route path="wishlists" element={<Wishlists />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="budgets" element={<Budgets />} />
        <Route path="settings" element={<Settings />} />
        <Route path="admin" element={<Protected admin><Suspense fallback={<Spinner />}><Admin /></Suspense></Protected>} />
      </Route>
      <Route path="*" element={<p className="p-6">Page not found. <a className="underline" href="/">Go home</a></p>} />
    </Routes>
  );
}
