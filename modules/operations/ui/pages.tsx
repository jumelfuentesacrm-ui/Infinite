import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { addDays, addMonths, addWeeks, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfDay, startOfMonth, startOfWeek } from 'date-fns';
import { es } from 'date-fns/locale';
import { CalendarDays, ChevronLeft, ChevronRight, MapPin, Play, Plus, CheckCircle2, Truck, Users } from 'lucide-react';
import { rpc, useAction } from '@core/data/api';
import { fleetKeys, useEmployees, useVehicles } from '@core/data/shared';
import { useAuth, Can } from '@core/auth/AuthProvider';
import { Badge, Button, Card, EmptyState, PageHeader, QueryView, Section, Segmented, StatusBadge, cx } from '@core/ui/primitives';
import { CheckList, Field, FormGrid, Input, Select, Textarea } from '@core/ui/form';
import { Modal } from '@core/ui/Modal';
import { fmtTime, toLocalInput } from '@core/lib/format';
import { keys, OP_STATUS, useMyOperations, useOperations, type Operation } from './data';

type View = 'day' | 'week' | 'month';

export function CalendarPage() {
  const [view, setView] = useState<View>(() => (window.innerWidth < 768 ? 'day' : 'week'));
  const [cursor, setCursor] = useState(new Date());
  const [editing, setEditing] = useState<Operation | 'new' | null>(null);
  const [newAt, setNewAt] = useState<Date | null>(null);

  const [from, to] = useMemo(() => {
    if (view === 'day') return [startOfDay(cursor), addDays(startOfDay(cursor), 1)];
    if (view === 'week') return [startOfWeek(cursor, { weekStartsOn: 1 }), addDays(endOfWeek(cursor, { weekStartsOn: 1 }), 1)];
    return [startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 }), addDays(endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 }), 1)];
  }, [view, cursor]);
  const q = useOperations(from, to);
  const move = (n: number) => setCursor((c) => (view === 'day' ? addDays(c, n) : view === 'week' ? addWeeks(c, n) : addMonths(c, n)));
  const title = view === 'month' ? format(cursor, 'MMMM yyyy', { locale: es })
    : view === 'week' ? `${format(from, 'd MMM', { locale: es })} – ${format(addDays(to, -1), 'd MMM yyyy', { locale: es })}`
      : format(cursor, "EEEE d 'de' MMMM", { locale: es });
  const days = useMemo(() => { const out: Date[] = []; for (let d = from; d < to; d = addDays(d, 1)) out.push(d); return out; }, [from, to]);
  const opsOn = (d: Date) => (q.data ?? []).filter((o) => new Date(o.starts_at) < addDays(d, 1) && new Date(o.ends_at) > d);
  const create = (d?: Date) => { setNewAt(d ?? null); setEditing('new'); };

  return (
    <>
      <PageHeader title="Operaciones" actions={<Can perm="operations.create"><Button variant="primary" icon={Plus} onClick={() => create()}>Nueva operación</Button></Can>} />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" icon={ChevronLeft} onClick={() => move(-1)} aria-label="Anterior" />
          <Button size="sm" onClick={() => setCursor(new Date())}>Hoy</Button>
          <Button size="sm" variant="ghost" icon={ChevronRight} onClick={() => move(1)} aria-label="Siguiente" />
          <h2 className="ml-2 text-base font-semibold capitalize">{title}</h2>
        </div>
        <Segmented value={view} onChange={setView} options={[{ id: 'day', label: 'Día' }, { id: 'week', label: 'Semana' }, { id: 'month', label: 'Mes' }]} />
      </div>

      <QueryView q={q}>
        {() => view === 'month' ? (
          <div className="overflow-hidden rounded-card border border-line bg-panel shadow-card">
            <div className="grid grid-cols-7 border-b border-line bg-paper text-center text-[11px] font-medium uppercase text-muted">
              {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => <div key={d} className="py-1.5">{d}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {days.map((d) => (
                <div key={d.toISOString()} onDoubleClick={() => create(d)}
                  className={cx('min-h-24 border-r border-b border-line p-1 last:border-r-0 [&:nth-child(7n)]:border-r-0', !isSameMonth(d, cursor) && 'bg-paper/60')}>
                  <button onClick={() => { setCursor(d); setView('day'); }}
                    className={cx('num mb-0.5 grid size-6 place-items-center rounded-full text-xs', isSameDay(d, new Date()) ? 'bg-brand text-white' : 'text-muted hover:bg-sunken')}>{format(d, 'd')}</button>
                  {opsOn(d).slice(0, 3).map((o) => <Chip key={o.id} op={o} onClick={() => setEditing(o)} compact />)}
                  {opsOn(d).length > 3 && <div className="px-1 text-[11px] text-muted">+{opsOn(d).length - 3} más</div>}
                </div>
              ))}
            </div>
          </div>
        ) : view === 'week' ? (
          <div className="grid gap-2 md:grid-cols-7">
            {days.map((d) => (
              <div key={d.toISOString()} className={cx('rounded-card border bg-panel p-2', isSameDay(d, new Date()) ? 'border-brand' : 'border-line')}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium capitalize text-muted">{format(d, 'EEE d', { locale: es })}</span>
                  <Can perm="operations.create"><button onClick={() => create(d)} className="text-faint hover:text-brand" aria-label="Añadir"><Plus className="size-4" /></button></Can>
                </div>
                <div className="space-y-1.5">{opsOn(d).map((o) => <Chip key={o.id} op={o} onClick={() => setEditing(o)} />)}</div>
              </div>
            ))}
          </div>
        ) : (
          <Card pad={false}>
            {opsOn(from).length === 0 ? <EmptyState icon={CalendarDays} title="Sin operaciones este día" /> : (
              <ul className="divide-y divide-line">{opsOn(from).map((o) => <li key={o.id}><OpRow op={o} onClick={() => setEditing(o)} /></li>)}</ul>
            )}
          </Card>
        )}
      </QueryView>
      {editing && <OperationForm op={editing === 'new' ? undefined : editing} defaultDay={newAt} onClose={() => setEditing(null)} />}
    </>
  );
}

