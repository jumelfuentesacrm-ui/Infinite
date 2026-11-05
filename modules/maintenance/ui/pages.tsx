import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CalendarClock, CheckCircle2, Play, Plus, ThumbsUp, ThumbsDown, Trash2, Wrench } from 'lucide-react';
import { supabase } from '@core/data/supabase';
import { rpc, run, useAction, useData } from '@core/data/api';
import { fleetKeys, useVehicle } from '@core/data/shared';
import { Can, useAuth, useWho } from '@core/auth/AuthProvider';
import type { VehicleRef } from '@core/modules/slots';
import { fmtDate, fmtDateTime, fmtHours, fmtMoney, fmtNum, today } from '@core/lib/format';
import { Button, EmptyState, KeyValue, PageHeader, QueryView, Section, Segmented, StatCard, StatusBadge, Tabs, UnitTag } from '@core/ui/primitives';
import { Field, FormGrid, Input, Select, Textarea } from '@core/ui/form';
import { EmployeeSelect, VehicleSelect } from '@core/ui/pickers';
import { DataTable, type Column } from '@core/ui/DataTable';
import { Modal } from '@core/ui/Modal';
import { DUE, keys, REC_SELECT, REC_STATUS, useDue, useRecords, useTypes, type DueRow, type Rec } from './data';

const dueCols = (withVehicle = true): Column<DueRow>[] => [
  ...(withVehicle ? [{ key: 'unit_number', header: 'Vehículo', mobile: 'title' as const, render: (d: DueRow) => <UnitTag>{d.unit_number}</UnitTag> }] : []),
  { key: 'type_name', header: 'Mantenimiento', ...(withVehicle ? {} : { mobile: 'title' as const }) },
  { key: 'due_status', header: 'Estado', value: (d) => DUE[d.due_status]?.label, render: (d) => <StatusBadge map={DUE} value={d.due_status} /> },
  { key: 'due_hours', header: 'Vence (horas)', align: 'right', render: (d) => d.due_hours != null ? <span className="num">{fmtNum(d.due_hours)} h <span className="text-faint">/ {fmtNum(d.current_hours)}</span></span> : '—' },
  { key: 'due_date', header: 'Vence (fecha)', render: (d) => fmtDate(d.due_date) },
  { key: 'last_done_at', header: 'Último', mobile: 'hide', render: (d) => d.last_done_at ? fmtDate(d.last_done_at) : <span className="text-faint">Nunca</span> },
  { key: 'open', header: '', sortable: false, render: (d) => d.open_record_id ? <Link to={`/mantenimiento/${d.open_record_id}`} onClick={(e) => e.stopPropagation()}><StatusBadge map={REC_STATUS} value={d.open_record_status} /></Link> : null },
];
const recCols = (withVehicle = true): Column<Rec>[] => [
  { key: 'date', header: 'Fecha', mobile: 'title', value: (r) => r.performed_at ?? r.scheduled_for ?? r.created_at, render: (r) => <span className="num">{fmtDate(r.performed_at ?? r.scheduled_for ?? r.created_at)}</span> },
  ...(withVehicle ? [{ key: 'unit', header: 'Vehículo', value: (r: Rec) => r.vehicles.unit_number, render: (r: Rec) => <UnitTag>{r.vehicles.unit_number}</UnitTag> }] : []),
  { key: 'type', header: 'Mantenimiento', value: (r) => r.maintenance_types.name },
  { key: 'status', header: 'Estado', value: (r) => REC_STATUS[r.status]?.label, render: (r) => <StatusBadge map={REC_STATUS} value={r.status} /> },
  { key: 'who', header: 'Responsable', mobile: 'hide', value: (r) => r.performer?.full_name ?? r.responsible?.full_name, admin: true },
  { key: 'engine_hours', header: 'Horas', align: 'right', mobile: 'hide', render: (r) => r.engine_hours != null ? <span className="num">{fmtNum(r.engine_hours)}</span> : '—' },
  { key: 'cost', header: 'Costo', align: 'right', mobile: 'hide', admin: true, value: (r) => (r.cost_labor ?? 0) + (r.cost_parts ?? 0), render: (r) => r.status === 'completed' ? <span className="num">{fmtMoney((r.cost_labor ?? 0) + (r.cost_parts ?? 0))}</span> : '—' },
];

