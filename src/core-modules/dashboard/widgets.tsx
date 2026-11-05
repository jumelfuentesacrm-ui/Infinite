import { Link } from 'react-router-dom';
import { supabase } from '@core/data/supabase';
import { run, useData } from '@core/data/api';
import { Section, EmptyState, cx } from '@core/ui/primitives';
import { fmtAgo } from '@core/lib/format';

export function RecentActivity() {
  const q = useData(['dashboard', 'activity'], () =>
    run(supabase.from('vehicle_timeline').select('id, occurred_at, title, vehicle_id, vehicles(unit_number)')
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
                <span className="text-xs text-muted">{fmtAgo(e.occurred_at)}</span>
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