function Chip({ op, onClick, compact }: { op: Operation; onClick: () => void; compact?: boolean }) {
  const tone = OP_STATUS[op.status]?.tone;
  return (
    <button onClick={onClick} className={cx('block w-full rounded-[5px] border-l-[3px] bg-paper px-1.5 py-1 text-left hover:bg-sunken',
      tone === 'brand' ? 'border-brand' : tone === 'ok' ? 'border-ok' : tone === 'idle' ? 'border-idle opacity-60' : 'border-info')}>
      <div className="truncate text-[12px] font-medium">{!compact && <span className="num mr-1 text-muted">{fmtTime(op.starts_at)}</span>}{op.title}</div>
      {!compact && op.operation_vehicles.length > 0 && <div className="truncate font-mono text-[10px] text-muted">{op.operation_vehicles.map((v) => v.vehicles.unit_number).join(' · ')}</div>}
    </button>
  );
}

function OpRow({ op, onClick, actions }: { op: Operation; onClick?: () => void; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-3 px-4 py-3">
      <button onClick={onClick} className="min-w-0 flex-1 text-left">
        <div className="flex flex-wrap items-center gap-2"><span className="num text-sm text-muted">{fmtTime(op.starts_at)}–{fmtTime(op.ends_at)}</span><span className="font-medium">{op.title}</span><StatusBadge map={OP_STATUS} value={op.status} /></div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
          {op.location_name && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{op.location_name}</span>}
          {op.operation_vehicles.length > 0 && <span className="inline-flex items-center gap-1"><Truck className="size-3.5" />{op.operation_vehicles.map((v) => v.vehicles.unit_number).join(', ')}</span>}
          {op.operation_employees.length > 0 && <span className="inline-flex items-center gap-1"><Users className="size-3.5" />{op.operation_employees.map((e) => e.employees.full_name).join(', ')}</span>}
        </div>
        {op.description && <p className="mt-1 text-sm text-ink-2">{op.description}</p>}
      </button>
      {actions}
    </div>
  );
}