export function MaintenancePage() {
  const [params, setParams] = useSearchParams();
  const vehicleId = params.get('vehiculo');
  const [tab, setTab] = useState<'due' | 'open' | 'history'>('due');
  const [filter, setFilter] = useState<'attention' | 'all'>('attention');
  const [schedule, setSchedule] = useState<Partial<DueRow> | null>(null);
  const due = useDue(vehicleId);
  const open = useRecords({ vehicleId, open: true });
  const hist = useRecords({ vehicleId });
  const nav = useNavigate();
  const v = useVehicle(vehicleId ?? undefined);
  const attention = due.data?.filter((d) => d.due_status !== 'ok') ?? [];
  return (
    <>
      <PageHeader title="Mantenimiento preventivo" subtitle={vehicleId && v.data ? <>Filtrado: <UnitTag>{v.data.unit_number}</UnitTag> <button className="ml-1 underline" onClick={() => setParams({})}>quitar filtro</button></> : undefined}
        actions={<Can perm="maintenance.create"><Button variant="primary" icon={Plus} onClick={() => setSchedule({ vehicle_id: vehicleId ?? undefined })}>Programar</Button></Can>} />
      <div className="mb-4 grid grid-cols-3 gap-3">
        <StatCard label="Vencidos" value={due.data?.filter((d) => d.due_status === 'overdue').length ?? '—'} tone="bad" />
        <StatCard label="Próximos" value={due.data?.filter((d) => d.due_status === 'due_soon').length ?? '—'} tone="warn" />
        <StatCard label="Abiertos" value={open.data?.length ?? '—'} tone="info" />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'due', label: 'Estado', count: attention.length || undefined }, { id: 'open', label: 'Programados', count: open.data?.length || undefined }, { id: 'history', label: 'Historial' }]} />
      {tab === 'due' && (
        <DataTable rows={filter === 'attention' ? attention : due.data} loading={due.isLoading} error={due.error} columns={dueCols()} rowKey={(d) => d.vehicle_id + d.interval_id}
          exportName="Mantenimiento-estado" onRowClick={(d) => (d.open_record_id ? nav(`/mantenimiento/${d.open_record_id}`) : setSchedule(d))}
          toolbar={<Segmented value={filter} onChange={setFilter} options={[{ id: 'attention', label: 'Requieren atención' }, { id: 'all', label: 'Todos' }]} />}
          empty={<EmptyState icon={CalendarClock} title={filter === 'attention' ? 'Todo al día' : 'Sin intervalos configurados'}>
            {filter === 'all' && 'Configure los intervalos de cada modelo (según el manual del fabricante) en Configuración › Intervalos.'}</EmptyState>} />
      )}
      {tab === 'open' && <DataTable rows={open.data} loading={open.isLoading} error={open.error} columns={recCols()} onRowClick={(r) => nav(`/mantenimiento/${r.id}`)} />}
      {tab === 'history' && <DataTable rows={hist.data} loading={hist.isLoading} error={hist.error} columns={recCols()} onRowClick={(r) => nav(`/mantenimiento/${r.id}`)} exportName="Mantenimiento-historial" />}
      {schedule && <ScheduleModal initial={schedule} onClose={() => setSchedule(null)} />}
    </>
  );
}

