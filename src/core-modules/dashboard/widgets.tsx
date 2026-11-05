import { Link } from 'react-router-dom';
import { Truck, CheckCircle2, PlayCircle, Wrench, OctagonX } from 'lucide-react';
import { supabase } from '@core/data/supabase';
import { run, useData } from '@core/data/api';
import { useVehicles, VEHICLE_STATUS } from '@core/data/shared';
import { Section, StatCard, EmptyState, cx } from '@core/ui/primitives';
import { fmtAgo } from '@core/lib/format';

export function FleetKpis() {
  const { data = [] } = useVehicles();
  const c = (s: string[]) => data.filter((v) => s.includes(v.status)).length;
  return (
    <>
      <StatCard label="Vehículos" value={data.length} icon={Truck} to="/flota" />
      <StatCard label="Disponibles" value={c(['available', 'assigned'])} tone="ok" icon={CheckCircle2} to="/flota" />
      <StatCard label="En operación" value={c(['in_operation'])} tone="info" icon={PlayCircle} to="/flota" />
      <StatCard label="En taller" value={c(['repair', 'maintenance'])} tone="warn" icon={Wrench} to="/flota" />
      <StatCard label="Fuera de servicio" value={c(['out_of_service'])} tone="bad" icon={OctagonX} to="/flota" />
    </>
  );
}

const BAR: Record<string, string> = { ok: 'bg-ok', info: 'bg-info', brand: 'bg-brand', warn: 'bg-warn', bad: 'bg-bad', idle: 'bg-idle' };

export function FleetStatusPanel() {
  const { data = [] } = useVehicles();
  const total = data.length || 1;
  const groups = Object.entries(VEHICLE_STATUS).map(([k, s]) => ({ k, ...s, n: data.filter((v) => v.status === k).length })).filter((g) => g.n > 0);
  return (
    <Section title="Estado de la flota">
      {data.length === 0 ? <EmptyState title="Sin vehículos registrados" /> : (
        <>
          <div className="flex h-3 overflow-hidden rounded-full bg-sunken">
            {groups.map((g) => <div key={g.k} className={BAR[g.tone]} style={{ width: `${(g.n / total) * 100}%` }} title={`${g.label}: ${g.n}`} />)}
          </div>
          <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {groups.map((g) => (
              <li key={g.k} className="flex items-center justify-between">
                <span className="flex items-center gap-2"><span className={cx('size-2.5 rounded-sm', BAR[g.tone])} />{g.label}</span>
                <span className="num font-semibold">{g.n}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 border-t border-line pt-3">
            <div className="mb-2 text-xs font-medium text-muted">Requieren atención</div>
            <ul className="space-y-1.5">
              {data.filter((v) => ['out_of_service', 'repair'].includes(v.status)).slice(0, 6).map((v) => (
                <li key={v.id}><Link to={`/flota/${v.id}`} className="flex items-center gap-2 text-sm hover:underline">
                  <span className="tag-unit">{v.unit_number}</span><span className="truncate text-muted">{v.status_reason ?? VEHICLE_STATUS[v.status].label}</span>
                </Link></li>
              ))}
              {!data.some((v) => ['out_of_service', 'repair'].includes(v.status)) && <li className="text-sm text-muted">Ninguno</li>}
            </ul>
          </div>
        </>
      )}
    </Section>
  );
}

export function RecentActivity() {
  const q = useData(['dashboard', 'activity'], () =>
    run(supabase.from('vehicle_timeline').select('id, occurred_at, title, vehicle_id, vehicles(unit_number), employees(full_name)')
      .order('occurred_at', { ascending: false }).limit(12)) as Promise<any[]>);
  return (
    <Section title="Actividad reciente">
      {!q.data?.length ? <EmptyState title="Sin actividad todavía" /> : (
        <ul className="divide-y divide-line">
          {q.data.map((e) => (
            <li key={e.id} className="flex items-start gap-3 py-2">
              <span className="tag-unit mt-0.5 shrink-0">{e.vehicles?.unit_number}</span>
              <Link to={`/flota/${e.vehicle_id}`} className="min-w-0 flex-1 text-sm hover:underline">
                <span className="block truncate">{e.title}</span>
                <span className="text-xs text-muted">{e.employees?.full_name ?? 'Sistema'} · {fmtAgo(e.occurred_at)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function CriticalAlerts() {
  const q = useData(['dashboard', 'alerts', 'notifications'], () =>
    run(supabase.from('my_notifications').select('*').in('severity', ['critical', 'warning']).eq('is_read', false)
      .order('created_at', { ascending: false }).limit(8)) as Promise<any[]>);
  return (
    <Section title="Alertas importantes" actions={<Link to="/notificaciones" className="text-xs text-muted hover:text-ink">Ver todas</Link>}>
      {!q.data?.length ? <EmptyState title="Sin alertas pendientes" /> : (
        <ul className="space-y-2">
          {q.data.map((n) => (
            <li key={n.id}>
              <Link to={n.link ?? '/notificaciones'} className={cx('block rounded-md border-l-[3px] bg-paper px-3 py-2 hover:bg-sunken',
                n.severity === 'critical' ? 'border-bad' : 'border-warn')}>
                <div className="text-sm font-medium">{n.title}</div>
                <div className="text-xs text-muted">{n.body ? n.body + ' · ' : ''}{fmtAgo(n.created_at)}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
