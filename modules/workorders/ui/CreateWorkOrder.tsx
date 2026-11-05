import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardPlus, Wrench } from 'lucide-react';
import { rpc, useAction } from '@core/data/api';
import { attachFile } from '@core/data/storage';
import { fleetKeys, useMyVehicle } from '@core/data/shared';
import { useAuth } from '@core/auth/AuthProvider';
import type { VehicleRef } from '@core/modules/slots';
import { Button, Card, PageHeader } from '@core/ui/primitives';
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from '@core/ui/form';
import { EmployeeSelect, VehicleSelect } from '@core/ui/pickers';
import { FilePicker } from '@core/ui/media';
import { Modal } from '@core/ui/Modal';
import { keys, MODULE, PRIORITY } from './data';

export interface WoDraft { vehicle_id?: string | null; reported_problem?: string; source_type?: string; source_id?: string; priority?: string }

export function CreateWorkOrderModal({ draft, onClose }: { draft: WoDraft; onClose: () => void }) {
  const nav = useNavigate();
  const [v, setV] = useState({ vehicle_id: draft.vehicle_id ?? '', reported_problem: draft.reported_problem ?? '', description: '', priority: draft.priority ?? 'normal',
    assigned_mechanic_id: '', take_out_of_service: false, due_at: '' });
  const [photos, setPhotos] = useState<File[]>([]);
  const save = useAction(async () => {
    if (!v.vehicle_id) throw new Error('Seleccione el vehículo');
    if (v.reported_problem.trim().length < 3) throw new Error('Describa el problema reportado');
    const r = await rpc<{ id: string; order_number: string }>('create_work_order', { p: { ...v, description: v.description || null, assigned_mechanic_id: v.assigned_mechanic_id || null,
      due_at: v.due_at ? new Date(v.due_at).toISOString() : null, source_type: draft.source_type ?? 'manual', source_id: draft.source_id ?? null } });
    for (const f of photos) await attachFile(MODULE, 'work_order', r.id, f);
    return r;
  }, { invalidate: [keys.all, fleetKeys.vehicles], success: (r) => `Orden ${r.order_number} creada`, onSuccess: (r) => { onClose(); nav(`/taller/${r.id}`); } });
  return (
    <Modal open onClose={onClose} title="Nueva orden de trabajo" size="lg"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Crear orden</Button></>}>
      <div className="space-y-4">
        <FormGrid>
          <Field label="Vehículo" required><VehicleSelect value={v.vehicle_id} onChange={(id) => setV({ ...v, vehicle_id: id })} /></Field>
          <Field label="Prioridad"><Select value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })} options={Object.entries(PRIORITY).map(([value, p]) => ({ value, label: p.label }))} /></Field>
        </FormGrid>
        <Field label="Problema reportado" required><Textarea rows={2} value={v.reported_problem} onChange={(e) => setV({ ...v, reported_problem: e.target.value })} /></Field>
        <Field label="Descripción del problema"><Textarea value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
        <FormGrid>
          <Field label="Mecánico asignado"><EmployeeSelect value={v.assigned_mechanic_id} onChange={(id) => setV({ ...v, assigned_mechanic_id: id })} roles={['mechanic']} placeholder="Sin asignar (visible a todos los mecánicos)" /></Field>
          <Field label="Fecha límite" hint="Vacío: según prioridad"><Input type="datetime-local" value={v.due_at} onChange={(e) => setV({ ...v, due_at: e.target.value })} /></Field>
        </FormGrid>
        <Checkbox label="Sacar el vehículo de servicio ahora (estado: en reparación)" checked={v.take_out_of_service || v.priority === 'critical'} disabled={v.priority === 'critical'} onChange={(e) => setV({ ...v, take_out_of_service: e.target.checked })} />
        <Field label="Fotografías"><FilePicker files={photos} onChange={setPhotos} /></Field>
      </div>
    </Modal>
  );
}

/** Teléfono: el chofer reporta un problema mecánico (crea una orden "reporte de chofer") */
export function ReportProblem() {
  const nav = useNavigate();
  const mine = useMyVehicle();
  const { can } = useAuth();
  const [vehicle, setVehicle] = useState('');
  const [problem, setProblem] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [photos, setPhotos] = useState<File[]>([]);
  useEffect(() => { if (mine.data && !vehicle) setVehicle(mine.data.id); }, [mine.data, vehicle]);
  const save = useAction(async () => {
    if (!vehicle) throw new Error('Seleccione el vehículo');
    if (problem.trim().length < 5) throw new Error('Describa el problema');
    const r = await rpc<{ id: string; order_number: string }>('create_work_order', { p: { vehicle_id: vehicle, reported_problem: problem, priority: urgent ? 'high' : 'normal', source_type: 'driver_report' } });
    for (const f of photos) await attachFile(MODULE, 'work_order', r.id, f);
    return r;
  }, { invalidate: [keys.all], success: (r) => `Problema reportado (${r.order_number}). El taller fue notificado.`, onSuccess: () => nav(can('workorders.view') ? '/taller' : '/m') });
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Reportar problema mecánico" back="/m" />
      <Card className="space-y-4">
        <Field label="Vehículo"><VehicleSelect value={vehicle} onChange={setVehicle} /></Field>
        <Field label="¿Qué problema tiene?" required><Textarea rows={4} value={problem} onChange={(e) => setProblem(e.target.value)} placeholder="Ruido al frenar, pierde aceite, no enciende…" /></Field>
        <Checkbox label="Es urgente / afecta la seguridad" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
        <Field label="Fotos"><FilePicker files={photos} onChange={setPhotos} /></Field>
        <Button variant="primary" size="lg" block icon={Wrench} loading={save.isPending} onClick={() => save.mutate()}>Enviar al taller</Button>
      </Card>
    </div>
  );
}

// ---- Aportaciones a otros módulos (vía slots) ----
function CreateFrom({ draft, label = 'Crear orden de trabajo' }: { draft: WoDraft; label?: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button icon={ClipboardPlus} onClick={() => setOpen(true)}>{label}</Button>
    {open && <CreateWorkOrderModal draft={draft} onClose={() => setOpen(false)} />}
  </>;
}
export const FromInspection = (p: { inspectionId: string; vehicleId: string; summary: string }) =>
  <CreateFrom draft={{ vehicle_id: p.vehicleId, reported_problem: p.summary, source_type: 'inspection', source_id: p.inspectionId, priority: 'high' }} />;
export const FromIncident = (p: { incidentId: string; vehicleId: string | null; summary: string }) =>
  p.vehicleId ? <CreateFrom draft={{ vehicle_id: p.vehicleId, reported_problem: p.summary, source_type: 'incident', source_id: p.incidentId, priority: 'high' }} /> : null;
export const FromVehicle = ({ vehicle }: { vehicle: VehicleRef }) => <CreateFrom draft={{ vehicle_id: vehicle.id }} label="Orden de trabajo" />;
