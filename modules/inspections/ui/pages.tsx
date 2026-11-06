import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ClipboardCheck, Plus, ShieldCheck, ThumbsDown, ThumbsUp } from 'lucide-react';
import { supabase } from '@core/data/supabase';
import { rpc, run, useAction, useData } from '@core/data/api';
import { useAttachments, VEHICLE_STATUS } from '@core/data/shared';
import { useLiveTable } from '@core/data/realtime';
import { Can, useAuth, useWho } from '@core/auth/AuthProvider';
import { Slot } from '@core/modules/Slot';
import { Badge, Button, Card, EmptyState, KeyValue, LinkButton, PageHeader, QueryView, Section, StatusBadge, Tabs, UnitTag, cx } from '@core/ui/primitives';
import { DataTable, type Column } from '@core/ui/DataTable';
import { Field, Textarea } from '@core/ui/form';
import { AttachmentGrid } from '@core/ui/media';
import { fmtDateTime, fmtNum, fmtTime } from '@core/lib/format';
import { FUEL_LEVELS, ITEM_RESULT, keys, RESULT, useCompliance, useInspections, type Inspection } from './data';

export const inspectionColumns = (withVehicle = true): Column<Inspection>[] => [
  { key: 'completed_at', header: 'Fecha', mobile: 'title', render: (i) => <span className="num">{fmtDateTime(i.completed_at)}</span> },
  ...(withVehicle ? [{ key: 'unit', header: 'Unidad', value: (i: Inspection) => i.vehicles?.unit_number, render: (i: Inspection) => <UnitTag>{i.vehicles?.unit_number}</UnitTag> }] : []),
  { key: 'employee', header: 'Inspector', admin: true, value: (i) => i.employees?.full_name },
  { key: 'result', header: 'Resultado', value: (i) => RESULT[i.result]?.label, render: (i) => <StatusBadge map={RESULT} value={i.result} /> },
  { key: 'engine_hours', header: 'Horas', align: 'right', mobile: 'hide', render: (i) => <span className="num">{i.engine_hours != null ? fmtNum(i.engine_hours) : '—'}</span> },
  { key: 'reviewed', header: 'Revisada', mobile: 'hide', value: (i) => (i.reviewed_at ? 'Sí' : 'No'), render: (i) => i.reviewed_at ? <ShieldCheck className="size-4 text-ok" /> : <span className="text-faint">—</span> },
];

export function InspectionsPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'history' | 'today'>(can('inspections.view') ? 'today' : 'history');
  const q = useInspections();
  const nav = useNavigate();
  useLiveTable('inspections', [keys.all]);
  return (
    <>
      <PageHeader title="Inspecciones" actions={<Can perm="inspections.perform"><LinkButton to="/inspecciones/nueva" variant="primary" icon={Plus}>Nueva inspección</LinkButton></Can>} />
      {can('inspections.view') && <Tabs value={tab} onChange={setTab} tabs={[{ id: 'today', label: 'Hoy' }, { id: 'history', label: 'Historial' }]} />}
      {tab === 'today' ? <Compliance /> : (
        <DataTable rows={q.data} loading={q.isLoading} error={q.error} columns={inspectionColumns()} onRowClick={(i) => nav(`/inspecciones/${i.id}`)}
          exportName="Inspecciones" empty={<EmptyState icon={ClipboardCheck} title="Sin inspecciones" />} />
      )}
    </>
  );
}

