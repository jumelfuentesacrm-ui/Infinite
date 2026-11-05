import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, MapPin, Plus, Siren, Trash2, ShieldAlert } from 'lucide-react';
import { supabase } from '@core/data/supabase';
import { rpc, run, useAction, useData } from '@core/data/api';
import { attachFile } from '@core/data/storage';
import { fleetKeys, useMyVehicle } from '@core/data/shared';
import { useLiveTable } from '@core/data/realtime';
import { Can, useAuth } from '@core/auth/AuthProvider';
import { Slot } from '@core/modules/Slot';
import { getPosition, type Position } from '@core/lib/geo';
import { fmtDateTime, toLocalInput } from '@core/lib/format';
import { Badge, Button, Card, EmptyState, KeyValue, PageHeader, QueryView, Section, StatCard, StatusBadge, UnitTag, cx } from '@core/ui/primitives';
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from '@core/ui/form';
import { VehicleSelect } from '@core/ui/pickers';
import { Attachments, FilePicker } from '@core/ui/media';
import { DataTable } from '@core/ui/DataTable';
import type { StatusMap } from '@core/ui/primitives';

const MODULE = 'accidents';
const keys = { all: ['incidents'] as const };
export const TYPES: Record<string, string> = {
  collision: 'Choque', rollover: 'Volcadura', injury: 'Lesión', property_damage: 'Daño a propiedad', near_miss: 'Casi accidente',
  mechanical_failure: 'Falla mecánica en ruta', theft: 'Robo / vandalismo', other: 'Otro',
};
export const SEVERITY: StatusMap = { minor: { label: 'Leve', tone: 'info' }, moderate: { label: 'Moderado', tone: 'warn' }, major: { label: 'Grave', tone: 'bad' }, critical: { label: 'Crítico', tone: 'bad' } };
export const STATUS: StatusMap = {
  reported: { label: 'Reportado', tone: 'brand' }, in_review: { label: 'En revisión', tone: 'warn' }, investigating: { label: 'En investigación', tone: 'warn' },
  resolved: { label: 'Resuelto', tone: 'ok' }, closed: { label: 'Cerrado', tone: 'idle' },
};
const ROLES: Record<string, string> = { driver: 'Conductor', passenger: 'Pasajero', witness: 'Testigo', third_party: 'Tercero', other: 'Otro' };

type Person = { full_name: string; role: string; phone: string; injured: boolean };

