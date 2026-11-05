import { supabase } from '@core/data/supabase';
import { rpc, run, useData } from '@core/data/api';
import { useAuth } from '@core/auth/AuthProvider';
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
  unit_cost?: number | null; photo_path: string | null; notes: string | null; archived_at: string | null;
  suppliers?: { name: string } | null; inventory_item_models?: { model_id: string }[];
}
export const available = (i: Item) => Number(i.quantity_on_hand) - Number(i.quantity_reserved);
export const stockTone = (i: Item) => (Number(i.quantity_on_hand) <= 0 ? 'bad' : Number(i.quantity_on_hand) <= Number(i.min_quantity) ? 'warn' : 'ok');

/**
 * Columnas legibles por todos. El precio (unit_cost) NO es legible por la API:
 * solo quien tiene inventory.view_costs (admin) lo recibe, por RPC, y se fusiona aquí.
 */
export const ITEM_COLS = 'id, sku, name, part_number, manufacturer, category, description, unit, quantity_on_hand, quantity_reserved, min_quantity, location, supplier_id, photo_path, notes, archived_at';
export const MOVE_COLS = 'id, item_id, movement_type, quantity, balance_after, reference_type, reference_id, supplier_id, notes, performed_by, performed_at';

/** ¿Puede ver precios y valor en existencia? */
export const useCanSeeCosts = () => useAuth().can('inventory.view_costs');

async function withCosts<T extends { id: string }>(rows: T[], fn: string, args: Record<string, unknown>): Promise<(T & { unit_cost: number | null })[]> {
  const costs = await rpc<{ id: string; unit_cost: number | null }[]>(fn, args);
  const m = new Map(costs.map((c) => [String(c.id), c.unit_cost]));
  return rows.map((r) => ({ ...r, unit_cost: m.get(String(r.id)) ?? null }));
}

export function useItems() {
  const costs = useCanSeeCosts();
  return useData([...keys.all, 'items', costs], async () => {
    const rows = await run(supabase.from('inventory_items').select(`${ITEM_COLS}, suppliers(name), inventory_item_models(model_id)`).is('archived_at', null).order('name')) as unknown as Item[];
    return costs ? withCosts(rows, 'inventory_item_costs', {}) as Promise<Item[]> : rows;
  });
}

export function useItem(id: string) {
  const costs = useCanSeeCosts();
  return useData([...keys.all, 'item', id, costs], async () => {
    const row = await run(supabase.from('inventory_items').select(`${ITEM_COLS}, suppliers(name), inventory_item_models(model_id)`).eq('id', id).single()) as unknown as Item;
    return costs ? (await withCosts([row], 'inventory_item_costs', { p_item: id }))[0] as Item : row;
  });
}

export function useMovements(itemId: string) {
  const costs = useCanSeeCosts();
  return useData([...keys.all, 'moves', itemId, costs], async () => {
    const rows = await run(supabase.from('inventory_movements').select(`${MOVE_COLS}, employees(full_name), suppliers(name)`).eq('item_id', itemId).order('performed_at', { ascending: false }).limit(500)) as any[];
    return costs ? withCosts(rows, 'inventory_movement_costs', { p_item: itemId }) : rows;
  });
}

export const useSuppliers = () => useData([...keys.all, 'suppliers'], () =>
  run(supabase.from('suppliers').select('*').is('archived_at', null).order('name')) as Promise<{ id: string; name: string; contact: string | null; phone: string | null; email: string | null; address: string | null; notes: string | null }[]>);
