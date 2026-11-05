import { supabase } from '@core/data/supabase';
import { run, useData } from '@core/data/api';
import type { StatusMap } from '@core/ui/primitives';

export const keys = { all: ['inventory'] as const };
export const MOVE: Record<string, string> = {
  initial: 'Existencia inicial', purchase: 'Compra / entrada', return: 'Devolución', adjustment_in: 'Ajuste (+)',
  adjustment_out: 'Ajuste (−)', issue: 'Salida manual', consumption: 'Consumo en orden',
};
export const PR_STATUS: StatusMap = {
  pending: { label: 'Pendiente', tone: 'warn' }, approved: { label: 'Aprobada', tone: 'info' }, ordered: { label: 'Pedida', tone: 'brand' },
  received: { label: 'Recibida', tone: 'ok' }, rejected: { label: 'Rechazada', tone: 'idle' }, cancelled: { label: 'Cancelada', tone: 'idle' },
};

export interface Item {
  id: string; sku: string; name: string; part_number: string | null; manufacturer: string | null; category: string | null; description: string | null;
  unit: string; quantity_on_hand: number; quantity_reserved: number; min_quantity: number; location: string | null; supplier_id: string | null;
  unit_cost: number | null; photo_path: string | null; notes: string | null; archived_at: string | null;
  suppliers?: { name: string } | null; inventory_item_models?: { model_id: string }[];
}
export const available = (i: Item) => Number(i.quantity_on_hand) - Number(i.quantity_reserved);
export const stockTone = (i: Item) => (Number(i.quantity_on_hand) <= 0 ? 'bad' : Number(i.quantity_on_hand) <= Number(i.min_quantity) ? 'warn' : 'ok');

export const useItems = () => useData([...keys.all, 'items'], () =>
  run(supabase.from('inventory_items').select('*, suppliers(name), inventory_item_models(model_id)').is('archived_at', null).order('name')) as Promise<Item[]>);

export const useSuppliers = () => useData([...keys.all, 'suppliers'], () =>
  run(supabase.from('suppliers').select('*').is('archived_at', null).order('name')) as Promise<{ id: string; name: string; contact: string | null; phone: string | null; email: string | null; address: string | null; notes: string | null }[]>);
