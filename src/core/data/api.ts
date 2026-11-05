/**
 * Capa de datos común: TODOS los módulos leen y escriben a través de estas
 * funciones y hooks (errores traducidos, invalidación de caché, avisos).
 */
import { useMutation, useQuery, useQueryClient, type QueryKey, type UseQueryOptions } from '@tanstack/react-query';
import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { useToast } from '@core/ui/Toast';

export class AppError extends Error {
  constructor(message: string, public code?: string) { super(message); }
}

export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  const pe = e as Partial<PostgrestError> & { message?: string };
  const msg = pe?.message ?? String(e);
  const code = pe?.code;
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return new AppError(/Permiso requerido|No puede|No tiene|Solo/.test(msg) ? msg : 'No tiene permiso para realizar esta acción.', '42501');
  }
  if (code === '23505') return new AppError('Ya existe un registro con ese valor (código, número o nombre repetido).', code);
  if (code === '23503') return new AppError('El registro está relacionado con otros datos y no se puede modificar así.', code);
  if (code === '23514' || code === '22023' || code === '23P01' || code === 'P0002' || code === '55000' || code === 'P0001') {
    return new AppError(msg, code);
  }
  if (/Failed to fetch|NetworkError/i.test(msg)) return new AppError('Sin conexión. Verifique su internet e intente de nuevo.', 'network');
  return new AppError(msg || 'Ocurrió un error inesperado.', code);
}

/** Ejecuta un RPC y lanza AppError legible si falla. */
export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw toAppError(error);
  return data as T;
}

/** Resultado de un query builder de Supabase → datos o AppError */
export async function run<T>(q: PromiseLike<{ data: T | null; error: PostgrestError | null }>): Promise<T> {
  const { data, error } = await q;
  if (error) throw toAppError(error);
  return data as T;
}

export function useData<T>(key: QueryKey, fn: () => Promise<T>, opts?: Omit<UseQueryOptions<T, AppError>, 'queryKey' | 'queryFn'>) {
  return useQuery<T, AppError>({ queryKey: key, queryFn: async () => { try { return await fn(); } catch (e) { throw toAppError(e); } }, ...opts });
}

interface ActionOpts<TOut> {
  /** Prefijos de claves de caché a refrescar al terminar */
  invalidate?: QueryKey[];
  success?: string | ((out: TOut) => string);
  onSuccess?: (out: TOut) => void;
}

/** Mutación genérica con aviso de éxito/error e invalidación de caché. */
export function useAction<TIn = void, TOut = unknown>(fn: (input: TIn) => Promise<TOut>, opts: ActionOpts<TOut> = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<TOut, AppError, TIn>({
    mutationFn: async (input) => { try { return await fn(input); } catch (e) { throw toAppError(e); } },
    onSuccess: (out) => {
      opts.invalidate?.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      const s = typeof opts.success === 'function' ? opts.success(out) : opts.success;
      if (s) toast.success(s);
      opts.onSuccess?.(out);
    },
    onError: (e) => toast.error(e.message),
  });
}
