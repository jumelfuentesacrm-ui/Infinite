import { Suspense } from 'react';
import { useAuth } from '@core/auth/AuthProvider';
import { useModules } from '@core/modules/registry';
import { useLiveTable } from '@core/data/realtime';
import { fleetKeys } from '@core/data/shared';
import { PageHeader, Spinner, cx } from '@core/ui/primitives';
import { fmtLongDate } from '@core/lib/format';
import { clientConfig } from '@core/config';

/** El dashboard no conoce los módulos: muestra los widgets que cada módulo activo aporta. */
export default function DashboardPage() {
  const { modules } = useModules();
  const { can, profile } = useAuth();
  // Cualquier cambio relevante refresca los widgets
  useLiveTable('vehicles', [fleetKeys.vehicles, ['dashboard']]);
  useLiveTable('vehicle_timeline', [['dashboard']]);

  const allow = clientConfig.dashboard?.widgets;
  const widgets = modules.flatMap((m) => m.dashboard ?? [])
    .filter((w) => can(w.perm) && (!allow || allow.includes(w.id)))
    .sort((a, b) => allow ? allow.indexOf(a.id) - allow.indexOf(b.id) : (a.order ?? 50) - (b.order ?? 50));
  const kpis = widgets.filter((w) => w.size === 'kpi');
  const panels = widgets.filter((w) => w.size !== 'kpi');

  return (
    <>
      <PageHeader eyebrow={fmtLongDate(new Date())} title={`Hola, ${profile?.full_name.split(' ')[0]}`} subtitle="Estado de la flota en tiempo real" />
      {kpis.length > 0 && <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {kpis.map((w) => { const C = w.component; return <Suspense key={w.id} fallback={<div className="h-24 animate-pulse rounded-card bg-sunken" />}><C /></Suspense>; })}
      </div>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        {panels.map((w) => {
          const C = w.component;
          return <div key={w.id} className={cx(w.size === 'full' && 'lg:col-span-2')}><Suspense fallback={<Spinner />}><C /></Suspense></div>;
        })}
      </div>
    </>
  );
}
