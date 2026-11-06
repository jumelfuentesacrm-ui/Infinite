/**
 * App en vivo.
 * - Un solo canal de Realtime escucha los cambios de la base (respeta RLS) y refresca
 *   lo que esté en pantalla. Varios cambios seguidos se agrupan en un solo refresco.
 * - Al volver a la app (desbloquear el teléfono, cambiar de pestaña) o recuperar
 *   la conexión, se vuelve a pedir todo lo visible.
 * - Los datos viven solo en memoria: no hay copia guardada en el teléfono que se
 *   quede vieja. Lo único que se guarda es el código de la app (para abrir rápido),
 *   y una versión nueva se instala con el botón de actualizar.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

const DEMO = import.meta.env.VITE_DEMO === '1';

export function useLiveSync(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => { clearTimeout(timer); timer = setTimeout(() => qc.invalidateQueries(), 350); };

    const channel = DEMO ? null : supabase
      .channel('live:all')
      .on('postgres_changes', { event: '*', schema: 'public' }, refresh)
      .subscribe();

    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', refresh);
    window.addEventListener('pageshow', refresh);
    return () => {
      clearTimeout(timer);
      if (channel) supabase.removeChannel(channel);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', refresh);
      window.removeEventListener('pageshow', refresh);
    };
  }, [enabled, qc]);
}

/** Versión nueva de la app: se busca sola y se aplica cuando el usuario toca actualizar. */
export function useAppUpdate() {
  const [ready, setReady] = useState(false);
  const reg = useRef<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (DEMO || !('serviceWorker' in navigator)) return;
    let alive = true;
    const watch = (r: ServiceWorkerRegistration) => {
      reg.current = r;
      if (r.waiting && navigator.serviceWorker.controller) setReady(true);
      r.addEventListener('updatefound', () => {
        const w = r.installing;
        w?.addEventListener('statechange', () => {
          if (alive && w.state === 'installed' && navigator.serviceWorker.controller) setReady(true);
        });
      });
    };
    navigator.serviceWorker.getRegistration().then((r) => r && watch(r));
    navigator.serviceWorker.ready.then((r) => { if (!reg.current) watch(r); });
    const check = () => { if (document.visibilityState === 'visible') reg.current?.update().catch(() => {}); };
    const id = setInterval(check, 5 * 60_000);
    document.addEventListener('visibilitychange', check);
    return () => { alive = false; clearInterval(id); document.removeEventListener('visibilitychange', check); };
  }, []);

  const apply = useCallback(() => {
    const w = reg.current?.waiting;
    if (!w) { location.reload(); return; }
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
    w.postMessage({ type: 'SKIP_WAITING' });
  }, []);

  /** Revisa en el servidor si hay versión nueva (sin esperar el chequeo automático) */
  const check = useCallback(async () => {
    try { await reg.current?.update(); } catch { /* sin conexión */ }
    const r = reg.current;
    return !!(r?.waiting && navigator.serviceWorker.controller);
  }, []);

  return { ready, apply, check };
}

/** Botón de refrescar: trae todo de nuevo; si hay versión nueva, la instala. */
export function useRefresh() {
  const qc = useQueryClient();
  const update = useAppUpdate();
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    const started = Date.now();
    try {
      if (update.ready || await update.check()) { update.apply(); return; }
      await qc.refetchQueries({ type: 'active' });
    } finally {
      // Giro mínimo para que se note que refrescó
      setTimeout(() => setBusy(false), Math.max(0, 600 - (Date.now() - started)));
    }
  }, [busy, qc, update]);
  return { refresh, spinning: busy, updateReady: update.ready, applyUpdate: update.apply };
}
