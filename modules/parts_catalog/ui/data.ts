import { supabase } from '@core/data/supabase';
import { rpc, run, useData } from '@core/data/api';

export const MODULE = 'parts_catalog';
export const keys = { all: ['parts_catalog'] as const };

export interface CatalogRow {
  part_id: string; manufacturer: string; oem_number: string; name: string; description: string | null; system: string | null; category: string | null;
  subcategory: string | null; callout: string | null; diagram_id: string | null; diagram_title: string | null; page_number: number | null; source_page: number | null;
  manual_title: string | null; inventory_item_id: string | null; inventory_sku: string | null; on_hand: number | null; available: number | null; location: string | null;
}

export function useCatalogSearch(f: { modelId?: string | null; query?: string; system?: string | null; diagramId?: string | null }, enabled = true) {
  return useData([...keys.all, 'search', f], () => rpc<CatalogRow[]>('catalog_search', {
    p_model: f.modelId || null, p_query: f.query || null, p_system: f.system || null, p_diagram: f.diagramId || null, p_limit: 300,
  }), { enabled });
}

export interface Manual { id: string; title: string; manufacturer: string; manual_type: string; model_id: string | null; year_from: number | null; year_to: number | null; storage_path: string | null; page_count: number | null; notes: string | null }
export const MANUAL_TYPES: Record<string, string> = { service: 'Servicio', repair: 'Reparación', parts: 'Catálogo de piezas', owner: 'Del propietario', wiring: 'Diagramas eléctricos', other: 'Otro' };
export const useManuals = () => useData([...keys.all, 'manuals'], () => run(supabase.from('manuals').select('*').is('archived_at', null).order('manufacturer').order('title')) as Promise<Manual[]>);

export function useDiagrams(modelId: string | null) {
  return useData([...keys.all, 'diagrams', modelId], () =>
    run(supabase.from('catalog_diagrams').select('*, manuals(title, storage_path)').eq('model_id', modelId!).order('system').order('title')) as Promise<any[]>, { enabled: !!modelId });
}
