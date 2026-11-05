import { supabase } from '@core/data/supabase';
import { run, rpc, useAction, useData } from '@core/data/api';

export interface Notification {
  id: string; module_id: string; type: string; severity: 'info' | 'warning' | 'critical'; title: string; body: string | null;
  link: string | null; created_at: string; is_read: boolean;
}

export const notifKeys = { all: ['notifications'] as const };

export function useNotifications(limit = 50, unreadOnly = false) {
  return useData([...notifKeys.all, limit, unreadOnly], () => {
    let q = supabase.from('my_notifications').select('*').order('created_at', { ascending: false }).limit(limit);
    if (unreadOnly) q = q.eq('is_read', false);
    return run(q) as Promise<Notification[]>;
  }, { refetchInterval: 120_000 });
}

export function useMarkRead() {
  return useAction((ids: string[]) => rpc('mark_notifications_read', { p_ids: ids }), { invalidate: [notifKeys.all] });
}
