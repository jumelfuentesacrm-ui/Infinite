/**
 * Regla del sistema: lo que ya se guardó solo lo modifica el administrador.
 * Los demás pueden abrir el formulario y editar; al guardar se envía una
 * solicitud de cambio al admin (que la aprueba o rechaza en /solicitudes).
 * El servidor lo garantiza igual (trigger zz_guard_update + request_change).
 */
import { useCallback } from 'react';
import { supabase } from './supabase';
import { rpc, run } from './api';
import { useAuth } from '@core/auth/AuthProvider';

export type SaveResult = 'saved' | 'requested';

/** Quita campos que no cambiaron, para que la solicitud muestre solo lo editado */
export function diff<T extends Record<string, unknown>>(before: Record<string, unknown>, after: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(after)) {
    const norm = (x: unknown) => (x === '' || x === undefined ? null : x);
    const a = norm(before[k]);
    const b = norm(v);
    if (JSON.stringify(a) !== JSON.stringify(b) && String(a) !== String(b)) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

export function useSaveOrRequest() {
  const { isAdmin } = useAuth();
  const save = useCallback(async (table: string, id: string, changes: Record<string, unknown>, before?: Record<string, unknown>, reason?: string): Promise<SaveResult> => {
    const patch = before ? diff(before, changes) : changes;
    if (!Object.keys(patch).length) return 'saved';
    if (isAdmin) {
      await run(supabase.from(table).update(patch).eq('id', id));
      return 'saved';
    }
    await rpc('request_change', { p_table: table, p_id: id, p_changes: patch, p_reason: reason ?? null });
    return 'requested';
  }, [isAdmin]);
  return { save, isAdmin };
}

/** Texto del aviso según el resultado */
export const savedMsg = (saved = 'Cambios guardados') => (r: unknown) =>
  r === 'requested' ? 'Solicitud enviada al administrador para aprobación' : saved;
