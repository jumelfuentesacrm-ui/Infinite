import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Truck } from 'lucide-react';
import { useVehicles, VEHICLE_STATUS, modelLabel, fleetKeys, type Vehicle } from '@core/data/shared';
import { useLiveTable } from '@core/data/realtime';
import { Can } from '@core/auth/AuthProvider';
import { Button, EmptyState, PageHeader, StatusBadge, UnitTag, Segmented } from '@core/ui/primitives';
import { DataTable, type Column } from '@core/ui/DataTable';
import { fmtDate, fmtNum } from '@core/lib/format';
import { VehicleForm } from './VehicleForm';

const FILTERS = [
  { id: 'all', label: 'Todos' }, { id: 'available', label: 'Disponibles' },
  { id: 'shop', label: 'En taller' }, { id: 'out_of_service', label: 'Fuera de servicio' },
] as const;
type F = (typeof FILTERS)[number]['id'];
/** Mismos grupos que la gráfica del dashboard */
export const STATUS_GROUPS = {
  available: ['available', 'assigned', 'in_operation'],
  shop: ['maintenance', 'repair'],
  out_of_service: ['out_of_service'],
} as const;
const match = (f: F, s: string) => f === 'all' || (STATUS_GROUPS[f] as readonly string[]).includes(s);

export default function VehiclesPage() {
  const q = useVehicles();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get('estado') as F | null;
  const filter: F = fromUrl && FILTERS.some((x) => x.id === fromUrl) ? fromUrl : 'all';
  const setFilter = (f: F) => setParams(f === 'all' ? {} : { estado: f }, { replace: true });
  const [creating, setCreating] = useState(false);
  useLiveTable('vehicles', [fleetKeys.vehicles]);

  const columns: Column<Vehicle>[] = [
    { key: 'unit_number', header: 'Unidad', mobile: 'title', render: (v) => <UnitTag>{v.unit_number}</UnitTag> },
    { key: 'model', header: 'Modelo', value: (v) => modelLabel(v.vehicle_models) },
    { key: 'status', header: 'Estado', value: (v) => VEHICLE_STATUS[v.status]?.label, render: (v) => <StatusBadge map={VEHICLE_STATUS} value={v.status} /> },
    { key: 'engine_hours', header: 'Horas', align: 'right', render: (v) => <span className="num">{fmtNum(v.engine_hours)} h</span> },
    { key: 'mileage', header: 'Millaje', align: 'right', mobile: 'hide', render: (v) => <span className="num">{v.mileage != null ? fmtNum(v.mileage) : '—'}</span> },
    { key: 'last_inspection_at', header: 'Últ. inspección', mobile: 'hide', value: (v) => v.last_inspection_at, render: (v) => fmtDate(v.last_inspection_at) },
    { key: 'next_maintenance_hours', header: 'Próx. mant.', mobile: 'hide', value: (v) => v.next_maintenance_hours,
      render: (v) => v.next_maintenance_hours != null || v.next_maintenance_at
        ? <span className="num text-[13px]">{[v.next_maintenance_hours != null && `${fmtNum(v.next_maintenance_hours)} h`, v.next_maintenance_at && fmtDate(v.next_maintenance_at)].filter(Boolean).join(' · ')}</span> : '—' },
    { key: 'current_location', header: 'Ubicación', mobile: 'hide' },
  ];

  return (
    <>
      <PageHeader title="Vehículos" subtitle={q.data ? `${q.data.length} unidades activas` : undefined}
        actions={<Can perm="fleet.create"><Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Añadir vehículo</Button></Can>} />
      <DataTable rows={q.data?.filter((v) => match(filter, v.status))} loading={q.isLoading} error={q.error} columns={columns}
        onRowClick={(v) => nav(`/flota/${v.id}`)} exportName="Vehiculos"
        toolbar={<div className="scroll-x"><Segmented value={filter} onChange={setFilter} options={[...FILTERS]} /></div>}
        empty={<EmptyState icon={Truck} title="Sin vehículos" action={<Can perm="fleet.create"><Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Añadir el primero</Button></Can>} />} />
      {creating && <VehicleForm open onClose={() => setCreating(false)} />}
    </>
  );
}