function Compliance() {
  const q = useCompliance();
  const nav = useNavigate();
  const pending = q.data?.filter((r) => !r.inspected_today) ?? [];
  return (
    <div className="space-y-3">
      {q.data && (
        <div className="grid grid-cols-3 gap-3">
          <Card><div className="text-xs text-muted">Por inspeccionar</div><div className="num text-2xl font-semibold">{q.data.length}</div></Card>
          <Card><div className="text-xs text-muted">Completadas</div><div className="num text-2xl font-semibold text-ok">{q.data.length - pending.length}</div></Card>
          <Card><div className="text-xs text-muted">Pendientes</div><div className="num text-2xl font-semibold text-warn">{pending.length}</div></Card>
        </div>
      )}
      <DataTable rows={q.data} loading={q.isLoading} error={q.error} rowKey={(r) => r.vehicle_id} search={false}
        onRowClick={(r) => nav(r.inspection_id ? `/inspecciones/${r.inspection_id}` : `/flota/${r.vehicle_id}`)}
        empty={<EmptyState title="No hay vehículos asignados ni en operación hoy" />}
        columns={[
          { key: 'unit_number', header: 'Unidad', mobile: 'title', render: (r) => <UnitTag>{r.unit_number}</UnitTag> },
          { key: 'employee_name', header: 'Operador', admin: true, render: (r) => r.employee_name ?? <span className="text-faint">Sin asignar</span> },
          { key: 'status', header: 'Vehículo', render: (r) => <StatusBadge map={VEHICLE_STATUS} value={r.status} /> },
          { key: 'inspected_today', header: 'Inspección de hoy', render: (r) => r.inspected_today
            ? <span className="flex items-center gap-2"><StatusBadge map={RESULT} value={r.result} /><span className="num text-xs text-muted">{fmtTime(r.completed_at)}</span></span>
            : <Badge tone="warn">Pendiente</Badge> },
        ]} />
    </div>
  );
}

