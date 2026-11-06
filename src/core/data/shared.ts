/**
 * Servicios de datos del NÚCLEO que cualquier módulo puede usar
 * (vehículos, modelos, empleados, adjuntos, línea de tiempo).
 */
import { supabase } from './supabase';
import { run, useData } from './api';
import type { StatusMap } from '@core/ui/primitives';

export interface VehicleModel {
  id: string; manufacturer: string; model: string; year: number | null; vehicle_type: string;
  uses_engine_hours: boolean; uses_mileage: boolean; notes: string | null; archived_at: string | null;
}
export interface Vehicle {
  id: string; unit_number: string; model_id: string; vin: string | null; plate: string | null; acquired_at: string | null;
  photo_path: string | null; status: string; status_reason: string | null; current_location: string | null;
  engine_hours: number; mileage: number | null; warranty_expires_at: string | null; warranty_notes: string | null;
  last_inspection_at: string | null; last_maintenance_at: string | null; next_maintenance_at: string | null;
  next_maintenance_hours: number | null; notes: string | null; archived_at: string | null; created_at: string;
  vehicle_models?: VehicleModel;
}
export interface Employee {
  id: string; employee_code: string; full_name: string; phone: string | null; job_title: string | null; role_id: string;
  status: string; hired_at: string | null; notes: string | null; last_login_at: string | null; photo_path: string | null; created_at: string;
}

export const VEHICLE_STATUS: StatusMap = {
  available: { label: 'Disponible', tone: 'ok' },
  in_operation: { label: 'En operación', tone: 'info' },
  assigned: { label: 'Asignado', tone: 'brand' },
  maintenance: { label: 'En mantenimiento', tone: 'warn' },
  repair: { label: 'En reparación', tone: 'warn' },
  out_of_service: { label: 'Fuera de servicio', tone: 'bad' },
  retired: { label: 'Retirado', tone: 'idle' },
};
export const VEHICLE_TYPES: Record<string, string> = {
  utv: 'UTV', atv: 'ATV', truck: 'Camión', car: 'Auto', van: 'Van', equipment: 'Equipo', other: 'Otro',
};
export const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin', supervisor: 'Supervisor', mechanic: 'Mecánico', driver: 'ATV/UTV',
};

export const modelLabel = (m?: Pick<VehicleModel, 'manufacturer' | 'model' | 'year'> | null) =>
  m ? `${m.manufacturer} ${m.model}${m.year ? ' ' + m.year : ''}` : '—';

// ---------------------------------------------------------------- Hooks
export const fleetKeys = {
  vehicles: ['vehicles'] as const,
  vehicle: (id: string) => ['vehicles', id] as const,
  models: ['vehicle_models'] as const,
  employees: ['employees'] as const,
  myVehicle: ['my_vehicle'] as const,
};

export function useVehicles(opts: { includeArchived?: boolean } = {}) {
  return useData([...fleetKeys.vehicles, opts], () => {
    let q = supabase.from('vehicles').select('*, vehicle_models(*)').order('unit_number');
    if (!opts.includeArchived) q = q.is('archived_at', null);
    return run(q) as Promise<Vehicle[]>;
  });
}

export function useVehicle(id: string | undefined) {
  return useData(fleetKeys.vehicle(id ?? ''), () =>
    run(supabase.from('vehicles').select('*, vehicle_models(*)').eq('id', id!).single()) as Promise<Vehicle>,
  { enabled: !!id });
}

export function useModels() {
  return useData(fleetKeys.models, () =>
    run(supabase.from('vehicle_models').select('*').is('archived_at', null).order('manufacturer').order('model').order('year')) as Promise<VehicleModel[]>,
  { staleTime: 5 * 60_000 });
}

export function useEmployees(opts: { roles?: string[]; activeOnly?: boolean } = { activeOnly: true }) {
  return useData([...fleetKeys.employees, opts], () => {
    let q = supabase.from('employees').select('*').order('full_name');
    if (opts.activeOnly !== false) q = q.eq('status', 'active');
    if (opts.roles?.length) q = q.in('role_id', opts.roles);
    return run(q) as Promise<Employee[]>;
  }, { staleTime: 60_000 });
}

export function useMyVehicle() {
  return useData(fleetKeys.myVehicle, async () => {
    const rows = await run(supabase.rpc('my_vehicle').select('*, vehicle_models(*)')) as Vehicle[];
    return rows[0] ?? null;
  });
}

export interface TimelineEvent {
  id: number; vehicle_id: string; occurred_at: string; module_id: string; event_type: string; title: string;
  details: Record<string, any>; entity_type: string | null; entity_id: string | null; employee_id: string | null;
  cost: number | null; labor_hours: number | null; employees?: { full_name: string } | null;
}
export function useVehicleTimeline(vehicleId: string, modules?: string[]) {
  return useData(['vehicle_timeline', vehicleId, modules], () => {
    let q = supabase.from('vehicle_timeline').select('*, employees(full_name)').eq('vehicle_id', vehicleId)
      .order('occurred_at', { ascending: false }).limit(300);
    if (modules?.length) q = q.in('module_id', modules);
    return run(q) as Promise<TimelineEvent[]>;
  });
}

export interface Attachment {
  id: string; module_id: string; entity_type: string; entity_id: string; storage_path: string; file_name: string;
  mime_type: string | null; size_bytes: number | null; caption: string | null; created_at: string;
}
export function useAttachments(entityType: string, entityIds: string[]) {
  return useData(['attachments', entityType, entityIds], () =>
    run(supabase.from('attachments').select('*').eq('entity_type', entityType).in('entity_id', entityIds)
      .is('archived_at', null).order('created_at')) as Promise<Attachment[]>,
  { enabled: entityIds.length > 0 });
}

// ---------------------------------------------------------------- Roles y largo del PIN
export interface RoleRow { id: string; name: string; pin_length: number }
export const useRoles = () => useData(['roles'], () =>
  run(supabase.from('roles').select('id, name, pin_length').order('pin_length', { ascending: false })) as Promise<RoleRow[]>);
/** Dígitos que lleva el PIN de un rol (4 empleados · 5 supervisores · 6 administradores, configurable) */
export function usePinLength(role?: string | null) {
  const q = useRoles();
  return q.data?.find((r) => r.id === role)?.pin_length ?? (role === 'admin' ? 6 : role === 'supervisor' ? 5 : 4);
}

/** Categorías de piezas: las mismas en inventario y catálogo, para que todo quede agrupado igual. */
export const PART_CATEGORIES = [
  'Filtros', 'Lubricantes y fluidos', 'Frenos', 'Transmisión CVT', 'Ejes y diferenciales', 'Suspensión', 'Dirección',
  'Rodamientos y sellos', 'Motor', 'Juntas y empaques', 'Enfriamiento', 'Encendido y bujías', 'Eléctrico', 'Iluminación',
  'Gomas y aros', 'Carrocería y accesorios', 'Tornillería y abrazaderas', 'Herramientas y consumibles', 'Otros',
] as const;
export const partCategoryOptions = (current?: string | null) =>
  [...PART_CATEGORIES, ...(current && !(PART_CATEGORIES as readonly string[]).includes(current) ? [current] : [])].map((c) => ({ value: c, label: c }));