export function ReportIncident() {
  const nav = useNavigate();
  const { can } = useAuth();
  const mine = useMyVehicle();
  const [v, setV] = useState({ incident_type: '', severity: 'minor', vehicle_id: '', occurred_at: toLocalInput(), location_text: '', description: '', observations: '', injuries: false, vehicle_operable: true });
  const [people, setPeople] = useState<Person[]>([]);
  const [photos, setPhotos] = useState<File[]>([]);
  const [pos, setPos] = useState<Position | null | 'loading'>('loading');
  useEffect(() => { getPosition().then(setPos); }, []);
  useEffect(() => { if (mine.data && !v.vehicle_id) setV((x) => ({ ...x, vehicle_id: mine.data!.id })); }, [mine.data, v.vehicle_id]);

  const submit = useAction(async () => {
    if (!v.incident_type) throw new Error('Seleccione qué ocurrió');
    if (v.description.trim().length < 4) throw new Error('Describa lo ocurrido');
    const p = pos && pos !== 'loading' ? pos : null;
    const res = await rpc<{ id: string; incident_number: string }>('report_incident', { p: { ...v, vehicle_id: v.vehicle_id || null,
      occurred_at: new Date(v.occurred_at).toISOString(), lat: p?.lat ?? null, lng: p?.lng ?? null, people } });
    for (const f of photos) await attachFile(MODULE, 'incident', res.id, f);
    return res;
  }, { invalidate: [keys.all, fleetKeys.vehicles], success: (r) => `Incidente ${r.incident_number} reportado. Se notificó a la administración.`, onSuccess: (r) => nav(`/incidentes/${r.id}`, { replace: true }) });

  return (
    <div className="mx-auto max-w-2xl pb-24">
      <PageHeader title="Reportar accidente o incidente" back={can('accidents.view') ? '/incidentes' : '/m'} />
      <div className="mb-4 flex items-start gap-3 rounded-card border border-bad/30 bg-bad-soft p-3 text-sm text-bad">
        <Siren className="mt-0.5 size-5 shrink-0" /><span>Si hay heridos o peligro inmediato, llame primero al <b>911</b>. Luego complete este reporte.</span>
      </div>
      <div className="space-y-4">
        <Card>
          <div className="mb-2 text-[13px] font-medium text-ink-2">¿Qué ocurrió? <span className="text-bad">*</span></div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Object.entries(TYPES).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setV({ ...v, incident_type: k })}
                className={cx('rounded-md border px-2 py-2.5 text-sm font-medium', v.incident_type === k ? 'border-bad bg-bad text-white' : 'border-line-strong bg-panel')}>{label}</button>
            ))}
          </div>
        </Card>
        <Card className="space-y-4">
          <FormGrid>
            <Field label="Vehículo"><VehicleSelect value={v.vehicle_id} onChange={(id) => setV({ ...v, vehicle_id: id })} placeholder="Sin vehículo" /></Field>
            <Field label="Gravedad"><Select value={v.severity} onChange={(e) => setV({ ...v, severity: e.target.value })} options={Object.entries(SEVERITY).map(([value, s]) => ({ value, label: s.label }))} /></Field>
            <Field label="Fecha y hora"><Input type="datetime-local" value={v.occurred_at} max={toLocalInput()} onChange={(e) => setV({ ...v, occurred_at: e.target.value })} /></Field>
            <Field label="Lugar" hint={pos === 'loading' ? 'Obteniendo GPS…' : pos ? `GPS capturado (±${Math.round(pos.accuracy)} m)` : 'Sin GPS: describa el lugar'}>
              <Input value={v.location_text} onChange={(e) => setV({ ...v, location_text: e.target.value })} placeholder="Ej. camino a la finca, km 3" />
            </Field>
          </FormGrid>
          <Field label="Descripción" required><Textarea rows={4} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} placeholder="Qué pasó, cómo y daños visibles" /></Field>
          <div className="flex flex-wrap gap-5">
            <Checkbox label="Hubo personas lesionadas" checked={v.injuries} onChange={(e) => setV({ ...v, injuries: e.target.checked })} />
            <Checkbox label="El vehículo NO puede seguir operando" checked={!v.vehicle_operable} onChange={(e) => setV({ ...v, vehicle_operable: !e.target.checked })} />
          </div>
          <Field label="Fotografías"><FilePicker files={photos} onChange={setPhotos} max={10} /></Field>
        </Card>
        <Section title="Personas involucradas" actions={<Button size="sm" icon={Plus} onClick={() => setPeople([...people, { full_name: '', role: 'witness', phone: '', injured: false }])}>Añadir</Button>}>
          {!people.length && <p className="text-sm text-muted">Conductores de otros vehículos, testigos, lesionados…</p>}
          <div className="space-y-3">
            {people.map((p, i) => {
              const upd = (patch: Partial<Person>) => setPeople(people.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <div key={i} className="grid gap-2 rounded-md border border-line p-2 sm:grid-cols-[1fr_140px_140px_auto]">
                  <Input placeholder="Nombre" value={p.full_name} onChange={(e) => upd({ full_name: e.target.value })} />
                  <Select value={p.role} onChange={(e) => upd({ role: e.target.value })} options={Object.entries(ROLES).map(([value, label]) => ({ value, label }))} />
                  <Input placeholder="Teléfono" type="tel" value={p.phone} onChange={(e) => upd({ phone: e.target.value })} />
                  <div className="flex items-center justify-between gap-2">
                    <Checkbox label="Lesionado" checked={p.injured} onChange={(e) => upd({ injured: e.target.checked })} />
                    <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setPeople(people.filter((_, j) => j !== i))} aria-label="Quitar" />
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
        <Card><Field label="Observaciones adicionales"><Textarea value={v.observations} onChange={(e) => setV({ ...v, observations: e.target.value })} /></Field></Card>
      </div>
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-panel/95 px-4 pt-3 backdrop-blur md:static md:mt-4 md:border-0 md:bg-transparent md:p-0">
        <Button variant="danger" size="lg" block icon={AlertTriangle} loading={submit.isPending} onClick={() => submit.mutate()}>Enviar reporte</Button>
      </div>
    </div>
  );
}

interface Incident { id: string; incident_number: string; incident_type: string; severity: string; status: string; occurred_at: string; description: string; vehicle_id: string | null; vehicles: { unit_number: string } | null; employees: { full_name: string } | null; injuries: boolean }
const useIncidents = (vehicleId?: string) => useData([...keys.all, vehicleId], () => {
  let q = supabase.from('incidents').select('*, vehicles(unit_number), employees!incidents_reported_by_fkey(full_name)').order('occurred_at', { ascending: false }).limit(500);
  if (vehicleId) q = q.eq('vehicle_id', vehicleId);
  return run(q) as Promise<Incident[]>;
});

const columns = [
  { key: 'incident_number', header: 'Número', mobile: 'title' as const, render: (i: Incident) => <span className="num font-medium">{i.incident_number}</span> },
  { key: 'occurred_at', header: 'Fecha', render: (i: Incident) => <span className="num text-[13px]">{fmtDateTime(i.occurred_at)}</span> },
  { key: 'type', header: 'Tipo', value: (i: Incident) => TYPES[i.incident_type] },
  { key: 'unit', header: 'Vehículo', value: (i: Incident) => i.vehicles?.unit_number, render: (i: Incident) => i.vehicles ? <UnitTag>{i.vehicles.unit_number}</UnitTag> : '—' },
  { key: 'severity', header: 'Gravedad', value: (i: Incident) => SEVERITY[i.severity]?.label, render: (i: Incident) => <span className="flex gap-1"><StatusBadge map={SEVERITY} value={i.severity} />{i.injuries && <Badge tone="bad" dot={false}>Lesionados</Badge>}</span> },
  { key: 'status', header: 'Estado', value: (i: Incident) => STATUS[i.status]?.label, render: (i: Incident) => <StatusBadge map={STATUS} value={i.status} /> },
  { key: 'reporter', header: 'Reportó', mobile: 'hide' as const, value: (i: Incident) => i.employees?.full_name },
];

export function IncidentsPage() {
  const q = useIncidents();
  const nav = useNavigate();
  useLiveTable('incidents', [keys.all]);
  return (
    <>
      <PageHeader title="Accidentes e incidentes" actions={<Can perm="accidents.report"><Button variant="danger" icon={AlertTriangle} onClick={() => nav('/incidentes/nuevo')}>Reportar</Button></Can>} />
      <DataTable rows={q.data} loading={q.isLoading} error={q.error} columns={columns} onRowClick={(i) => nav(`/incidentes/${i.id}`)} exportName="Incidentes"
        empty={<EmptyState icon={ShieldAlert} title="Sin incidentes reportados" />} />
    </>
  );
}

export function VehicleIncidentsTab({ vehicleId }: { vehicleId: string }) {
  const q = useIncidents(vehicleId);
  const nav = useNavigate();
  return <DataTable rows={q.data} loading={q.isLoading} error={q.error} columns={columns} onRowClick={(i) => nav(`/incidentes/${i.id}`)} search={false} />;
}

export function IncidentDetail() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const q = useData([...keys.all, id], async () => {
    const [inc, people, history] = await Promise.all([
      run(supabase.from('incidents').select('*, vehicles(unit_number), employees!incidents_reported_by_fkey(full_name)').eq('id', id).single()) as Promise<any>,
      run(supabase.from('incident_people').select('*').eq('incident_id', id)) as Promise<any[]>,
      run(supabase.from('incident_status_history').select('*, employees(full_name)').eq('incident_id', id).order('changed_at')) as Promise<any[]>,
    ]);
    return { inc, people, history };
  });
  const [status, setStatus] = useState('');
  const [notes, setNotes] = useState('');
  const change = useAction(() => rpc('set_incident_status', { p_id: id, p_status: status, p_notes: notes || null }),
    { invalidate: [keys.all], success: 'Seguimiento actualizado', onSuccess: () => { setStatus(''); setNotes(''); } });
  return (
    <QueryView q={q}>
      {({ inc, people, history }) => (
        <div className="mx-auto max-w-5xl">
          <PageHeader back="/incidentes" eyebrow={TYPES[inc.incident_type]}
            title={<span className="flex flex-wrap items-center gap-3"><span className="num">{inc.incident_number}</span><StatusBadge map={STATUS} value={inc.status} /><StatusBadge map={SEVERITY} value={inc.severity} /></span>}
            subtitle={`Reportado por ${inc.employees?.full_name} · ${fmtDateTime(inc.created_at)}`}
            actions={<Slot name="incident.actions" props={{ incidentId: id, vehicleId: inc.vehicle_id, summary: `${inc.incident_number}: ${inc.description}` }} />} />
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <Section title="Descripción">
                <p className="whitespace-pre-wrap text-sm">{inc.description}</p>
                {inc.observations && <p className="mt-3 border-t border-line pt-3 text-sm text-ink-2">{inc.observations}</p>}
              </Section>
              <Section title="Fotografías y documentos"><Attachments moduleId={MODULE} entityType="incident" entityId={id} canUpload={can(['accidents.edit', 'accidents.report'])} /></Section>
              <Section title={`Personas involucradas (${people.length})`}>
                {!people.length ? <p className="text-sm text-muted">Ninguna registrada</p> : (
                  <ul className="divide-y divide-line">{people.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <span className="font-medium">{p.full_name}</span>
                      <span className="flex items-center gap-2 text-muted">{ROLES[p.role]}{p.phone && <a href={`tel:${p.phone}`} className="underline">{p.phone}</a>}{p.injured && <Badge tone="bad">Lesionado</Badge>}</span>
                    </li>))}</ul>
                )}
              </Section>
            </div>
            <div className="space-y-4">
              <Section title="Datos">
                <KeyValue cols={1} items={[
                  ['Ocurrió', fmtDateTime(inc.occurred_at)],
                  ['Vehículo', inc.vehicle_id ? <Link to={`/flota/${inc.vehicle_id}`} className="underline">{inc.vehicles?.unit_number}</Link> : null],
                  ['Lugar', inc.location_text], ['Lesionados', inc.injuries ? 'Sí' : 'No'], ['Vehículo operable', inc.vehicle_operable === false ? 'No' : 'Sí'],
                  ['GPS', inc.lat ? <a className="inline-flex items-center gap-1 underline" target="_blank" rel="noopener" href={`https://maps.google.com/?q=${inc.lat},${inc.lng}`}><MapPin className="size-3.5" />Ver en mapa</a> : null],
                ]} />
              </Section>
              <Section title="Seguimiento">
                <ol className="mb-4 space-y-2">
                  {history.map((h) => (
                    <li key={h.id} className="text-sm"><StatusBadge map={STATUS} value={h.to_status} /> <span className="text-xs text-muted">{fmtDateTime(h.changed_at)} · {h.employees?.full_name}</span>
                      {h.notes && <p className="mt-0.5 text-[13px] text-ink-2">{h.notes}</p>}</li>
                  ))}
                </ol>
                {can('accidents.edit') && (inc.status !== 'closed' || can('accidents.manage')) && (
                  <div className="space-y-2 border-t border-line pt-3">
                    <Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Cambiar estado…" options={Object.entries(STATUS).filter(([k]) => k !== inc.status).map(([value, s]) => ({ value, label: s.label }))} />
                    <Textarea rows={2} placeholder="Notas / resolución" value={notes} onChange={(e) => setNotes(e.target.value)} />
                    <Button variant="primary" disabled={!status} loading={change.isPending} onClick={() => change.mutate()}>Actualizar</Button>
                  </div>
                )}
              </Section>
            </div>
          </div>
        </div>
      )}
    </QueryView>
  );
}

export function QuickReportButton() {
  return (
    <Link to="/m/incidente" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-bad px-2.5 text-[13px] font-semibold text-white hover:brightness-95" title="Reportar accidente">
      <AlertTriangle className="size-4" /><span className="hidden sm:inline">Accidente</span>
    </Link>
  );
}

export function OpenIncidentsKpi() {
  const q = useData(['dashboard', 'incidents'], () => run(supabase.from('incidents').select('id', { count: 'exact', head: false }).in('status', ['reported', 'in_review', 'investigating'])) as Promise<any[]>);
  return <StatCard label="Accidentes abiertos" value={q.data?.length ?? '—'} tone={q.data?.length ? 'bad' : undefined} icon={ShieldAlert} to="/incidentes" />;
}
