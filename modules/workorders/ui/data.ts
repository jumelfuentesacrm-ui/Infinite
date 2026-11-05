import { supabase } from '@core/data/supabase';
import { run, useData } from '@core/data/api';
import type { StatusMap } from '@core/ui/primitives';

export const MODULE = 'workorders';
export const WO_STATUS: StatusMap = {
  new: { label: 'Nueva', tone: 'brand' }, pending_diagnosis: { label: 'Pendiente de diagnóstico', tone: 'warn' },
  diagnosed: { label: 'Diagnosticada', tone: 'info' }, waiting_parts: { label: 'Esperando piezas', tone: 'warn' },
  in_repair: { label: 'En reparación', tone: 'info' }, pending_test: { label: 'Pendiente de prueba', tone: 'info' },
  completed: { label: 'Completada', tone: 'ok' }, closed: { label: 'Cerrada', tone: 'idle' }, cancelled: { label: 'Cancelada', tone: 'idle' },
};
export const PRIORITY: StatusMap = { low: { label: 'Baja', tone: 'idle' }, normal: { label: 'Normal', tone: 'info' }, high: { label: 'Alta', tone: 'warn' }, critical: { label: 'Crítica', tone: 'bad' } };
export const PART_STATUS: StatusMap = {
  needed: { label: 'Necesaria', tone: 'warn' }, reserved: { label: 'Reservada', tone: 'info' }, consumed: { label: 'Utilizada', tone: 'ok' },
  to_purchase: { label: 'Por comprar', tone: 'bad' }, cancelled: { label: 'Cancelada', tone: 'idle' },
};
export const OPEN = ['new', 'pending_diagnosis', 'diagnosed', 'waiting_parts', 'in_repair', 'pending_test'];
export const keys = { all: ['work_orders'] as const };

export interface WorkOrder {
  id: string; order_number: string; vehicle_id: string; reported_problem: string; description: string | null; diagnosis: string | null;
  priority: string; status: string; assigned_mechanic_id: string | null; opened_by: string | null; source_type: string | null; source_id: string | null; due_at: string | null;
  observations: string | null; labor_hours_total: number; labor_cost_total: number; parts_cost_total: number; created_at: string;
  diagnosed_at: string | null; started_at: string | null; completed_at: string | null; closed_at: string | null; engine_hours_in: number | null; engine_hours_out: number | null;
  vehicles: { unit_number: string; model_id: string }; mechanic: { full_name: string } | null; opener: { full_name: string } | null;
}
export const WO_SELECT = '*, vehicles(unit_number, model_id), mechanic:employees!work_orders_assigned_mechanic_id_fkey(full_name), opener:employees!work_orders_opened_by_fkey(full_name)';

export function useWorkOrders(f: { vehicleId?: string; scope?: 'open' | 'closed' | 'all'; mechanicId?: string } = {}) {
  return useData([...keys.all, f], () => {
    let q = supabase.from('work_orders').select(WO_SELECT).order('created_at', { ascending: false }).limit(500);
    if (f.vehicleId) q = q.eq('vehicle_id', f.vehicleId);
    if (f.mechanicId) q = q.eq('assigned_mechanic_id', f.mechanicId);
    if (f.scope === 'open') q = q.in('status', OPEN);
    if (f.scope === 'closed') q = q.not('status', 'in', `(${OPEN.join(',')})`);
    return run(q) as Promise<WorkOrder[]>;
  });
}
