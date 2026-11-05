import { Suspense, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Archive, Gauge, Pencil, UserPlus, UserMinus, RefreshCw } from 'lucide-react';
import { supabase } from '@core/data/supabase';
import { rpc, run, useAction, useData } from '@core/data/api';
import { useLiveTable } from '@core/data/realtime';
import { fleetKeys, modelLabel, useVehicle, useVehicleTimeline, VEHICLE_STATUS, VEHICLE_TYPES } from '@core/data/shared';
import { Can, useAuth } from '@core/auth/AuthProvider';
import { savedMsg, useSaveOrRequest } from '@core/data/changes';
import { Slot, useSlotItems } from '@core/modules/Slot';
import { Button, Card, KeyValue, PageHeader, QueryView, Section, Spinner, StatusBadge, Tabs, UnitTag } from '@core/ui/primitives';
import { Field, FormGrid, Input, Select, Textarea } from '@core/ui/form';
import { Modal, useConfirm } from '@core/ui/Modal';
import { EmployeeSelect } from '@core/ui/pickers';
import { StorageImage } from '@core/ui/media';
import { Timeline } from '@core/ui/Timeline';
import { fmtDate, fmtDateTime, fmtNum } from '@core/lib/format';
import { VehicleForm } from './VehicleForm';

export default function VehicleDetail() {
  const { id = '' } = useParams();
  const q = useVehicle(id);
  const moduleTabs = useSlotItems('vehicle.tabs');
  const [tab, setTab] = useState('summary');
  const [editing, setEditing] = useState(false);
  useLiveTable('vehicles', [fleetKeys.vehicle(id)], `id=eq.${id}`);

  return (
    <QueryView q={q}>
      {(v) => (
        <>
          <PageHeader back="/flota" eyebrow={modelLabel(v.vehicle_models)}
            title={<span className="flex flex-wrap items-center gap-3"><span className="font-mono">{v.unit_number}</span><StatusBadge map={VEHICLE_STATUS} value={v.status} /></span>}
            subtitle={v.status_reason}
            actions={<>
              <Slot name="vehicle.actions" props={{ vehicle: v }} />
              <Can perm="fleet.edit"><Button icon={Pencil} onClick={() => setEditing(true)}>Editar</Button></Can>
            </>} />
          <Tabs value={tab} onChange={setTab} tabs={[
            { id: 'summary', label: 'Expediente' }, { id: 'history', label: 'Historial' },
            ...moduleTabs.map((t) => ({ id: t.id, label: t.label ?? t.id })),
          ]} />
          {tab === 'summary' && <Summary vehicleId={v.id} />}
          {tab === 'history' && <History vehicleId={v.id} />}
          {moduleTabs.filter((t) => t.id === tab).map((t) => {
            const C = t.component as React.ComponentType<{ vehicleId: string }>;
            return <Suspense key={t.id} fallback={<Spinner />}><C vehicleId={v.id} /></Suspense>;
          })}
          {editing && <VehicleForm open vehicle={v} onClose={() => setEditing(false)} />}
        </>
      )}
    </QueryView>
  );
}

