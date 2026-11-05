import { supabase } from '@core/data/supabase';
import { run, useData } from '@core/data/api';
import type { StatusMap } from '@core/ui/primitives';

export const DUE: StatusMap = { overdue: { label: 'Vencido', tone: 'bad' }, due_soon: { label: 'Próximo', tone: 'warn' }, ok: { label: 'Al día', tone: 'ok' } };
export const REC_STATUS: StatusMap = {
  pending_approval: { label: 'Pendiente de aprobación', tone: 'warn' }, scheduled: { label: 'Programado', tone: 'info' },
  in_progress: { label: 'En proceso', tone: 'brand' }, completed: { label: 'Completado', tone: 'ok' }, cancelled: { label: 'Cancelado', tone: 'idle' },
};
export const keys = { all: ['maintenance'] as const };

export interface DueRow {
  vehicle_id: string; unit_number: string; current_hours: number; current_miles: number | null; interval_id: string; maintenance_type_id: string;
  type_name: string; interval_hours: number | null; interval_days: number | null; interval_miles: number | null; last_done_at: string | null;
  due_hours: number | null; due_date: string | null; due_miles: number | null; due_status: string; open_record_id: string | null; open_record_status: string | null;
}
export interface MType { id: string; name: string; description: string | null; archived_at: string | null }
export interface Rec {
  id: string; vehicle_id: string; maintenance_type_id: string; status: string; scheduled_for: string | null; performed_at: string | null;
  engine_hours: number | null; mileage: number | null; labor_hours: number | null; cost_labor: number | null; cost_parts: number | null;
  next_due_date: string | null; next_due_hours: number | null; notes: string | null; responsible_id: string | null; created_at: string;
  vehicles: { unit_number: string }; maintenance_types: { name: string };
  responsible: { full_name: string } | null; performer: { full_name: string } | null;
}

export const useDue = (vehicleId?: string | null) => useData([...keys.all, 'due', vehicleId], () => {
  let q = supabase.from('maintenance_due').select('*').order('unit_number');
  if (vehicleId) q = q.eq('vehicle_id', vehicleId);
  return run(q) as Promise<DueRow[]>;
});

export const useTypes = () => useData([...keys.all, 'types'], () => run(supabase.from('maintenance_types').select('*').is('archived_at', null).order('name')) as Promise<MType[]>);

export const REC_SELECT = '*, vehicles(unit_number), maintenance_types(name), responsible:employees!maintenance_records_responsible_id_fkey(full_name), performer:employees!maintenance_records_performed_by_fkey(full_name)';
export const useRecords = (f: { vehicleId?: string | null; open?: boolean } = {}) => useData([...keys.all, 'records', f], () => {
  let q = supabase.from('maintenance_records').select(REC_SELECT).order('created_at', { ascending: false }).limit(500);
  if (f.vehicleId) q = q.eq('vehicle_id', f.vehicleId);
  q = f.open ? q.in('status', ['pending_approval', 'scheduled', 'in_progress']) : q.in('status', ['completed', 'cancelled']);
  return run(q) as Promise<Rec[]>;
});
