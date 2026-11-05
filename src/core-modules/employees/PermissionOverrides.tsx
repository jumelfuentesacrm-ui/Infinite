import { supabase } from '@core/data/supabase';
import { rpc, run, useAction, useData } from '@core/data/api';
import { useModules } from '@core/modules/registry';
import type { Employee } from '@core/data/shared';
import { QueryView, Section, cx } from '@core/ui/primitives';

interface Perm { id: string; module_id: string; action: string; label: string; sort: number }

/** Excepciones individuales: conceder o quitar permisos a un empleado sobre su rol. */
export function PermissionOverrides({ employee }: { employee: Employee }) {
  const { states } = useModules();
  const q = useData(['perm_matrix', employee.id], async () => {
    const [perms, rolePerms, overrides] = await Promise.all([
      run(supabase.from('permissions').select('*').order('module_id').order('sort')) as Promise<Perm[]>,
      run(supabase.from('role_permissions').select('permission_id').eq('role_id', employee.role_id)) as Promise<{ permission_id: string }[]>,
      run(supabase.from('employee_permission_overrides').select('*').eq('employee_id', employee.id)) as Promise<{ permission_id: string; granted: boolean }[]>,
    ]);
    return { perms, role: new Set(rolePerms.map((r) => r.permission_id)), overrides: new Map(overrides.map((o) => [o.permission_id, o.granted])) };
  });
  const set = useAction((a: { perm: string; granted: boolean | null }) =>
    rpc('set_permission_override', { p_employee: employee.id, p_perm: a.perm, p_granted: a.granted }),
  { invalidate: [['perm_matrix', employee.id]], success: 'Permiso actualizado' });

  const isAdmin = employee.role_id === 'admin';
  return (
    <Section title="Permisos individuales" description="Por defecto aplica lo que define su rol. Puede conceder o quitar permisos a esta persona en particular.">
      {isAdmin && <p className="mb-3 text-sm text-muted">Los administradores tienen todos los permisos salvo que se quiten aquí explícitamente.</p>}
      <QueryView q={q}>
        {({ perms, role, overrides }) => {
          const byModule = perms.reduce<Record<string, Perm[]>>((acc, p) => ((acc[p.module_id] ??= []).push(p), acc), {});
          return (
            <div className="space-y-5">
              {Object.entries(byModule).map(([mod, list]) => (
                <div key={mod}>
                  <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wider text-muted">{states.find((s) => s.id === mod)?.name ?? mod}</h3>
                  <ul className="divide-y divide-line rounded-md border border-line">
                    {list!.map((p) => {
                      const ovr = overrides.get(p.id);
                      const base = isAdmin || role.has(p.id);
                      const effective = ovr ?? base;
                      const value = ovr === undefined ? 'role' : ovr ? 'grant' : 'deny';
                      return (
                        <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                          <div className="min-w-0">
                            <div className="text-sm">{p.label}</div>
                            <div className="num text-[11px] text-faint">{p.id}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={cx('size-2 rounded-full', effective ? 'bg-ok' : 'bg-line-strong')} title={effective ? 'Tiene el permiso' : 'Sin permiso'} />
                            <select value={value} disabled={set.isPending}
                              onChange={(e) => set.mutate({ perm: p.id, granted: e.target.value === 'role' ? null : e.target.value === 'grant' })}
                              className="h-8 rounded-md border border-line-strong bg-panel px-2 text-[13px]">
                              <option value="role">Según rol ({base ? 'sí' : 'no'})</option>
                              <option value="grant">Conceder</option>
                              <option value="deny">Quitar</option>
                            </select>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          );
        }}
      </QueryView>
    </Section>
  );
}
