import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, ClipboardList, Clock, Lock, Package, Play, Plus, Stethoscope, UserCog, Wrench, X, Check } from 'lucide-react';
import { supabase } from '@core/data/supabase';
import { rpc, run, useAction, useData } from '@core/data/api';
import { useLiveTable } from '@core/data/realtime';
import { fleetKeys } from '@core/data/shared';
import { Can, useAuth, useWho } from '@core/auth/AuthProvider';
import { savedMsg, useSaveOrRequest } from '@core/data/changes';
import { Slot, useSlotItems } from '@core/modules/Slot';
import { fmtAgo, fmtDate, fmtDateTime, fmtHours, fmtMoney, fmtNum } from '@core/lib/format';
import { Badge, Button, Card, EmptyState, KeyValue, PageHeader, QueryView, Section, Segmented, StatCard, StatusBadge, UnitTag, cx } from '@core/ui/primitives';
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from '@core/ui/form';
import { EmployeeSelect } from '@core/ui/pickers';
import { Attachments } from '@core/ui/media';
import { DataTable, type Column } from '@core/ui/DataTable';
import { Modal, useConfirm } from '@core/ui/Modal';
import { keys, MODULE, OPEN, PART_STATUS, PRIORITY, WO_SELECT, WO_STATUS, useWorkOrders, type WorkOrder } from './data';
import { CreateWorkOrderModal } from './CreateWorkOrder';

const overdue = (w: WorkOrder) => OPEN.includes(w.status) && w.due_at && new Date(w.due_at) < new Date();

type Who = ReturnType<typeof useWho>;
const mechLabel = (w: WorkOrder, who: Who) => who(w.mechanic?.full_name, w.assigned_mechanic_id) ?? (w.assigned_mechanic_id ? 'Asignada' : 'Sin asignar');

export const woColumns = (who: Who, withVehicle = true): Column<WorkOrder>[] => [
  { key: 'order_number', header: 'Orden', mobile: 'title', render: (w) => <span className="num font-semibold">{w.order_number}{overdue(w) && <Badge tone="bad" dot={false} className="ml-2">Atrasada</Badge>}</span> },
  ...(withVehicle ? [{ key: 'unit', header: 'Vehículo', value: (w: WorkOrder) => w.vehicles.unit_number, render: (w: WorkOrder) => <UnitTag>{w.vehicles.unit_number}</UnitTag> }] : []),
  { key: 'reported_problem', header: 'Problema', className: 'max-w-[320px] truncate' },
  { key: 'priority', header: 'Prioridad', value: (w) => PRIORITY[w.priority]?.label, render: (w) => <StatusBadge map={PRIORITY} value={w.priority} /> },
  { key: 'status', header: 'Estado', value: (w) => WO_STATUS[w.status]?.label, render: (w) => <StatusBadge map={WO_STATUS} value={w.status} /> },
  { key: 'mechanic', header: 'Mecánico', mobile: 'hide', value: (w) => mechLabel(w, who) },
  { key: 'created_at', header: 'Abierta', mobile: 'hide', render: (w) => <span className="text-[13px] text-muted">{fmtAgo(w.created_at)}</span> },
];