export function InspectionDetail() {
  const { id = '' } = useParams();
  const who = useWho();
  const q = useData([...keys.all, id], async () => {
    const [ins, results] = await Promise.all([
      run(supabase.from('inspections').select('*, vehicles(id, unit_number), employees!inspections_employee_id_fkey(full_name), reviewer:employees!inspections_reviewed_by_fkey(full_name)').eq('id', id).single()) as Promise<any>,
      run(supabase.from('inspection_results').select('*').eq('inspection_id', id)) as Promise<any[]>,
    ]);
    return { ins, results };
  });
  const resultIds = q.data?.results.map((r) => r.id) ?? [];
  const photos = useAttachments('inspection_result', resultIds);
  const general = useAttachments('inspection', [id]);
  const [review, setReview] = useState('');
  const doReview = useAction(() => rpc('review_inspection', { p_inspection: id, p_notes: review || null }), { invalidate: [keys.all], success: 'Inspección revisada' });

  return (
    <QueryView q={q}>
      {({ ins, results }) => {
        const fails = results.filter((r) => r.result === 'fail' || (r.result === 'rating' && r.score <= 4));
        const summary = `Inspección ${fmtDateTime(ins.completed_at)}: ` + (fails.map((r) => `${r.label}${r.result === 'rating' ? ` (nota ${r.score}/10)` : ''}${r.comment ? ` (${r.comment})` : ''}`).join('; ') || 'sin fallas');
        return (
          <div className="mx-auto max-w-4xl">
            <PageHeader back="/inspecciones" eyebrow={`Inspección · ${fmtDateTime(ins.completed_at)}`}
              title={<span className="flex flex-wrap items-center gap-3"><span className="font-mono">{ins.vehicles?.unit_number}</span><StatusBadge map={RESULT} value={ins.result} /></span>}
              subtitle={who(ins.employees?.full_name, ins.employee_id) ? `Por ${who(ins.employees?.full_name, ins.employee_id)}` : undefined}
              actions={fails.length > 0 && <Slot name="inspection.actions" props={{ inspectionId: id, vehicleId: ins.vehicle_id, summary }} />} />
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-4 md:col-span-2">
                <Section title={`Puntos evaluados · ${fails.length} con problema`}>
                  <ul className="-my-2 divide-y divide-line">
                    {[...fails, ...results.filter((r) => r.result !== 'fail')].map((r) => (
                      <li key={r.id} className="py-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium">{r.label}{r.is_critical && <span className="ml-1.5 text-[10px] font-semibold uppercase text-bad">crítico</span>}</span>
                          {r.result === 'rating'
                            ? <span className={cx('num rounded-full border px-2.5 py-0.5 text-[13px] font-semibold', r.score <= 4 ? 'border-bad/40 bg-bad-soft text-bad' : 'border-line')}>{r.score}<span className="font-normal text-muted">/10</span></span>
                            : <span className="flex items-center gap-1.5">{r.result === 'ok' ? <ThumbsUp className="size-4 text-ok" /> : r.result === 'fail' ? <ThumbsDown className="size-4 text-bad" /> : null}<StatusBadge map={ITEM_RESULT} value={r.result} /></span>}
                        </div>
                        {r.comment && <p className="mt-1 text-sm text-ink-2">{r.comment}</p>}
                        <div className="mt-2"><AttachmentGrid items={(photos.data ?? []).filter((p) => p.entity_id === r.id)} /></div>
                      </li>
                    ))}
                  </ul>
                </Section>
              </div>
              <div className="space-y-4">
                <Section title="Datos">
                  <KeyValue cols={1} items={[
                    ['Vehículo', <Link to={`/flota/${ins.vehicle_id}`} className="underline">{ins.vehicles?.unit_number}</Link>],
                    ['Horas de motor', ins.engine_hours != null ? `${fmtNum(ins.engine_hours)} h` : null],
                    ['Millaje', ins.mileage != null ? fmtNum(ins.mileage) : null],
                    ['Combustible', FUEL_LEVELS.find((f) => f.value === ins.fuel_level)?.label],
                    ['No apto', ins.marked_unfit ? 'Sí' : 'No'],
                    ['Ubicación', ins.lat ? <a className="underline" target="_blank" rel="noopener" href={`https://maps.google.com/?q=${ins.lat},${ins.lng}`}>Ver mapa</a> : null],
                  ]} />
                  {ins.notes && <p className="mt-3 border-t border-line pt-3 text-sm">{ins.notes}</p>}
                  <div className="mt-3"><AttachmentGrid items={general.data ?? []} /></div>
                </Section>
                <Section title="Revisión">
                  {ins.reviewed_at ? (
                    <div className="text-sm"><div className="font-medium text-ok">Revisada{who(ins.reviewer?.full_name, ins.reviewed_by) && ` por ${who(ins.reviewer?.full_name, ins.reviewed_by)}`}</div>
                      <div className="text-xs text-muted">{fmtDateTime(ins.reviewed_at)}</div>{ins.review_notes && <p className="mt-2">{ins.review_notes}</p>}</div>
                  ) : (
                    <Can perm="inspections.approve" fallback={<p className="text-sm text-muted">Pendiente de revisión</p>}>
                      <Field label="Notas de revisión"><Textarea rows={2} value={review} onChange={(e) => setReview(e.target.value)} /></Field>
                      <Button className="mt-2" variant="primary" icon={ShieldCheck} loading={doReview.isPending} onClick={() => doReview.mutate()}>Marcar revisada</Button>
                    </Can>
                  )}
                </Section>
              </div>
            </div>
          </div>
        );
      }}
    </QueryView>
  );
}

/** Pestaña en el expediente del vehículo */
export function VehicleInspectionsTab({ vehicleId }: { vehicleId: string }) {
  const q = useInspections({ vehicleId });
  const nav = useNavigate();
  return <DataTable rows={q.data} loading={q.isLoading} error={q.error} columns={inspectionColumns(false)} onRowClick={(i) => nav(`/inspecciones/${i.id}`)} exportName="Inspecciones-vehiculo" />;
}

/** Pestaña en el expediente del empleado */
export function EmployeeInspectionsTab({ employeeId }: { employeeId: string }) {
  const q = useInspections({ employeeId });
  const nav = useNavigate();
  return <DataTable rows={q.data} loading={q.isLoading} error={q.error} columns={inspectionColumns()} onRowClick={(i) => nav(`/inspecciones/${i.id}`)} />;
}
