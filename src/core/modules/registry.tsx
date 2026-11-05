/**
 * Registro de módulos. Descubre automáticamente:
 *   - src/core-modules/<id>/index.tsx   (núcleo)
 *   - modules/<id>/ui/index.tsx         (opcionales; si la carpeta no existe, no existe el módulo)
 * y aplica dos interruptores:
 *   1. client.config.json → "modules": { "<id>": false }  (apagado en el build del cliente)
 *   2. tabla app_modules (Configuración › Módulos)       (apagado/prueba en caliente, validado también en BD)
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@core/data/supabase';
import { clientConfig } from '@core/config';
import type { ModuleManifest, SlotContribution } from './types';
import type { SlotName } from './slots';

const coreFiles = import.meta.glob<{ default: ModuleManifest }>('../../core-modules/*/index.tsx', { eager: true });
const moduleFiles = import.meta.glob<{ default: ModuleManifest }>('../../../modules/*/ui/index.tsx', { eager: true });

/** '../../../modules/<id>/ui/index.tsx' → '<id>' */
const folderId = (p: string) => p.split('/').slice(-3)[0];

export const CORE_MODULES: ModuleManifest[] = Object.values(coreFiles).map((m) => ({ ...m.default, core: true }));
export const INSTALLED_MODULES: ModuleManifest[] = Object.entries(moduleFiles)
  .map(([p, m]) => {
    if (m.default.id !== folderId(p)) console.warn(`Módulo en ${p} declara id "${m.default.id}"`);
    return m.default;
  })
  .filter((m) => clientConfig.modules[m.id] !== false);

export interface ModuleState { id: string; name: string; enabled: boolean; trial_until: string | null; is_core: boolean }

interface Registry {
  modules: ModuleManifest[];
  states: ModuleState[];
  isActive: (id: string) => boolean;
  slot: <N extends SlotName>(name: N) => SlotContribution<N>[];
  loading: boolean;
}

const Ctx = createContext<Registry | null>(null);

export function ModuleProvider({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ['app_modules'],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('app_modules').select('*');
      if (error) throw error;
      return data as ModuleState[];
    },
  });

  const value = useMemo<Registry>(() => {
    const states = data ?? [];
    const now = Date.now();
    const activeIds = new Set(
      INSTALLED_MODULES.filter((m) => {
        const s = states.find((x) => x.id === m.id);
        if (!s) return false; // migración no aplicada
        return s.enabled && (!s.trial_until || new Date(s.trial_until).getTime() > now);
      }).map((m) => m.id),
    );
    const modules = [...CORE_MODULES, ...INSTALLED_MODULES.filter((m) => activeIds.has(m.id))];
    const slotCache = new Map<string, SlotContribution<any>[]>();
    return {
      modules,
      states,
      loading: isLoading,
      isActive: (id) => CORE_MODULES.some((m) => m.id === id) || activeIds.has(id),
      slot: (name) => {
        if (!slotCache.has(name)) {
          slotCache.set(name, modules.flatMap((m) => m.slots ?? []).filter((s) => s.slot === name)
            .sort((a, b) => (a.order ?? 50) - (b.order ?? 50)));
        }
        return slotCache.get(name)!;
      },
    };
  }, [data, isLoading]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useModules() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useModules fuera de ModuleProvider');
  return ctx;
}
