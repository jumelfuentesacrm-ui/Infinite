import { supabase } from '@core/data/supabase';
import { run, useData } from '@core/data/api';
import type { StatusMap } from '@core/ui/primitives';

export const MODULE = 'inspections';
export const RESULT: StatusMap = {
  pass: { label: 'Conforme', tone: 'ok' },
  pass_with_issues: { label: 'Con observaciones', tone: 'warn' },
  fail: { label: 'No apto', tone: 'bad' },
};
export const ITEM_RESULT: StatusMap = {
  ok: { label: 'Conforme', tone: 'ok' }, fail: { label: 'No conforme', tone: 'bad' }, na: { label: 'No aplica', tone: 'idle' },
};
export const FUEL_LEVELS = [
  { value: 'empty', label: 'Vacío' }, { value: 'quarter', label: '1/4' }, { value: 'half', label: '1/2' },
  { value: 'three_quarters', label: '3/4' }, { value: 'full', label: 'Lleno' },
];

export interface TemplateItem { id: string; template_id: string; position: number; category: string | null; label: string; help_text: string | null; is_critical: boolean; photo_required_on_fail: boolean; archived_at: string | null }
export interface Template { id: string; name: string; model_id: string | null; vehicle_type: string | null; is_default: boolean; active: boolean }
export interface Inspection {
  id: string; vehicle_id: string; employee_id: string; template_id: string; completed_at: string; result: string;
  engine_hours: number | null; mileage: number | null; fuel_level: string | null; notes: string | null; marked_unfit: boolean;
  reviewed_by: string | null; reviewed_at: string | null; review_notes: string | null;
  vehicles?: { unit_number: string }; employees?: { full_name: string };
}

export const keys = { all: ['inspections'] as const };

export function useInspections(filter: { vehicleId?: string; employeeId?: string; limit?: number } = {}) {
  return useData([...keys.all, filter], () => {
    let q = supabase.from('inspections').select('*, vehicles(unit_number), employees!inspections_employee_id_fkey(full_name)')
      .order('completed_at', { ascending: false }).limit(filter.limit ?? 300);
    if (filter.vehicleId) q = q.eq('vehicle_id', filter.vehicleId);
    if (filter.employeeId) q = q.eq('employee_id', filter.employeeId);
    return run(q) as Promise<Inspection[]>;
  });
}

export function useTemplateItems(templateId: string | null | undefined) {
  return useData(['inspection_items', templateId], () =>
    run(supabase.from('inspection_template_items').select('*').eq('template_id', templateId!).is('archived_at', null).order('position')) as Promise<TemplateItem[]>,
  { enabled: !!templateId });
}

export interface ComplianceRow { vehicle_id: string; unit_number: string; status: string; employee_id: string | null; employee_name: string | null; inspection_id: string | null; completed_at: string | null; result: string | null; inspected_today: boolean }
export function useCompliance() {
  return useData([...keys.all, 'compliance'], () => run(supabase.from('inspection_compliance_today').select('*').order('unit_number')) as Promise<ComplianceRow[]>);
}
