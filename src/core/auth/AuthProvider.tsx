import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@core/data/supabase';
import { AppError, rpc } from '@core/data/api';
import type { PermRule } from '@core/modules/types';

export interface Profile {
  id: string;
  employee_code: string;
  full_name: string;
  role_id: string;
  role_name: string;
  home_path: string;
  job_title: string | null;
  photo_path: string | null;
}

interface AuthCtx {
  session: Session | null;
  profile: Profile | null;
  ready: boolean;
  permissions: Set<string>;
  /** true si tiene el permiso (o cualquiera de la lista). Sin regla = true. */
  can: (rule?: PermRule) => boolean;
  login: (code: string, pin: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setSessionReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const uid = session?.user.id;
  const me = useQuery({
    queryKey: ['me', uid],
    enabled: !!uid,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [profile, perms] = await Promise.all([
        rpc<Profile[]>('my_profile'),
        rpc<string[]>('my_permissions'),
      ]);
      return { profile: profile[0] ?? null, perms: new Set(perms) };
    },
  });

  // Empleado desactivado mientras tenía sesión → cerrar sesión
  useEffect(() => {
    if (uid && me.isSuccess && !me.data.profile) supabase.auth.signOut();
  }, [uid, me.isSuccess, me.data]);

  const login = useCallback(async (code: string, pin: string) => {
    const { data: body, error: fnError } = await supabase.functions.invoke('pin-login', { body: { code, pin } });
    if (fnError) {
      const detail = await (fnError as { context?: Response }).context?.json?.().catch(() => null);
      throw new AppError(detail?.error ?? (/fetch/i.test(fnError.message) ? 'Sin conexión con el servidor' : 'No se pudo iniciar sesión'));
    }
    const { error } = await supabase.auth.setSession({ access_token: body.access_token, refresh_token: body.refresh_token });
    if (error) throw new AppError(error.message);
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    qc.clear();
  }, [qc]);

  const value = useMemo<AuthCtx>(() => {
    const permissions = me.data?.perms ?? new Set<string>();
    return {
      session,
      profile: me.data?.profile ?? null,
      ready: sessionReady && (!uid || !me.isLoading),
      permissions,
      can: (rule) => !rule || (Array.isArray(rule) ? rule.some((p) => permissions.has(p)) : permissions.has(rule)),
      login,
      logout,
    };
  }, [session, sessionReady, uid, me.data, me.isLoading, login, logout]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth fuera de AuthProvider');
  return ctx;
}

/** Muestra el contenido solo si el usuario tiene el permiso. (El servidor valida igual.) */
export function Can({ perm, children, fallback = null }: { perm?: PermRule; children: ReactNode; fallback?: ReactNode }) {
  return <>{useAuth().can(perm) ? children : fallback}</>;
}