function Summary({ vehicleId }: { vehicleId: string }) {
  const { data: v } = useVehicle(vehicleId);
  const { can } = useAuth();
  const confirm = useConfirm();
  const [modal, setModal] = useState<null | 'status' | 'meter' | 'assign'>(null);
  const assignment = useData(['vehicle_assignment', vehicleId], () =>
    run(supabase.from('vehicle_assignments').select('*, employees(full_name, employee_code)').eq('vehicle_id', vehicleId).is('ended_at', null)));
  const endAssign = useAction((id: string) => rpc('end_vehicle_assignment', { p_assignment: id }),
    { invalidate: [['vehicle_assignment', vehicleId], fleetKeys.vehicles], success: 'Asignación finalizada' });
  const { save: saveOrRequest } = useSaveOrRequest();
  const archive = useAction(() => saveOrRequest('vehicles', vehicleId, { archived_at: new Date().toISOString(), status: 'retired' }),
    { invalidate: [fleetKeys.vehicles], success: savedMsg('Vehículo retirado y archivado') });
  if (!v) return null;
  const m = v.vehicle_models!;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Section title="Datos del vehículo">
          <div className="flex flex-col gap-4 sm:flex-row">
            <StorageImage path={v.photo_path} alt={v.unit_number} className="aspect-[4/3] w-full shrink-0 rounded-md sm:w-48" />
            <KeyValue items={[
              ['Número interno', <UnitTag>{v.unit_number}</UnitTag>], ['Marca / modelo', modelLabel(m)],
              ['Tipo', VEHICLE_TYPES[m.vehicle_type]], ['VIN / serie', <span className="num">{v.vin ?? '—'}</span>],
              ['Tablilla', v.plate], ['Adquirido', fmtDate(v.acquired_at)],
              ['Ubicación', v.current_location], ['Garantía', v.warranty_expires_at ? `Vence ${fmtDate(v.warranty_expires_at)}` : null],
            ]} />
          </div>
          {v.notes && <p className="mt-4 border-t border-line pt-3 text-sm text-ink-2">{v.notes}</p>}
        </Section>
        <Section title="Uso y mantenimiento" actions={<Can perm="fleet.edit"><Button size="sm" icon={Gauge} onClick={() => setModal('meter')}>Registrar lectura</Button></Can>}>
          <KeyValue cols={3} items={[
            ['Horas de motor', <span className="num text-lg">{fmtNum(v.engine_hours)} h</span>],
            ['Millaje', m.uses_mileage ? <span className="num text-lg">{fmtNum(v.mileage)}</span> : 'No aplica'],
            ['Última inspección', fmtDateTime(v.last_inspection_at)],
            ['Último mantenimiento', fmtDate(v.last_maintenance_at)],
            ['Próximo (horas)', v.next_maintenance_hours != null ? <span className="num">{fmtNum(v.next_maintenance_hours)} h</span> : null],
            ['Próximo (fecha)', v.next_maintenance_at ? fmtDate(v.next_maintenance_at) : null],
          ]} />
        </Section>
      </div>
      <div className="space-y-4">
        <Section title="Estado" actions={<Can perm="fleet.edit"><Button size="sm" icon={RefreshCw} onClick={() => setModal('status')}>Cambiar</Button></Can>}>
          <StatusBadge map={VEHICLE_STATUS} value={v.status} />
          {v.status_reason && <p className="mt-2 text-sm text-muted">{v.status_reason}</p>}
        </Section>
        <Section title="Asignado a" actions={<Can perm="fleet.assign"><Button size="sm" icon={UserPlus} onClick={() => setModal('assign')}>Asignar</Button></Can>}>
          {assignment.data?.length ? assignment.data.map((a: any) => (
            <div key={a.id} className="flex items-center justify-between gap-2 py-1">
              <div><div className="text-sm font-medium">{a.employees?.full_name}</div><div className="text-xs text-muted">Desde {fmtDate(a.started_at)}</div></div>
              {can('fleet.assign') && <Button size="sm" variant="ghost" icon={UserMinus} onClick={() => endAssign.mutate(a.id)}>Quitar</Button>}
            </div>
          )) : <p className="text-sm text-muted">Sin operador asignado</p>}
        </Section>
        {can('fleet.delete') && v.status !== 'retired' && (
          <Button variant="ghost" icon={Archive} className="text-bad" onClick={async () => {
            if (await confirm({ title: 'Retirar vehículo', body: 'Se marcará como retirado y se archivará. Su historial completo se conserva.', confirm: 'Retirar', danger: true })) archive.mutate();
          }}>Retirar vehículo</Button>
        )}
      </div>
      {modal === 'status' && <StatusModal vehicleId={v.id} current={v.status} onClose={() => setModal(null)} />}
      {modal === 'meter' && <MeterModal vehicleId={v.id} hours={v.engine_hours} miles={v.mileage} usesMiles={m.uses_mileage} onClose={() => setModal(null)} />}
      {modal === 'assign' && <AssignModal vehicleId={v.id} onClose={() => setModal(null)} />}
    </div>
  );
}

function History({ vehicleId }: { vehicleId: string }) {
  const q = useVehicleTimeline(vehicleId);
  return <Card><QueryView q={q}>{(events) => <Timeline events={events} />}</QueryView></Card>;
}

function StatusModal({ vehicleId, current, onClose }: { vehicleId: string; current: string; onClose: () => void }) {
  const [status, setStatus] = useState(current);
  const [reason, setReason] = useState('');
  const save = useAction(() => rpc('set_vehicle_status', { p_vehicle: vehicleId, p_status: status, p_reason: reason || null }),
    { invalidate: [fleetKeys.vehicles], success: 'Estado actualizado', onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title="Cambiar estado" size="sm"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button></>}>
      <div className="space-y-3">
        <Field label="Estado"><Select value={status} onChange={(e) => setStatus(e.target.value)}
          options={Object.entries(VEHICLE_STATUS).map(([value, s]) => ({ value, label: s.label }))} /></Field>
        <Field label="Motivo"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function MeterModal({ vehicleId, hours, miles, usesMiles, onClose }: { vehicleId: string; hours: number; miles: number | null; usesMiles: boolean; onClose: () => void }) {
  const [h, setH] = useState(String(hours));
  const [mi, setMi] = useState(miles?.toString() ?? '');
  const save = useAction(() => rpc('record_meter_reading', { p_vehicle: vehicleId, p_hours: h === '' ? null : Number(h), p_miles: mi === '' ? null : Number(mi) }),
    { invalidate: [fleetKeys.vehicles], success: 'Lectura registrada', onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title="Registrar lectura" size="sm"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button></>}>
      <FormGrid>
        <Field label="Horas de motor" hint={`Actual: ${fmtNum(hours)} h`}><Input type="number" step="0.1" inputMode="decimal" value={h} onChange={(e) => setH(e.target.value)} /></Field>
        {usesMiles && <Field label="Millaje" hint={`Actual: ${fmtNum(miles)}`}><Input type="number" step="0.1" inputMode="decimal" value={mi} onChange={(e) => setMi(e.target.value)} /></Field>}
      </FormGrid>
    </Modal>
  );
}

function AssignModal({ vehicleId, onClose }: { vehicleId: string; onClose: () => void }) {
  const [emp, setEmp] = useState('');
  const save = useAction(() => rpc('assign_vehicle', { p_vehicle: vehicleId, p_employee: emp }),
    { invalidate: [['vehicle_assignment', vehicleId], fleetKeys.vehicles], success: 'Vehículo asignado', onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title="Asignar vehículo" size="sm"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!emp} loading={save.isPending} onClick={() => save.mutate()}>Asignar</Button></>}>
      <Field label="Empleado" hint="Si ya tenía otro vehículo asignado, esa asignación se cierra."><EmployeeSelect value={emp} onChange={setEmp} roles={['driver', 'supervisor', 'mechanic']} /></Field>
    </Modal>
  );
}
