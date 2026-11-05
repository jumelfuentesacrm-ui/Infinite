import { useEffect } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { supabase } from './supabase';

/** Refresca las consultas indicadas cuando cambia una tabla (Supabase Realtime). */
export function useLiveTable(table: string, keys: QueryKey[], filter?: string) {
  const qc = useQueryClient();
  const sig = JSON.stringify(keys) + (filter ?? '');
  useEffect(() => {
    const channel = supabase
      .channel(`live:${table}:${sig}`)
      .on('postgres_changes', { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) }, () => {
        keys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, sig]);
}
