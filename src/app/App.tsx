import { Suspense } from 'react';
import { BrowserRouter, MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@core/auth/AuthProvider';
import { ModuleProvider, useModules } from '@core/modules/registry';
import { ToastProvider } from '@core/ui/Toast';
import { ConfirmProvider } from '@core/ui/Modal';
import { Spinner, EmptyState } from '@core/ui/primitives';
import { supabaseConfigured } from '@core/data/supabase';
import { AppShell } from './AppShell';
import { LoginPage } from './LoginPage';
import { SetupNotice } from './SetupNotice';
import { ShieldOff } from 'lucide-react';
import { lazy } from 'react';

const DEMO = import.meta.env.VITE_DEMO === '1';
/** El visor del demo no admite rutas en la URL: navegación en memoria */
const Router = DEMO ? MemoryRouter : BrowserRouter;
const DemoBanner = DEMO ? lazy(() => import('../demo/DemoUI').then((m) => ({ default: m.DemoBanner }))) : null;

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 20_000, retry: 1, refetchOnWindowFocus: true } },
});

export function App() {
  if (!supabaseConfigured) return <SetupNotice />;
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <Router>
              {DemoBanner && <Suspense fallback={null}><DemoBanner /></Suspense>}
              <Gate />
            </Router>
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function Gate() {
  const { ready, session, profile } = useAuth();
  if (!ready) return <div className="grid min-h-dvh place-items-center"><Spinner /></div>;
  if (!session || !profile) return <LoginPage />;
  return (
    <ModuleProvider enabled>
      <AppRoutes />
    </ModuleProvider>
  );
}

function AppRoutes() {
  const { modules, loading } = useModules();
  const { can, profile } = useAuth();
  if (loading) return <div className="grid min-h-dvh place-items-center"><Spinner /></div>;
  const routes = modules.flatMap((m) => m.routes ?? []);
  const has = (p: string) => routes.some((r) => r.path === p);
  const home = has(profile!.home_path) ? profile!.home_path : can('fleet.view') ? '/dashboard' : '/m';

  return (
    <Routes>
      <Route element={<AppShell home={home} />}>
        <Route index element={<Navigate to={home} replace />} />
        {routes.map((r) => {
          const C = r.component;
          return (
            <Route key={r.path} path={r.path} element={
              can(r.perm)
                ? <Suspense fallback={<Spinner />}><C /></Suspense>
                : <EmptyState icon={ShieldOff} title="Sin acceso">Su usuario no tiene permiso para ver esta sección.</EmptyState>
            } />
          );
        })}
        <Route path="*" element={<EmptyState title="Página no encontrada">Puede que el módulo no esté activo.</EmptyState>} />
      </Route>
    </Routes>
  );
}