function ScheduleModal({ initial, onClose }: { initial: Partial<DueRow>; onClose: () => void }) {
  const types = useTypes();
  const nav = useNavigate();
  const [v, setV] = useState({ vehicle_id: initial.vehicle_id ?? '', maintenance_type_id: initial.maintenance_type_id ?? '', scheduled_for: today(), responsible_id: '', notes: '' });
  const [parts, setParts] = useState<{ description: string; part_number: string; quantity: string }[]>([]);
  const save = useAction(() => {
    if (!v.vehicle_id || !v.maintenance_type_id) throw new Error('Seleccione vehículo y tipo');
    return rpc<string>('schedule_maintenance', { p: { ...v, responsible_id: v.responsible_id || null, notes: v.notes || null,
      parts: parts.filter((p) => p.description.trim()).map((p) => ({ ...p, quantity: Number(p.quantity) || 1 })) } });
  }, { invalidate: [keys.all], success: 'Mantenimiento programado', onSuccess: (id) => { onClose(); nav(`/mantenimiento/${id}`); } });
  return (
    <Modal open onClose={onClose} title="Programar mantenimiento"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Programar</Button></>}>
      <div className="space-y-4">
        <FormGrid>
          <Field label="Vehículo" required><VehicleSelect value={v.vehicle_id} onChange={(id) => setV({ ...v, vehicle_id: id })} /></Field>
          <Field label="Tipo" required><Select value={v.maintenance_type_id} onChange={(e) => setV({ ...v, maintenance_type_id: e.target.value })} placeholder="Seleccione" options={(types.data ?? []).map((t) => ({ value: t.id, label: t.name }))} /></Field>
          <Field label="Fecha programada"><Input type="date" value={v.scheduled_for} onChange={(e) => setV({ ...v, scheduled_for: e.target.value })} /></Field>
          <Field label="Responsable"><EmployeeSelect value={v.responsible_id} onChange={(id) => setV({ ...v, responsible_id: id })} roles={['mechanic', 'supervisor', 'admin']} placeholder="Sin asignar" /></Field>
        </FormGrid>
        <Field label="Piezas requeridas">
          <div className="space-y-2">
            {parts.map((p, i) => (
              <div key={i} className="grid grid-cols-[1fr_120px_70px_auto] gap-2">
                <Input placeholder="Descripción" value={p.description} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                <Input placeholder="Nº pieza" className="h-10 font-mono" value={p.part_number} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, part_number: e.target.value } : x)))} />
                <Input type="number" min="1" value={p.quantity} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
                <Button variant="ghost" icon={Trash2} onClick={() => setParts(parts.filter((_, j) => j !== i))} aria-label="Quitar" />
              </div>
            ))}
            <Button size="sm" icon={Plus} onClick={() => setParts([...parts, { description: '', part_number: '', quantity: '1' }])}>Añadir pieza</Button>
          </div>
        </Field>
        <Field label="Notas"><Textarea value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export function MaintenanceDetail() {
  const { id = '' } = useParams();
  const { can, isAdmin } = useAuth();
  const who = useWho();
  const q = useData([...keys.all, 'record', id], async () => {
    const [rec, parts] = await Promise.all([
      run(supabase.from('maintenance_records').select(REC_SELECT).eq('id', id).single()) as Promise<Rec>,
      run(supabase.from('maintenance_record_parts').select('*').eq('record_id', id)) as Promise<any[]>,
    ]);
    return { rec, parts };
  });
  const [completing, setCompleting] = useState(false);
  const inv = [keys.all, fleetKeys.vehicles];
  const approve = useAction((ok: boolean) => rpc('approve_maintenance', { p_id: id, p_approve: ok }), { invalidate: inv, success: 'Decisión registrada' });
  const start = useAction(() => rpc('start_maintenance', { p_id: id }), { invalidate: inv, success: 'Mantenimiento iniciado; vehículo en mantenimiento' });
  return (
    <QueryView q={q}>
      {({ rec, parts }) => (
        <div className="mx-auto max-w-4xl">
          <PageHeader back="/mantenimiento" eyebrow="Mantenimiento" title={<span className="flex flex-wrap items-center gap-3">{rec.maintenance_types.name}<StatusBadge map={REC_STATUS} value={rec.status} /></span>}
            subtitle={<Link to={`/flota/${rec.vehicle_id}`}><UnitTag>{rec.vehicles.unit_number}</UnitTag></Link>}
            actions={<>
              {rec.status === 'pending_approval' && can('maintenance.approve') && <>
                <Button icon={ThumbsDown} onClick={() => approve.mutate(false)}>Rechazar</Button>
                <Button variant="primary" icon={ThumbsUp} onClick={() => approve.mutate(true)}>Aprobar</Button></>}
              {rec.status === 'scheduled' && can('maintenance.perform') && <Button icon={Play} loading={start.isPending} onClick={() => start.mutate()}>Iniciar</Button>}
              {['scheduled', 'in_progress'].includes(rec.status) && can('maintenance.perform') && <Button variant="primary" icon={CheckCircle2} onClick={() => setCompleting(true)}>Completar</Button>}
            </>} />
          <div className="grid gap-4 md:grid-cols-2">
            <Section title="Detalle">
              <KeyValue items={[
                ['Programado', fmtDate(rec.scheduled_for)], ['Responsable', who(rec.responsible?.full_name, (rec as any).responsible_id)],
                ['Realizado', fmtDateTime(rec.performed_at)], ['Realizado por', who(rec.performer?.full_name, (rec as any).performed_by)],
                ['Horas de motor', rec.engine_hours != null ? fmtHours(rec.engine_hours) : null], ['Millaje', rec.mileage != null ? fmtNum(rec.mileage) : null],
                ['Mano de obra', rec.labor_hours != null ? fmtHours(rec.labor_hours) : null], ['Costo total', isAdmin && rec.status === 'completed' ? fmtMoney((rec.cost_labor ?? 0) + (rec.cost_parts ?? 0)) : null],
                ['Próximo (horas)', rec.next_due_hours != null ? fmtHours(rec.next_due_hours) : null], ['Próximo (fecha)', fmtDate(rec.next_due_date)],
              ]} />
              {rec.notes && <p className="mt-3 border-t border-line pt-3 text-sm">{rec.notes}</p>}
            </Section>
            <Section title="Piezas requeridas">
              {!parts.length ? <p className="text-sm text-muted">Ninguna indicada</p> : (
                <ul className="divide-y divide-line">{parts.map((p) => (
                  <li key={p.id} className="flex justify-between py-2 text-sm"><span>{p.description}{p.part_number && <span className="num ml-2 text-muted">{p.part_number}</span>}</span><span className="num">× {fmtNum(p.quantity)}</span></li>
                ))}</ul>
              )}
            </Section>
          </div>
          {completing && <CompleteModal rec={rec} onClose={() => setCompleting(false)} />}
        </div>
      )}
    </QueryView>
  );
}

