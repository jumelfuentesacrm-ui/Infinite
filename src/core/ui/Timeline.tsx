import { Link } from 'react-router-dom';
import { ClipboardCheck, Wrench, Fuel, ShieldAlert, FileText, Gauge, Settings2, Stethoscope, CircleDot, Inbox, Hand, CheckCircle2 } from 'lucide-react';
import type { TimelineEvent } from '@core/data/shared';
import { fmtDateTime, fmtMoney, fmtHours } from '@core/lib/format';
import { EmptyState, cx } from './primitives';
import { useModules } from '@core/modules/registry';
import { useAuth, useWho } from '@core/auth/AuthProvider';

const ICONS: Record<string, typeof Wrench> = {
  inspection: ClipboardCheck, repair: Wrench, work_order_opened: Wrench, diagnosis: Stethoscope, maintenance: Settings2,
  fuel: Fuel, incident: ShieldAlert, document: FileText, meter: Gauge,
  shop_report_received: Inbox, shop_report_accepted: Hand, shop_report_solved: CheckCircle2,
};

/** Historial cronológico de la vida del vehículo (alimentado por todos los módulos) */
export function Timeline({ events }: { events: TimelineEvent[] }) {
  const { modules } = useModules();
  const { isAdmin } = useAuth();
  const who = useWho();
  const LINKS = Object.assign({}, ...modules.map((m) => m.entityLinks ?? {})) as Record<string, (id: string) => string>;
  if (!events.length) return <EmptyState title="Sin historial todavía" />;
  return (
    <ol className="relative ml-3 border-l border-line">
      {events.map((e) => {
        const Icon = ICONS[e.event_type] ?? CircleDot;
        const link = e.entity_type && e.entity_id && LINKS[e.entity_type]?.(e.entity_id);
        const fail = e.title.includes('NO APTO');
        const parts: any[] = Array.isArray(e.details?.parts) ? e.details.parts : [];
        return (
          <li key={e.id} className="mb-4 ml-5">
            <span className={cx('absolute -left-[13px] grid size-[26px] place-items-center rounded-full border bg-panel',
              fail ? 'border-bad text-bad' : 'border-line-strong text-ink-2')}><Icon className="size-3.5" /></span>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              {link ? <Link to={link} className="font-medium hover:underline">{e.title}</Link> : <span className="font-medium">{e.title}</span>}
              <time className="num text-xs text-muted">{fmtDateTime(e.occurred_at)}</time>
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-3 text-[13px] text-muted">
              {who(e.employees?.full_name, e.employee_id) && <span>{who(e.employees?.full_name, e.employee_id)}</span>}
              {e.labor_hours != null && <span>{fmtHours(e.labor_hours)} de trabajo</span>}
              {isAdmin && e.cost != null && <span>{fmtMoney(e.cost)}</span>}
            </div>
            {e.details?.diagnosis && <p className="mt-1 text-[13px] text-ink-2">{e.details.diagnosis}</p>}
            {parts.length > 0 && (
              <ul className="mt-1 text-[13px] text-ink-2">
                {parts.map((p, i) => <li key={i}>· {p.quantity} × {p.description}{p.part_number && <span className="num text-muted"> ({p.part_number})</span>}</li>)}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
