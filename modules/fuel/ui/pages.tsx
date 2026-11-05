import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Fuel, Plus, Receipt } from 'lucide-react';
import { z } from 'zod';
import { supabase } from '@core/data/supabase';
import { run, useAction, useData } from '@core/data/api';
import { attachFile } from '@core/data/storage';
import { fleetKeys, useAttachments, useMyVehicle, useVehicle } from '@core/data/shared';
import { Can, useAuth } from '@core/auth/AuthProvider';
import { fmtDateTime, fmtMoney, fmtNum, toLocalInput } from '@core/lib/format';
import { Button, Card, EmptyState, LinkButton, PageHeader, StatCard, UnitTag } from '@core/ui/primitives';
import { Field, FormGrid, Input, Select, Textarea, useForm } from '@core/ui/form';
import { VehicleSelect } from '@core/ui/pickers';
import { AttachmentGrid, FilePicker } from '@core/ui/media';
import { DataTable } from '@core/ui/DataTable';
import { Modal } from '@core/ui/Modal';

const MODULE = 'fuel';
const keys = { all: ['fuel'] as const };
const TYPES = [{ value: 'regular', label: 'Regular' }, { value: 'premium', label: 'Premium' }, { value: 'diesel', label: 'Diésel' }, { value: 'mixed', label: 'Mezcla 2T' }, { value: 'other', label: 'Otro' }];

const schema = z.object({
  vehicle_id: z.string({ required_error: 'Seleccione el vehículo' }).uuid('Seleccione el vehículo'),
  purchased_at: z.string(),
  quantity: z.coerce.number({ invalid_type_error: 'Requerido' }).positive('Mayor que 0'),
  unit: z.enum(['gal', 'l']),
  amount: z.coerce.number({ invalid_type_error: 'Requerido' }).min(0),
  fuel_type: z.string().nullable(),
  station: z.string().nullable(),
  engine_hours: z.coerce.number().min(0).nullable(),
  mileage: z.coerce.number().min(0).nullable(),
  notes: z.string().nullable(),
});

export function FuelForm() {
  const nav = useNavigate();
  const { can } = useAuth();
  const mine = useMyVehicle();
  const f = useForm({ vehicle_id: '', purchased_at: toLocalInput(), quantity: '', unit: 'gal', amount: '', fuel_type: 'regular', station: '', engine_hours: '', mileage: '', notes: '' }, schema);
  useEffect(() => { if (mine.data && !f.values.vehicle_id) f.set('vehicle_id', mine.data.id); }, [mine.data]); // eslint-disable-line
  const veh = useVehicle(f.values.vehicle_id || undefined);
  const [receipt, setReceipt] = useState<File[]>([]);
  const save = useAction(async () => {
    const v = f.validate(); if (!v) throw new Error('Revise los campos marcados');
    const row = await run(supabase.from('fuel_logs').insert({ ...v, purchased_at: new Date(v.purchased_at).toISOString() }).select('id').single()) as { id: string };
    for (const file of receipt) await attachFile(MODULE, 'fuel_log', row.id, file, 'Recibo');
    return row;
  }, { invalidate: [keys.all, fleetKeys.vehicles], success: 'Compra de combustible registrada', onSuccess: () => nav(can('fuel.view') ? '/combustible' : '/m') });

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Registrar combustible" back={can('fuel.view') ? '/combustible' : '/m'} />
      <Card className="space-y-4">
        <Field label="Vehículo" required error={f.errors.vehicle_id}><VehicleSelect value={f.values.vehicle_id} onChange={(v) => f.set('vehicle_id', v)} /></Field>
        <FormGrid>
          <Field label="Cantidad" required error={f.errors.quantity}>
            <div className="flex gap-2"><Input type="number" step="0.001" inputMode="decimal" {...f.bind('quantity')} />
              <Select className="h-10 w-24" {...f.bind('unit')} options={[{ value: 'gal', label: 'gal' }, { value: 'l', label: 'litros' }]} /></div>
          </Field>
          <Field label="Total pagado" required error={f.errors.amount}><Input type="number" step="0.01" inputMode="decimal" {...f.bind('amount')} placeholder="$" /></Field>
          <Field label="Tipo"><Select {...f.bind('fuel_type')} options={TYPES} /></Field>
          <Field label="Fecha y hora"><Input type="datetime-local" max={toLocalInput()} {...f.bind('purchased_at')} /></Field>
          {veh.data?.vehicle_models?.uses_engine_hours && <Field label="Horas de motor" hint={`Última: ${fmtNum(veh.data.engine_hours)} h`} error={f.errors.engine_hours}><Input type="number" step="0.1" inputMode="decimal" {...f.bind('engine_hours')} /></Field>}
          {veh.data?.vehicle_models?.uses_mileage && <Field label="Millaje" error={f.errors.mileage}><Input type="number" step="0.1" inputMode="decimal" {...f.bind('mileage')} /></Field>}
          <Field label="Estación"><Input {...f.bind('station')} /></Field>
        </FormGrid>
        <Field label="Foto del recibo"><FilePicker files={receipt} onChange={setReceipt} max={2} label="Recibo" /></Field>
        <Field label="Comentarios"><Textarea rows={2} {...f.bind('notes')} /></Field>
        <Button variant="primary" size="lg" block icon={Fuel} loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button>
      </Card>
    </div>
  );
}