function OperationForm({ op, defaultDay, onClose }: { op?: Operation; defaultDay: Date | null; onClose: () => void }) {
  const { can } = useAuth();
  const vehicles = useVehicles();
  const employees = useEmployees();
  const base = defaultDay ? new Date(defaultDay.setHours(8, 0, 0, 0)) : new Date();
  const [v, setV] = useState({
    title: op?.title ?? '', description: op?.description ?? '', location_name: op?.location_name ?? '', notes: op?.notes ?? '',
    starts_at: toLocalInput(op ? new Date(op.starts_at) : base), ends_at: toLocalInput(op ? new Date(op.ends_at) : new Date(base.getTime() + 4 * 3600_000)),
    status: op?.status ?? 'scheduled',
    vehicle_ids: op?.operation_vehicles.map((x) => x.vehicle_id) ?? [], employee_ids: op?.operation_employees.map((x) => x.employee_id) ?? [],
  });
  const editable = can(op ? 'operations.edit' : 'operations.create');
  const save = useAction(() => {
    if (!v.title.trim()) throw new Error('Escriba un título');
    return rpc('save_operation', { p: { id: op?.id, title: v.title, description: v.description || null, location_name: v.location_name || null,
      notes: v.notes || null, status: v.status, starts_at: new Date(v.starts_at).toISOString(), ends_at: new Date(v.ends_at).toISOString(),
      vehicle_ids: v.vehicle_ids, employees: v.employee_ids.map((id) => ({ employee_id: id })) } });
  }, { invalidate: [keys.all], success: 'Operación guardada', onSuccess: onClose });
  const status = useAction((s: string) => rpc('set_operation_status', { p_id: op!.id, p_status: s }), { invalidate: [keys.all, fleetKeys.vehicles], success: 'Estado actualizado', onSuccess: onClose });

  return (
    <Modal open onClose={onClose} title={op ? 'Operación' : 'Nueva operación'} size="lg"
      footer={<>
        {op && editable && op.status === 'scheduled' && <Button icon={Play} onClick={() => status.mutate('in_progress')} className="mr-auto">Iniciar</Button>}
        {op && editable && op.status === 'in_progress' && <Button icon={CheckCircle2} onClick={() => status.mutate('completed')} className="mr-auto">Completar</Button>}
        <Button onClick={onClose}>Cerrar</Button>
        {editable && <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button>}
      </>}>
      <fieldset disabled={!editable} className="space-y-4">
        <FormGrid>
          <Field label="Título" required className="sm:col-span-2"><Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
          <Field label="Inicio"><Input type="datetime-local" value={v.starts_at} onChange={(e) => setV({ ...v, starts_at: e.target.value })} /></Field>
          <Field label="Fin"><Input type="datetime-local" value={v.ends_at} onChange={(e) => setV({ ...v, ends_at: e.target.value })} /></Field>
          <Field label="Ubicación"><Input value={v.location_name} onChange={(e) => setV({ ...v, location_name: e.target.value })} /></Field>
          <Field label="Estado"><Select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })} options={Object.entries(OP_STATUS).map(([value, s]) => ({ value, label: s.label }))} /></Field>
        </FormGrid>
        <Field label="Descripción"><Textarea value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
        <FormGrid>
          <Field label="Vehículos" hint="El sistema impide asignar un vehículo a dos operaciones a la vez">
            <CheckList value={v.vehicle_ids} onChange={(ids) => setV({ ...v, vehicle_ids: ids })} height={180}
              options={(vehicles.data ?? []).filter((x) => !['retired'].includes(x.status)).map((x) => ({ value: x.id, label: x.unit_number, hint: x.status === 'out_of_service' ? 'fuera de servicio' : undefined }))} />
          </Field>
          <Field label="Empleados">
            <CheckList value={v.employee_ids} onChange={(ids) => setV({ ...v, employee_ids: ids })} height={180}
              options={(employees.data ?? []).map((x) => ({ value: x.id, label: x.full_name }))} />
          </Field>
        </FormGrid>
        <Field label="Observaciones"><Textarea value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      </fieldset>
    </Modal>
  );
}

/** Teléfono: mis asignaciones */
export function MyAssignments() {
  const { profile } = useAuth();
  const q = useMyOperations(profile?.id);
  const status = useAction((a: { id: string; s: string }) => rpc('set_operation_status', { p_id: a.id, p_status: a.s }), { invalidate: [keys.all, fleetKeys.vehicles, fleetKeys.myVehicle], success: 'Actualizado' });
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Mis asignaciones" back="/m" />
      <Card pad={false}>
        <QueryView q={q} empty={<EmptyState icon={CalendarDays} title="No tiene asignaciones próximas" />}>
          {(ops) => (
            <ul className="divide-y divide-line">
              {ops.map((o) => (
                <li key={o.id}>
                  <div className="px-4 pt-3 text-xs font-medium capitalize text-muted">{format(new Date(o.starts_at), "EEEE d 'de' MMMM", { locale: es })}</div>
                  <OpRow op={o} actions={
                    o.status === 'scheduled' ? <Button size="sm" variant="primary" icon={Play} onClick={() => status.mutate({ id: o.id, s: 'in_progress' })}>Iniciar</Button>
                      : o.status === 'in_progress' ? <Button size="sm" icon={CheckCircle2} onClick={() => status.mutate({ id: o.id, s: 'completed' })}>Terminar</Button> : null} />
                </li>
              ))}
            </ul>
          )}
        </QueryView>
      </Card>
    </div>
  );
}

/** Dashboard: operaciones de hoy */
export function TodayOperations() {
  const from = startOfDay(new Date());
  const q = useOperations(from, addDays(from, 1));
  return (
    <Section title="Operaciones de hoy" actions={<Link to="/operaciones" className="text-xs text-muted hover:text-ink">Calendario</Link>}>
      <QueryView q={q} empty={<EmptyState icon={CalendarDays} title="Sin operaciones hoy" />}>
        {(ops) => <ul className="-mx-4 -my-3 divide-y divide-line">{ops.map((o) => <li key={o.id}><OpRow op={o} /></li>)}</ul>}
      </QueryView>
    </Section>
  );
}

export function ActiveOpsKpi() {
  const from = startOfDay(new Date());
  const q = useOperations(from, addDays(from, 1));
  const n = q.data?.filter((o) => o.status === 'in_progress').length ?? 0;
  return <Card><div className="text-[12px] font-medium text-muted">Operaciones hoy</div><div className="num mt-2 text-[26px] font-semibold leading-none">{q.data?.length ?? '—'}</div><div className="mt-1.5 text-xs text-muted"><Badge tone="brand">{n} en curso</Badge></div></Card>;
}