/** Panel del taller: pensado para teléfono o tableta */
export function ShopHome() {
  const { profile, can } = useAuth();
  const who = useWho();
  const nav = useNavigate();
  const [scope, setScope] = useState<'mine' | 'open' | 'closed'>(can('workorders.edit') ? 'open' : 'mine');
  const q = useWorkOrders({ scope: scope === 'closed' ? 'closed' : 'open' });
  const [creating, setCreating] = useState(false);
  useLiveTable('work_orders', [keys.all]);
  const rows = (q.data ?? []).filter((w) => scope !== 'mine' || w.assigned_mechanic_id === profile?.id || !w.assigned_mechanic_id);
  const board = ['new', 'pending_diagnosis', 'diagnosed', 'waiting_parts', 'in_repair', 'pending_test'];

  return (
    <>
      <PageHeader title="Taller" subtitle="Órdenes de trabajo" actions={<Can perm="workorders.create"><Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Nueva orden</Button></Can>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Abiertas" value={(q.data ?? []).filter((w) => OPEN.includes(w.status)).length} icon={ClipboardList} />
        <StatCard label="Sin asignar" value={(q.data ?? []).filter((w) => OPEN.includes(w.status) && !w.assigned_mechanic_id).length} tone="brand" />
        <StatCard label="Esperando piezas" value={(q.data ?? []).filter((w) => w.status === 'waiting_parts').length} tone="warn" icon={Package} />
        <StatCard label="Atrasadas" value={(q.data ?? []).filter((w) => overdue(w)).length} tone="bad" icon={Clock} />
      </div>
      <div className="mb-3"><Segmented value={scope} onChange={setScope} options={[{ id: 'mine', label: 'Mis órdenes' }, { id: 'open', label: 'Todas abiertas' }, { id: 'closed', label: 'Terminadas' }]} /></div>
      <Slot name="shop.home" props={{}} />
      {scope !== 'mine' && can('workorders.work') && <MyShopCard />}
      {scope !== 'closed' && rows.length > 0 && (
        <div className="scroll-x mb-4 hidden pb-2 xl:block">
          <div className="grid min-w-[1100px] grid-cols-6 gap-3">
            {board.map((s) => (
              <div key={s} className="rounded-card bg-sunken/70 p-2">
                <div className="mb-2 flex items-center justify-between px-1 text-[12px] font-semibold text-ink-2">{WO_STATUS[s].label}<span className="num text-muted">{rows.filter((w) => w.status === s).length}</span></div>
                <div className="space-y-2">
                  {rows.filter((w) => w.status === s).map((w) => (
                    <Link key={w.id} to={`/taller/${w.id}`} className={cx('block rounded-md border bg-panel p-2.5 shadow-card hover:border-line-strong', overdue(w) ? 'border-bad/50' : 'border-line')}>
                      <div className="flex items-center justify-between"><UnitTag>{w.vehicles.unit_number}</UnitTag><StatusBadge map={PRIORITY} value={w.priority} /></div>
                      <div className="mt-1.5 line-clamp-2 text-[13px]">{w.reported_problem}</div>
                      <div className="mt-1.5 flex justify-between text-[11px] text-muted"><span className="num">{w.order_number}</span><span>{mechLabel(w, who).split(' ')[0]}</span></div>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className={cx(scope !== 'closed' && rows.length > 0 && 'xl:hidden')}>
        <DataTable rows={rows} loading={q.isLoading} error={q.error} columns={woColumns(who)} onRowClick={(w) => nav(`/taller/${w.id}`)} exportName="Ordenes-de-trabajo"
          empty={<EmptyState icon={Wrench} title={scope === 'mine' ? 'No tiene órdenes asignadas' : 'Sin órdenes'} />} />
      </div>
      {creating && <CreateWorkOrderModal draft={{}} onClose={() => setCreating(false)} />}
    </>
  );
}

const NEXT: Record<string, { to: string; label: string; icon: typeof Play }[]> = {
  diagnosed: [{ to: 'in_repair', label: 'Iniciar reparación', icon: Play }, { to: 'waiting_parts', label: 'Esperando piezas', icon: Package }],
  waiting_parts: [{ to: 'in_repair', label: 'Piezas recibidas · reparar', icon: Play }],
  in_repair: [{ to: 'pending_test', label: 'Pasar a prueba', icon: Check }, { to: 'waiting_parts', label: 'Esperando piezas', icon: Package }],
  pending_test: [{ to: 'in_repair', label: 'Volver a reparación', icon: Wrench }],
};

export function WorkOrderDetail() {
  const { id = '' } = useParams();
  const { can, profile, isAdmin } = useAuth();
  const who = useWho();
  const confirm = useConfirm();
  const q = useData([...keys.all, id], () => run(supabase.from('work_orders').select(WO_SELECT).eq('id', id).single()) as Promise<WorkOrder>);
  useLiveTable('work_orders', [[...keys.all, id]], `id=eq.${id}`);
  const parts = useData([...keys.all, id, 'parts'], () => run(supabase.from('work_order_parts').select('*').eq('work_order_id', id).order('created_at')) as Promise<any[]>);
  const labor = useData([...keys.all, id, 'labor'], () => run(supabase.from('work_order_labor').select('*, employees(full_name)').eq('work_order_id', id).order('work_date')) as Promise<any[]>);
  const history = useData([...keys.all, id, 'history'], () => run(supabase.from('work_order_status_history').select('*, employees(full_name)').eq('work_order_id', id).order('changed_at')) as Promise<any[]>);
  const pickers = useSlotItems('workorder.parts');
  const inv = [keys.all, fleetKeys.vehicles, ['inventory']];
  const refreshParts = () => { parts.refetch(); q.refetch(); };

  const [modal, setModal] = useState<null | 'diagnose' | 'labor' | 'complete' | 'assign' | 'manualPart'>(null);
  const [using, setUsing] = useState<any>(null);
  const [usedQty, setUsedQty] = useState('');
  const setStatus = useAction((s: string) => rpc('set_work_order_status', { p_wo: id, p_status: s }), { invalidate: inv, success: 'Estado actualizado' });
  const consume = useAction((a: { part: string; qty?: number }) => rpc('consume_work_order_part', { p_part: a.part, p_qty: a.qty ?? null }), { invalidate: inv, success: 'Pieza confirmada como utilizada' });
  const cancelPart = useAction((part: string) => rpc('cancel_work_order_part', { p_part: part }), { invalidate: inv, success: 'Pieza cancelada' });
  const close = useAction(() => rpc('close_work_order', { p_wo: id }), { invalidate: inv, success: 'Orden cerrada' });

  return (
    <QueryView q={q}>
      {(w) => {
        const open = OPEN.includes(w.status);
        const mayWork = open && (can('workorders.edit') || (can('workorders.work') && (!w.assigned_mechanic_id || w.assigned_mechanic_id === profile?.id)));
        return (
          <div className="mx-auto max-w-6xl">
            <PageHeader back="/taller" eyebrow={<>Orden <span className="num">{w.order_number}</span> · abierta {fmtDateTime(w.created_at)}{who(w.opener?.full_name, w.opened_by) && ` por ${who(w.opener?.full_name, w.opened_by)}`}</>}
              title={<span className="flex flex-wrap items-center gap-3"><Link to={`/flota/${w.vehicle_id}`} className="font-mono">{w.vehicles.unit_number}</Link><StatusBadge map={WO_STATUS} value={w.status} /><StatusBadge map={PRIORITY} value={w.priority} />{overdue(w) && <Badge tone="bad">Atrasada</Badge>}</span>}
              subtitle={w.reported_problem}
              actions={<>
                {open && can('workorders.edit') && <Button icon={UserCog} onClick={() => setModal('assign')}>{w.mechanic ? 'Reasignar' : 'Asignar'}</Button>}
                {mayWork && ['new', 'pending_diagnosis'].includes(w.status) && <Button variant="primary" icon={Stethoscope} onClick={() => setModal('diagnose')}>Diagnosticar</Button>}
                {mayWork && (NEXT[w.status] ?? []).map((n) => <Button key={n.to} icon={n.icon} loading={setStatus.isPending} onClick={() => setStatus.mutate(n.to)}>{n.label}</Button>)}
                {mayWork && ['diagnosed', 'in_repair', 'pending_test'].includes(w.status) && <Button variant="primary" icon={CheckCircle2} onClick={() => setModal('complete')}>Completar</Button>}
                {w.status === 'completed' && can('workorders.approve') && <Button variant="dark" icon={Lock} loading={close.isPending} onClick={() => close.mutate()}>Cerrar orden</Button>}
                {open && can('workorders.edit') && <Button variant="ghost" className="text-bad" icon={X} onClick={async () => {
                  if (await confirm({ title: 'Cancelar orden', body: 'Se liberan las piezas reservadas. La orden queda en el historial como cancelada.', confirm: 'Cancelar orden', danger: true })) setStatus.mutate('cancelled');
                }}>Cancelar</Button>}
              </>} />

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="space-y-4 lg:col-span-2">
                <Section title="Diagnóstico" actions={(mayWork || can('workorders.view')) && open && w.diagnosis && <Button size="sm" variant="ghost" onClick={() => setModal('diagnose')}>{isAdmin ? 'Editar' : 'Pedir cambio'}</Button>}>
                  {w.description && <p className="mb-3 text-sm text-ink-2"><span className="font-medium">Descripción: </span>{w.description}</p>}
                  {w.diagnosis ? <p className="whitespace-pre-wrap text-sm">{w.diagnosis}</p> : <p className="text-sm text-muted">Aún sin diagnóstico.</p>}
                </Section>

                <Section title="Piezas" actions={mayWork && <Button size="sm" variant="ghost" icon={Plus} onClick={() => setModal('manualPart')}>Pieza manual</Button>}>
                  {mayWork && pickers.length > 0 && (
                    <div className="mb-3 flex flex-wrap gap-2"><Slot name="workorder.parts" props={{ workOrderId: id, vehicleId: w.vehicle_id, modelId: w.vehicles.model_id, onAdded: refreshParts }} /></div>
                  )}
                  <QueryView q={parts} empty={<p className="text-sm text-muted">Sin piezas registradas.</p>}>
                    {(list) => (
                      <ul className="divide-y divide-line">
                        {list.map((p) => (
                          <li key={p.id} className="flex flex-wrap items-center gap-3 py-2.5">
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium">{p.description}</div>
                              <div className="flex flex-wrap gap-x-3 text-xs text-muted">
                                {p.part_number && <span className="num">{p.part_number}</span>}
                                <span>{p.status === 'consumed' ? `${fmtNum(p.quantity_used)} utilizada(s)` : `${fmtNum(p.quantity)} solicitada(s)`}</span>
                                {isAdmin && p.unit_cost != null && <span>{fmtMoney(p.unit_cost)} c/u</span>}
                                {p.inventory_item_id ? <span>Inventario</span> : <span>Fuera de inventario</span>}
                              </div>
                            </div>
                            <StatusBadge map={PART_STATUS} value={p.status} />
                            {mayWork && !['consumed', 'cancelled'].includes(p.status) && (
                              <span className="flex gap-1">
                                <Button size="sm" icon={Check} onClick={() => setUsing(p)}>Usada</Button>
                                <Button size="sm" variant="ghost" icon={X} onClick={() => cancelPart.mutate(p.id)} aria-label="Cancelar pieza" />
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </QueryView>
                  <p className="mt-3 text-xs text-muted">Reservar una pieza no la descuenta: se descuenta del inventario al confirmar “Usada”.</p>
                </Section>

                <Section title="Mano de obra" actions={mayWork && <Button size="sm" icon={Clock} onClick={() => setModal('labor')}>Registrar horas</Button>}>
                  <QueryView q={labor} empty={<p className="text-sm text-muted">Sin horas registradas.</p>}>
                    {(list) => (
                      <ul className="divide-y divide-line">{list.map((l) => (
                        <li key={l.id} className="flex justify-between gap-3 py-2 text-sm">
                          <span><span className="num text-muted">{fmtDate(l.work_date)}</span>{who(l.employees?.full_name, l.mechanic_id) && <> · {who(l.employees?.full_name, l.mechanic_id)}</>}{l.description && <span className="text-muted"> — {l.description}</span>}</span>
                          <span className="num shrink-0">{fmtHours(l.hours)}{isAdmin && l.rate != null && <span className="text-muted"> · {fmtMoney(l.hours * l.rate)}</span>}</span>
                        </li>
                      ))}</ul>
                    )}
                  </QueryView>
                </Section>

                <Section title="Fotografías"><Attachments moduleId={MODULE} entityType="work_order" entityId={id} canUpload={mayWork || can('workorders.edit')} /></Section>
              </div>

              <div className="space-y-4">
                <Section title="Resumen">
                  <KeyValue cols={1} items={[
                    ['Mecánico', mechLabel(w, who)], ['Fecha límite', fmtDateTime(w.due_at)],
                    ['Horas motor (entrada / salida)', <span className="num">{fmtNum(w.engine_hours_in)} / {fmtNum(w.engine_hours_out)}</span>],
                    ['Mano de obra', <span className="num">{fmtHours(w.labor_hours_total)}{isAdmin && ` · ${fmtMoney(w.labor_cost_total)}`}</span>],
                    ...(isAdmin ? [
                      ['Piezas utilizadas', <span className="num">{fmtMoney(w.parts_cost_total)}</span>],
                      ['Total', <span className="num text-base font-semibold">{fmtMoney(Number(w.labor_cost_total) + Number(w.parts_cost_total))}</span>],
                    ] as [string, React.ReactNode][] : []),
                    ['Origen', ({ manual: 'Manual', inspection: 'Inspección', incident: 'Incidente', maintenance: 'Mantenimiento', driver_report: 'Reporte del operador', public_report: 'Reporte en taller (público)' } as Record<string, string>)[w.source_type ?? 'manual']],
                  ]} />
                  {w.observations && <p className="mt-3 border-t border-line pt-3 text-sm whitespace-pre-wrap">{w.observations}</p>}
                </Section>
                <Section title="Historial de estados">
                  <ol className="space-y-2">{history.data?.map((h) => (
                    <li key={h.id} className="text-sm"><StatusBadge map={WO_STATUS} value={h.to_status} /><div className="mt-0.5 text-xs text-muted">{fmtDateTime(h.changed_at)}{isAdmin && ` · ${h.employees?.full_name ?? 'Sistema'}`}</div>{h.notes && <p className="text-[13px]">{h.notes}</p>}</li>
                  ))}</ol>
                </Section>
              </div>
            </div>

            {modal === 'diagnose' && <DiagnoseModal w={w} onClose={() => setModal(null)} />}
            {modal === 'labor' && <LaborModal woId={id} onClose={() => setModal(null)} />}
            {modal === 'complete' && <CompleteModal w={w} onClose={() => setModal(null)} />}
            {modal === 'assign' && <AssignModal w={w} onClose={() => setModal(null)} />}
            {modal === 'manualPart' && <ManualPart woId={id} onClose={() => setModal(null)} onAdded={refreshParts} />}
            {using && (
              <Modal open onClose={() => setUsing(null)} title="Confirmar pieza utilizada" size="sm"
                footer={<><Button onClick={() => setUsing(null)}>Cancelar</Button>
                  <Button variant="primary" loading={consume.isPending} onClick={() => { const n = Number(usedQty || using.quantity); if (n > 0) consume.mutate({ part: using.id, qty: n }, { onSuccess: () => setUsing(null) }); }}>Confirmar</Button></>}>
                <p className="mb-3 text-sm">{using.description}{using.inventory_item_id && <span className="text-muted"> · se descuenta del inventario</span>}</p>
                <Field label="Cantidad utilizada" hint={`Solicitada: ${fmtNum(using.quantity)}. Si usó menos, el resto se libera.`}>
                  <Input type="number" min="0.01" step="1" inputMode="decimal" autoFocus value={usedQty} placeholder={String(Number(using.quantity))} onChange={(e) => setUsedQty(e.target.value)} />
                </Field>
              </Modal>
            )}
          </div>
        );
      }}
    </QueryView>
  );
}

function DiagnoseModal({ w, onClose }: { w: WorkOrder; onClose: () => void }) {
  const [text, setText] = useState(w.diagnosis ?? '');
  const { save: saveOrRequest, isAdmin } = useSaveOrRequest();
  // Un diagnóstico ya guardado solo lo cambia el admin; los demás envían solicitud
  const asRequest = !!w.diagnosis && !isAdmin;
  const save = useAction(() => asRequest
      ? saveOrRequest('work_orders', w.id, { diagnosis: text }, w as unknown as Record<string, unknown>)
      : rpc('diagnose_work_order', { p_wo: w.id, p_diagnosis: text }),
    { invalidate: [keys.all], success: asRequest ? savedMsg() : 'Diagnóstico registrado', onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title={asRequest ? 'Pedir cambio de diagnóstico' : 'Diagnóstico'} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>{asRequest ? 'Enviar solicitud' : 'Guardar'}</Button></>}>
      {asRequest && <p className="mb-3 rounded-md bg-info-soft px-3 py-2 text-[13px] text-info">El diagnóstico ya fue guardado. Su cambio se enviará al administrador para aprobación.</p>}
      <p className="mb-2 text-sm text-muted">Problema reportado: {w.reported_problem}</p>
      <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Causa encontrada, pruebas realizadas y reparación necesaria" />
    </Modal>
  );
}

function LaborModal({ woId, onClose }: { woId: string; onClose: () => void }) {
  const { can, profile } = useAuth();
  const [v, setV] = useState({ hours: '', description: '', mechanic: profile?.id ?? '', date: new Date().toISOString().slice(0, 10), rate: '' });
  const save = useAction(() => rpc('add_work_order_labor', { p_wo: woId, p_hours: Number(v.hours), p_description: v.description || null,
    p_mechanic: v.mechanic || null, p_date: v.date, p_rate: v.rate === '' ? null : Number(v.rate) }), { invalidate: [keys.all], success: 'Horas registradas', onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title="Registrar horas de trabajo" size="sm" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!(Number(v.hours) > 0)} loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button></>}>
      <div className="space-y-3">
        <FormGrid>
          <Field label="Horas"><Input type="number" step="0.25" min="0.25" inputMode="decimal" value={v.hours} onChange={(e) => setV({ ...v, hours: e.target.value })} /></Field>
          <Field label="Fecha"><Input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
        </FormGrid>
        {can('workorders.edit') && <FormGrid>
          <Field label="Mecánico"><EmployeeSelect value={v.mechanic} onChange={(id) => setV({ ...v, mechanic: id })} roles={['mechanic', 'supervisor', 'admin']} /></Field>
          <Field label="Tarifa por hora" hint="Vacío: tarifa predeterminada"><Input type="number" step="0.01" value={v.rate} onChange={(e) => setV({ ...v, rate: e.target.value })} /></Field>
        </FormGrid>}
        <Field label="Trabajo realizado"><Textarea rows={2} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function CompleteModal({ w, onClose }: { w: WorkOrder; onClose: () => void }) {
  const [v, setV] = useState({ notes: '', hours: '', back: true });
  const save = useAction(() => rpc('complete_work_order', { p_wo: w.id, p_notes: v.notes || null, p_engine_hours: v.hours === '' ? null : Number(v.hours), p_return_to_service: v.back }),
    { invalidate: [keys.all, fleetKeys.vehicles], success: 'Reparación completada y registrada en el historial del vehículo', onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title={`Completar ${w.order_number}`} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Completar</Button></>}>
      <div className="space-y-3">
        <Field label="Horas de motor al entregar"><Input type="number" step="0.1" inputMode="decimal" value={v.hours} onChange={(e) => setV({ ...v, hours: e.target.value })} /></Field>
        <Field label="Notas de cierre / prueba"><Textarea value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
        <Checkbox label="Devolver el vehículo a servicio" checked={v.back} onChange={(e) => setV({ ...v, back: e.target.checked })} />
        <p className="text-xs text-muted">Todas las piezas deben estar confirmadas como utilizadas o canceladas. Las reservas sin usar se liberan.</p>
      </div>
    </Modal>
  );
}

function AssignModal({ w, onClose }: { w: WorkOrder; onClose: () => void }) {
  const [m, setM] = useState(w.assigned_mechanic_id ?? '');
  const [prio, setPrio] = useState(w.priority);
  const { save: saveOrRequest } = useSaveOrRequest();
  const save = useAction(async () => {
    if (m && m !== w.assigned_mechanic_id) await rpc('assign_work_order', { p_wo: w.id, p_mechanic: m });
    if (prio !== w.priority) return saveOrRequest('work_orders', w.id, { priority: prio });
    return 'saved' as const;
  }, { invalidate: [keys.all], success: savedMsg('Orden actualizada'), onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title="Asignación" size="sm" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button></>}>
      <div className="space-y-3">
        <Field label="Mecánico"><EmployeeSelect value={m} onChange={setM} roles={['mechanic']} /></Field>
        <Field label="Prioridad"><Select value={prio} onChange={(e) => setPrio(e.target.value)} options={Object.entries(PRIORITY).map(([value, p]) => ({ value, label: p.label }))} /></Field>
      </div>
    </Modal>
  );
}

function ManualPart({ woId, onClose, onAdded }: { woId: string; onClose: () => void; onAdded: () => void }) {
  const { isAdmin } = useAuth();
  const [v, setV] = useState({ description: '', part_number: '', quantity: '1', unit_cost: '', to_purchase: false });
  const save = useAction(() => rpc('add_work_order_part', { p_wo: woId, p: { description: v.description, part_number: v.part_number || null, quantity: Number(v.quantity) || 1,
    unit_cost: v.unit_cost === '' ? null : Number(v.unit_cost), to_purchase: v.to_purchase } }), { invalidate: [keys.all, ['inventory']], success: 'Pieza añadida', onSuccess: () => { onAdded(); onClose(); } });
  return (
    <Modal open onClose={onClose} title="Pieza (fuera de inventario)" size="sm" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!v.description.trim()} loading={save.isPending} onClick={() => save.mutate()}>Añadir</Button></>}>
      <div className="space-y-3">
        <Field label="Descripción"><Input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
        <FormGrid cols={isAdmin ? 3 : 2}>
          <Field label="Nº de pieza"><Input className="h-10 font-mono" value={v.part_number} onChange={(e) => setV({ ...v, part_number: e.target.value })} /></Field>
          <Field label="Cantidad"><Input type="number" min="1" value={v.quantity} onChange={(e) => setV({ ...v, quantity: e.target.value })} /></Field>
          {isAdmin && <Field label="Costo c/u"><Input type="number" step="0.01" value={v.unit_cost} onChange={(e) => setV({ ...v, unit_cost: e.target.value })} /></Field>}
        </FormGrid>
        <Checkbox label="Hay que comprarla (crea solicitud de compra si hay inventario)" checked={v.to_purchase} onChange={(e) => setV({ ...v, to_purchase: e.target.checked })} />
      </div>
    </Modal>
  );
}

// ---- Expedientes, dashboard y reportes ----
export function VehicleWorkOrdersTab({ vehicleId }: { vehicleId: string }) {
  const q = useWorkOrders({ vehicleId, scope: 'all' });
  const who = useWho();
  const nav = useNavigate();
  return <DataTable rows={q.data} loading={q.isLoading} error={q.error} columns={woColumns(who, false)} onRowClick={(w) => nav(`/taller/${w.id}`)} exportName="Ordenes-vehiculo" empty={<EmptyState icon={Wrench} title="Sin órdenes de trabajo" />} />;
}

export function OpenOrdersKpi() {
  const q = useWorkOrders({ scope: 'open' });
  const late = q.data?.filter((w) => overdue(w)).length ?? 0;
  return <StatCard label="Órdenes de trabajo abiertas" value={q.data?.length ?? '—'} tone={late ? 'bad' : 'info'} icon={Wrench} to="/taller" hint={late ? `${late} atrasada(s)` : undefined} />;
}

export function PendingRepairsWidget() {
  const q = useWorkOrders({ scope: 'open' });
  return (
    <Section title="Reparaciones pendientes" actions={<Link to="/taller" className="text-xs text-muted hover:text-ink">Taller</Link>}>
      {!q.data?.length ? <EmptyState icon={Wrench} title="Sin reparaciones pendientes" /> : (
        <ul className="divide-y divide-line">{q.data.slice(0, 8).map((w) => (
          <li key={w.id}><Link to={`/taller/${w.id}`} className="flex items-center gap-3 py-2 text-sm hover:underline">
            <UnitTag>{w.vehicles.unit_number}</UnitTag><span className="flex-1 truncate">{w.reported_problem}</span><StatusBadge map={WO_STATUS} value={w.status} />
          </Link></li>
        ))}</ul>
      )}
    </Section>
  );
}

export function MechanicActivityReport() {
  const q = useData(['work_orders', 'report', 'mechanics'], () => run(supabase.from('workorders_mechanic_activity').select('*').order('month', { ascending: false })) as Promise<any[]>);
  return <DataTable rows={q.data} loading={q.isLoading} error={q.error} exportName="Actividad-mecanicos" rowKey={(r) => r.mechanic_id + r.month} columns={[
    { key: 'month', header: 'Mes', mobile: 'title', render: (r) => <span className="num">{String(r.month).slice(0, 7)}</span> },
    { key: 'mechanic_name', header: 'Mecánico' },
    { key: 'orders', header: 'Órdenes', align: 'right' },
    { key: 'hours', header: 'Horas', align: 'right', render: (r) => <span className="num">{fmtHours(r.hours)}</span> },
    { key: 'labor_cost', header: 'Mano de obra', align: 'right', render: (r) => <span className="num">{fmtMoney(r.labor_cost)}</span> },
  ]} />;
}

export function RepairsByVehicleReport() {
  const q = useData(['work_orders', 'report', 'vehicles'], () => run(supabase.from('workorders_by_vehicle').select('*').order('total_cost', { ascending: false })) as Promise<any[]>);
  return <DataTable rows={q.data} loading={q.isLoading} error={q.error} exportName="Reparaciones-por-vehiculo" rowKey={(r) => r.vehicle_id} columns={[
    { key: 'unit_number', header: 'Vehículo', mobile: 'title', render: (r) => <UnitTag>{r.unit_number}</UnitTag> },
    { key: 'orders', header: 'Órdenes', align: 'right' },
    { key: 'open', header: 'Abiertas', align: 'right' },
    { key: 'labor_hours', header: 'Horas', align: 'right', render: (r) => <span className="num">{fmtHours(r.labor_hours)}</span> },
    { key: 'total_cost', header: 'Costo total', align: 'right', render: (r) => <span className="num">{fmtMoney(r.total_cost)}</span> },
    { key: 'last_order_at', header: 'Última', render: (r) => fmtDate(r.last_order_at) },
  ]} />;
}

export function MyShopCard() {
  const { profile } = useAuth();
  const q = useWorkOrders({ scope: 'open', mechanicId: profile?.id });
  if (!q.data?.length) return null;
  return (
    <Card className="mb-4"><div className="mb-2 text-sm font-semibold">Mis órdenes abiertas</div>
      <ul className="space-y-1.5">{q.data.slice(0, 5).map((w) => <li key={w.id}><Link to={`/taller/${w.id}`} className="flex items-center gap-2 text-sm"><UnitTag>{w.vehicles.unit_number}</UnitTag><span className="flex-1 truncate">{w.reported_problem}</span><StatusBadge map={WO_STATUS} value={w.status} /></Link></li>)}</ul>
    </Card>
  );
}