interface FuelLog { id: string; vehicle_id: string; purchased_at: string; quantity: number; unit: string; amount: number; fuel_type: string | null; station: string | null; engine_hours: number | null; notes: string | null; vehicles: { unit_number: string }; employees: { full_name: string } }
const useLogs = (f: { vehicleId?: string; employeeId?: string } = {}) => useData([...keys.all, f], () => {
  let q = supabase.from('fuel_logs').select('*, vehicles(unit_number), employees(full_name)').is('archived_at', null).order('purchased_at', { ascending: false }).limit(1000);
  if (f.vehicleId) q = q.eq('vehicle_id', f.vehicleId);
  if (f.employeeId) q = q.eq('employee_id', f.employeeId);
  return run(q) as Promise<FuelLog[]>;
});
const gal = (l: FuelLog) => (l.unit === 'l' ? l.quantity / 3.785411784 : l.quantity);

function LogTable({ rows, loading, error, withVehicle = true }: { rows?: FuelLog[]; loading: boolean; error: any; withVehicle?: boolean }) {
  const [open, setOpen] = useState<FuelLog | null>(null);
  return (
    <>
      <DataTable rows={rows} loading={loading} error={error} exportName="Combustible" onRowClick={setOpen} empty={<EmptyState icon={Fuel} title="Sin registros de combustible" />} columns={[
        { key: 'purchased_at', header: 'Fecha', mobile: 'title', render: (l) => <span className="num">{fmtDateTime(l.purchased_at)}</span> },
        ...(withVehicle ? [{ key: 'unit', header: 'Vehículo', value: (l: FuelLog) => l.vehicles.unit_number, render: (l: FuelLog) => <UnitTag>{l.vehicles.unit_number}</UnitTag> }] : []),
        { key: 'employee', header: 'Empleado', value: (l) => l.employees.full_name },
        { key: 'quantity', header: 'Cantidad', align: 'right', value: (l) => l.quantity, render: (l) => <span className="num">{fmtNum(l.quantity)} {l.unit}</span> },
        { key: 'amount', header: 'Total', align: 'right', value: (l) => l.amount, render: (l) => <span className="num">{fmtMoney(l.amount)}</span> },
        { key: 'ppu', header: '$/gal', align: 'right', mobile: 'hide', value: (l) => +(l.amount / gal(l)).toFixed(3), render: (l) => <span className="num text-muted">{fmtMoney(l.amount / gal(l))}</span> },
        { key: 'station', header: 'Estación', mobile: 'hide' },
      ]} />
      {open && <LogDetail log={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function LogDetail({ log, onClose }: { log: FuelLog; onClose: () => void }) {
  const files = useAttachments('fuel_log', [log.id]);
  const archive = useAction(() => run(supabase.from('fuel_logs').update({ archived_at: new Date().toISOString() }).eq('id', log.id)), { invalidate: [keys.all], success: 'Registro archivado', onSuccess: onClose });
  const { can } = useAuth();
  return (
    <Modal open onClose={onClose} title={`Combustible · ${log.vehicles.unit_number}`} size="sm"
      footer={<>{can('fuel.edit') && <Button variant="ghost" className="mr-auto text-bad" onClick={() => archive.mutate()}>Archivar</Button>}<Button onClick={onClose}>Cerrar</Button></>}>
      <div className="space-y-2 text-sm">
        <div>{fmtDateTime(log.purchased_at)} · {log.employees.full_name}</div>
        <div className="num text-lg">{fmtNum(log.quantity)} {log.unit} · {fmtMoney(log.amount)}</div>
        {log.engine_hours != null && <div className="text-muted">Horas: {fmtNum(log.engine_hours)}</div>}
        {log.notes && <p>{log.notes}</p>}
        <div className="flex items-center gap-1.5 pt-2 text-xs font-medium text-muted"><Receipt className="size-4" />Recibo</div>
        <AttachmentGrid items={files.data ?? []} />
      </div>
    </Modal>
  );
}

export function FuelPage() {
  const q = useLogs();
  const rows = q.data ?? [];
  const month = rows.filter((l) => new Date(l.purchased_at).getMonth() === new Date().getMonth() && new Date(l.purchased_at).getFullYear() === new Date().getFullYear());
  return (
    <>
      <PageHeader title="Combustible" actions={<Can perm="fuel.create"><LinkButton to="/combustible/nuevo" variant="primary" icon={Plus}>Registrar</LinkButton></Can>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Galones este mes" value={fmtNum(month.reduce((s, l) => s + gal(l), 0))} icon={Fuel} />
        <StatCard label="Gasto este mes" value={fmtMoney(month.reduce((s, l) => s + Number(l.amount), 0))} />
        <StatCard label="Compras este mes" value={month.length} />
        <StatCard label="Promedio $/gal" value={month.length ? fmtMoney(month.reduce((s, l) => s + Number(l.amount), 0) / month.reduce((s, l) => s + gal(l), 0)) : '—'} />
      </div>
      <LogTable rows={q.data} loading={q.isLoading} error={q.error} />
    </>
  );
}

export function VehicleFuelTab({ vehicleId }: { vehicleId: string }) {
  const q = useLogs({ vehicleId });
  return <LogTable rows={q.data} loading={q.isLoading} error={q.error} withVehicle={false} />;
}
export function EmployeeFuelTab({ employeeId }: { employeeId: string }) {
  const q = useLogs({ employeeId });
  return <LogTable rows={q.data} loading={q.isLoading} error={q.error} />;
}

/** Reporte: consumo y costo por vehículo y mes */
export function FuelReport() {
  const q = useData(['fuel', 'summary'], () => run(supabase.from('fuel_summary_by_vehicle').select('*').order('month', { ascending: false })) as Promise<any[]>);
  return <DataTable rows={q.data} loading={q.isLoading} error={q.error} exportName="Consumo-combustible" rowKey={(r) => r.vehicle_id + r.month} columns={[
    { key: 'month', header: 'Mes', mobile: 'title', render: (r) => <span className="num">{String(r.month).slice(0, 7)}</span> },
    { key: 'unit_number', header: 'Vehículo', render: (r) => <UnitTag>{r.unit_number}</UnitTag> },
    { key: 'fills', header: 'Compras', align: 'right' },
    { key: 'gallons', header: 'Galones', align: 'right', render: (r) => <span className="num">{fmtNum(r.gallons)}</span> },
    { key: 'total_amount', header: 'Costo', align: 'right', render: (r) => <span className="num">{fmtMoney(r.total_amount)}</span> },
  ]} />;
}