function CompleteModal({ rec, onClose }: { rec: Rec; onClose: () => void }) {
  const { data: veh } = useVehicle(rec.vehicle_id);
  const [v, setV] = useState({ engine_hours: '', mileage: '', labor_hours: '', cost_labor: '', cost_parts: '', notes: '' });
  const n = (x: string) => (x === '' ? null : Number(x));
  const save = useAction(() => rpc('complete_maintenance', { p_id: rec.id, p: { engine_hours: n(v.engine_hours), mileage: n(v.mileage), labor_hours: n(v.labor_hours),
    cost_labor: n(v.cost_labor), cost_parts: n(v.cost_parts), notes: v.notes || null } }),
  { invalidate: [keys.all, fleetKeys.vehicles], success: 'Mantenimiento completado y añadido al historial del vehículo', onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title="Completar mantenimiento"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Completar</Button></>}>
      <div className="space-y-4">
        <FormGrid>
          <Field label="Horas de motor" hint={veh ? `Actual: ${fmtNum(veh.engine_hours)} h` : undefined}><Input type="number" step="0.1" inputMode="decimal" value={v.engine_hours} onChange={(e) => setV({ ...v, engine_hours: e.target.value })} /></Field>
          {veh?.vehicle_models?.uses_mileage && <Field label="Millaje"><Input type="number" step="0.1" value={v.mileage} onChange={(e) => setV({ ...v, mileage: e.target.value })} /></Field>}
          <Field label="Horas de trabajo"><Input type="number" step="0.25" value={v.labor_hours} onChange={(e) => setV({ ...v, labor_hours: e.target.value })} /></Field>
          <Field label="Costo mano de obra"><Input type="number" step="0.01" value={v.cost_labor} onChange={(e) => setV({ ...v, cost_labor: e.target.value })} /></Field>
          <Field label="Costo de piezas"><Input type="number" step="0.01" value={v.cost_parts} onChange={(e) => setV({ ...v, cost_parts: e.target.value })} /></Field>
        </FormGrid>
        <Field label="Trabajo realizado"><Textarea value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
        <p className="text-xs text-muted">El próximo vencimiento se calcula con el intervalo configurado para el modelo.</p>
      </div>
    </Modal>
  );
}

