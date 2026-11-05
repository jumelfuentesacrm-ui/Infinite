import { Link } from 'react-router-dom';
import { CheckCircle2, CircleDot, ClipboardCheck, Hand, Inbox, Settings2, Stethoscope, Wrench } from 'lucide-react';
import { rpc, useData } from '@core/data/api';
import { useLiveTable } from '@core/data/realtime';
import { useModules } from '@core/modules/registry';
import { fmtDateTime, fmtHours } from '@core/lib/format';
import { EmptyState, QueryView, UnitTag } from './primitives';

interface HistoryRow {
  id: number; occurred_at: string; vehicle_id: string; unit_number: string; module_id: string; event_type: string;
  title: string; entity_type: string | null; entity_id: string | null; labor_hours: number | null;
}

const ICONS: Record<string, typeof Wrench> = {
  shop_report_accepted: Hand, shop_report_solved: CheckCircle2, work_order_opened: Wrench, diagnosis: Stethoscope,
  repair: Wrench, maintenance: Settings2, inspection: ClipboardCheck,
};

/** Lo que hizo un empleado en cada máquina. Sin employeeId: el propio. El servidor solo deja al admin ver el de otros. */
export function EmployeeHistory({ employeeId }: { employeeId?: string }) {
  const q = useData(['employee_history', employeeId ?? 'me'], () => rpc<HistoryRow[]>('employee_history', { p_employee: employeeId ?? null, p_limit: 300 }));
  useLiveTable('vehicle_timeline', [['employee_history']]);
  const { modules } = useModules();
  const LINKS = Object.assign({}, ...modules.map((m) => m.entityLinks ?? {})) as Record<string, (id: string) => string>;
  const hours = (q.data ?? []).reduce((s, r) => s + Number(r.labor_hours ?? 0), 0);

  return (
    <QueryView q={q} empty={<EmptyState icon={Inbox} title="Sin actividad todavía">Los reportes aceptados, solucionados, órdenes y mantenimientos aparecen aquí.</EmptyState>}>
      {(rows) => (
        <>
          <p className="mb-3 text-[13px] text-muted"><span className="num font-semibold text-ink">{rows.length}</span> actividades
            {hours > 0 && <> · <span className="num font-semibold text-ink">{fmtHours(hours)}</span> de trabajo</>}</p>
          <ul className="divide-y divide-line rounded-card border border-line bg-panel shadow-card">
            {rows.map((r) => {
              const Icon = ICONS[r.event_type] ?? CircleDot;
              const link = r.entity_type && r.entity_id ? LINKS[r.entity_type]?.(r.entity_id) : undefined;
              const body = (
                <div className="flex gap-3 px-4 py-3">
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-sunken text-ink-2"><Icon className="size-4" aria-hidden /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <UnitTag>{r.unit_number}</UnitTag>
                      <span className="num text-xs text-muted">{fmtDateTime(r.occurred_at)}</span>
                      {r.labor_hours != null && <span className="num text-xs text-muted">· {fmtHours(r.labor_hours)}</span>}
                    </div>
                    <p className="mt-1 break-words text-sm">{r.title}</p>
                  </div>
                </div>
              );
              return <li key={r.id}>{link ? <Link to={link} className="block transition-colors hover:bg-paper">{body}</Link> : body}</li>;
            })}
          </ul>
        </>
      )}
    </QueryView>
  );
}
