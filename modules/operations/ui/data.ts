import { supabase } from '@core/data/supabase';
import { run, useData } from '@core/data/api';
import type { StatusMap } from '@core/ui/primitives';

export const OP_STATUS: StatusMap = {
  scheduled: { label: 'Programada', tone: 'info' }, in_progress: { label: 'En curso', tone: 'brand' },
  completed: { label: 'Completada', tone: 'ok' }, cancelled: { label: 'Cancelada', tone: 'idle' },
};

export interface Operation {
  id: string; title: string; description: string | null; location_name: string | null; lat: number | null; lng: number | null;
  starts_at: string; ends_at: string; status: string; notes: string | null;
  operation_vehicles: { vehicle_id: string; vehicles: { unit_number: string } }[];
  operation_employees: { employee_id: string; role: string | null; employees: { full_name: string } }[];
}

export const keys = { all: ['operations'] as const };
const SELECT = '*, operation_vehicles(vehicle_id, vehicles(unit_number)), operation_employees(employee_id, role, employees(full_name))';

/** Operaciones que se solapan con [from, to) */
export function useOperations(from: Date, to: Date) {
  return useData([...keys.all, from.toISOString(), to.toISOString()], () =>
    run(supabase.from('operations').select(SELECT).lt('starts_at', to.toISOString()).gt('ends_at', from.toISOString()).order('starts_at')) as Promise<Operation[]>);
}

export function useMyOperations(employeeId: string | undefined) {
  return useData([...keys.all, 'mine', employeeId], async () => {
    const mine = await run(supabase.from('operation_employees').select('operation_id').eq('employee_id', employeeId!)) as { operation_id: string }[];
    if (!mine.length) return [];
    const since = new Date(Date.now() - 86_400_000).toISOString();
    return run(supabase.from('operations').select(SELECT).in('id', mine.map((m) => m.operation_id)).gt('ends_at', since)
      .neq('status', 'cancelled').order('starts_at')) as Promise<Operation[]>;
  }, { enabled: !!employeeId });
}