export function VehicleMaintenanceTab({ vehicleId }: { vehicleId: string }) {
  const due = useDue(vehicleId);
  const hist = useRecords({ vehicleId });
  const open = useRecords({ vehicleId, open: true });
  const nav = useNavigate();
  return (
    <div className="space-y-4">
      <DataTable rows={due.data} loading={due.isLoading} error={due.error} columns={dueCols(false)} rowKey={(d) => d.interval_id} search={false}
        empty={<EmptyState icon={CalendarClock} title="Sin intervalos para este modelo">Configúrelos en Configuración › Intervalos de mantenimiento.</EmptyState>} />
      {!!open.data?.length && <DataTable rows={open.data} loading={false} columns={recCols(false)} search={false} onRowClick={(r) => nav(`/mantenimiento/${r.id}`)} />}
      <DataTable rows={hist.data} loading={hist.isLoading} error={hist.error} columns={recCols(false)} search={false} onRowClick={(r) => nav(`/mantenimiento/${r.id}`)} empty={<EmptyState title="Sin mantenimientos registrados" />} />
    </div>
  );
}

export function ScheduleButton({ vehicle }: { vehicle: VehicleRef }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button icon={CalendarClock} onClick={() => setOpen(true)}>Mantenimiento</Button>
    {open && <ScheduleModal initial={{ vehicle_id: vehicle.id }} onClose={() => setOpen(false)} />}
  </>;
}

export function DueKpi() {
  const q = useDue();
  const overdue = q.data?.filter((d) => d.due_status === 'overdue').length ?? 0;
  const soon = q.data?.filter((d) => d.due_status === 'due_soon').length ?? 0;
  return <StatCard label="Mantenimientos próximos / vencidos" value={<>{soon}<span className="text-faint"> / </span><span className="text-bad">{overdue}</span></>} tone={overdue ? 'bad' : soon ? 'warn' : 'ok'} icon={Wrench} to="/mantenimiento" />;
}

export function UpcomingWidget() {
  const q = useDue();
  const list = (q.data ?? []).filter((d) => d.due_status !== 'ok').sort((a, b) => (a.due_status === 'overdue' ? -1 : 1) - (b.due_status === 'overdue' ? -1 : 1)).slice(0, 8);
  return (
    <Section title="Próximos mantenimientos" actions={<Link to="/mantenimiento" className="text-xs text-muted hover:text-ink">Ver todos</Link>}>
      {!list.length ? <EmptyState title="Todo al día" /> : (
        <ul className="divide-y divide-line">{list.map((d) => (
          <li key={d.vehicle_id + d.interval_id}><Link to={`/mantenimiento?vehiculo=${d.vehicle_id}`} className="flex items-center gap-3 py-2 text-sm hover:underline">
            <UnitTag>{d.unit_number}</UnitTag><span className="flex-1 truncate">{d.type_name}</span>
            <span className="num text-xs text-muted">{d.due_hours != null ? `${fmtNum(d.due_hours)} h` : fmtDate(d.due_date)}</span><StatusBadge map={DUE} value={d.due_status} />
          </Link></li>
        ))}</ul>
      )}
    </Section>
  );
}

export function MaintenanceReport() {
  const q = useRecords({});
  return <DataTable rows={q.data?.filter((r) => r.status === 'completed')} loading={q.isLoading} error={q.error} columns={recCols()} exportName="Historial-mantenimiento" />;
}
