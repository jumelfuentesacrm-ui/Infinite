import { Fragment, Suspense, useState } from 'react';
import { supabase } from '@core/data/supabase';
import { rpc, run, useAction, useData } from '@core/data/api';
import { useAuth } from '@core/auth/AuthProvider';
import { INSTALLED_MODULES, useModules } from '@core/modules/registry';
import { Badge, Button, PageHeader, QueryView, Section, Spinner, Tabs, cx } from '@core/ui/primitives';
import { Field, FormGrid, Input, Select } from '@core/ui/form';
import { DataTable } from '@core/ui/DataTable';
import { fmtDate, fmtDateTime } from '@core/lib/format';
import { ROLE_LABELS } from '@core/data/shared';

export default function SettingsPage() {
  const { modules } = useModules();
  const { can } = useAuth();
  const panels = modules.flatMap((m) => (m.settings ?? []).map((s) => ({ ...s, module: m.name }))).filter((p) => can(p.perm));
  const [tab, setTab] = useState('general');
  return (
    <>
      <PageHeader title="Configuración" />
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'general', label: 'General' }, { id: 'modules', label: 'Módulos' }, { id: 'roles', label: 'Roles y permisos' },
        { id: 'audit', label: 'Auditoría' }, ...panels.map((p) => ({ id: p.id, label: p.title })),
      ]} />
      {tab === 'general' && <General />}
      {tab === 'modules' && <Modules />}
      {tab === 'roles' && <RoleMatrix />}
      {tab === 'audit' && <Audit />}
      {panels.filter((p) => p.id === tab).map((p) => { const C = p.component; return <Suspense key={p.id} fallback={<Spinner />}><C /></Suspense>; })}
    </>
  );
}

function General() {
  const { can } = useAuth();
  const q = useData(['app_settings', 'company'], () => run(supabase.from('app_settings').select('value').eq('key', 'company').single()) as Promise<{ value: { name: string; timezone: string } }>);
  const [form, setForm] = useState<{ name: string; timezone: string } | null>(null);
  const v = form ?? q.data?.value;
  const save = useAction(() => run(supabase.from('app_settings').update({ value: v }).eq('key', 'company')),
    { invalidate: [['app_settings']], success: 'Configuración guardada' });
  return (
    <Section title="Compañía">
      {v && (
        <div className="max-w-xl space-y-4">
          <FormGrid>
            <Field label="Nombre de la compañía"><Input value={v.name} disabled={!can('settings.manage')} onChange={(e) => setForm({ ...v, name: e.target.value })} /></Field>
            <Field label="Zona horaria" hint="Define el “día” de inspecciones, ponches y alertas">
              <Select value={v.timezone} disabled={!can('settings.manage')} onChange={(e) => setForm({ ...v, timezone: e.target.value })}
                options={['America/Puerto_Rico', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Mexico_City', 'America/Bogota', 'America/La_Paz', 'Europe/Madrid', 'UTC']
                  .map((z) => ({ value: z, label: z }))} />
            </Field>
          </FormGrid>
          {can('settings.manage') && <Button variant="primary" loading={save.isPending} disabled={!form} onClick={() => save.mutate()}>Guardar</Button>}
        </div>
      )}
    </Section>
  );
}

function Modules() {
  const { states } = useModules();
  const { can } = useAuth();
  const [trial, setTrial] = useState<Record<string, string>>({});
  const set = useAction((a: { id: string; enabled: boolean; trial?: string | null }) =>
    rpc('set_module_state', { p_module: a.id, p_enabled: a.enabled, p_trial_until: a.trial ? new Date(a.trial + 'T23:59:59').toISOString() : null }),
  { invalidate: [['app_modules']], success: 'Módulo actualizado' });
  const optional = states.filter((s) => !s.is_core);
  return (
    <Section title="Módulos instalados" description="Desactivar un módulo detiene su uso (también en el servidor). Los datos ya registrados se conservan siempre.">
      <ul className="divide-y divide-line">
        {optional.map((s) => {
          const expired = s.trial_until && new Date(s.trial_until) < new Date();
          const inBuild = INSTALLED_MODULES.some((m) => m.id === s.id);
          return (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <div className="flex items-center gap-2 font-medium">{s.name}
                  {!s.enabled ? <Badge tone="idle">Desactivado</Badge> : expired ? <Badge tone="bad">Prueba vencida</Badge>
                    : s.trial_until ? <Badge tone="warn">Prueba hasta {fmtDate(s.trial_until)}</Badge> : <Badge tone="ok">Activo</Badge>}
                  {!inBuild && <Badge tone="idle" dot={false}>Oculto en este build</Badge>}
                </div>
                <div className="num text-xs text-faint">{s.id}</div>
              </div>
              {can('settings.manage') && (
                <div className="flex flex-wrap items-center gap-2">
                  <Input type="date" className="h-8 w-40 text-[13px]" value={trial[s.id] ?? s.trial_until?.slice(0, 10) ?? ''} onChange={(e) => setTrial({ ...trial, [s.id]: e.target.value })} title="Fecha fin de prueba (opcional)" />
                  <Button size="sm" onClick={() => set.mutate({ id: s.id, enabled: true, trial: trial[s.id] ?? s.trial_until?.slice(0, 10) ?? null })}>{s.enabled ? 'Guardar prueba' : 'Activar'}</Button>
                  {s.enabled && <Button size="sm" variant="ghost" onClick={() => set.mutate({ id: s.id, enabled: true, trial: null })}>Sin límite</Button>}
                  {s.enabled && <Button size="sm" variant="ghost" className="text-bad" onClick={() => set.mutate({ id: s.id, enabled: false })}>Desactivar</Button>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

interface Perm { id: string; module_id: string; label: string; sort: number }
function RoleMatrix() {
  const { can } = useAuth();
  const { states } = useModules();
  const q = useData(['role_matrix'], async () => {
    const [perms, rp] = await Promise.all([
      run(supabase.from('permissions').select('*').order('module_id').order('sort')) as Promise<Perm[]>,
      run(supabase.from('role_permissions').select('*')) as Promise<{ role_id: string; permission_id: string }[]>,
    ]);
    return { perms, set: new Set(rp.map((r) => `${r.role_id}|${r.permission_id}`)) };
  });
  const toggle = useAction((a: { role: string; perm: string; on: boolean }) => rpc('set_role_permission', { p_role: a.role, p_perm: a.perm, p_granted: a.on }),
    { invalidate: [['role_matrix'], ['me']] });
  const roles = ['admin', 'supervisor', 'driver', 'mechanic'];
  return (
    <Section title="Permisos por rol" description="El administrador siempre tiene todo. Para excepciones de una persona use su expediente › Permisos.">
      <QueryView q={q}>
        {({ perms, set }) => (
          <div className="scroll-x -mx-4 px-4">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="border-b border-line text-left text-xs text-muted">
                <th className="py-2 pr-3 font-medium">Permiso</th>
                {roles.map((r) => <th key={r} className="px-2 py-2 text-center font-medium">{ROLE_LABELS[r]}</th>)}
              </tr></thead>
              <tbody>
                {perms.map((p, i) => (
                  <Fragment key={p.id}>
                    {(i === 0 || perms[i - 1].module_id !== p.module_id) && (
                      <tr><td colSpan={5} className="pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{states.find((s) => s.id === p.module_id)?.name ?? p.module_id}</td></tr>
                    )}
                    <tr className="border-b border-line/70">
                      <td className="py-1.5 pr-3">{p.label}</td>
                      {roles.map((r) => {
                        const on = r === 'admin' || set.has(`${r}|${p.id}`);
                        return (
                          <td key={r} className="px-2 py-1.5 text-center">
                            <input type="checkbox" checked={on} disabled={r === 'admin' || !can('settings.manage') || toggle.isPending}
                              onChange={(e) => toggle.mutate({ role: r, perm: p.id, on: e.target.checked })}
                              className={cx('size-4 accent-[var(--color-brand)]')} />
                          </td>
                        );
                      })}
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryView>
    </Section>
  );
}

function Audit() {
  const [table, setTable] = useState('');
  const q = useData(['audit_log', table], () => {
    let x = supabase.from('audit_log').select('*').order('changed_at', { ascending: false }).limit(500);
    if (table) x = x.eq('table_name', table);
    return run(x) as Promise<any[]>;
  });
  const emps = useData(['employees', 'names'], () => run(supabase.from('employees').select('id, full_name')) as Promise<{ id: string; full_name: string }[]>);
  const name = (id: string | null) => emps.data?.find((e) => e.id === id)?.full_name ?? (id ? id.slice(0, 8) : 'Sistema');
  const tables = ['vehicles', 'employees', 'inspections', 'work_orders', 'inventory_items', 'time_punches', 'incidents', 'maintenance_records', 'documents', 'auth'];
  return (
    <DataTable rows={q.data} loading={q.isLoading} error={q.error} exportName="Auditoria"
      toolbar={<Select value={table} onChange={(e) => setTable(e.target.value)} placeholder="Todas las tablas" className="h-9 w-48" options={tables.map((t) => ({ value: t, label: t }))} />}
      columns={[
        { key: 'changed_at', header: 'Fecha', render: (r) => <span className="num text-[13px]">{fmtDateTime(r.changed_at)}</span> },
        { key: 'employee_id', header: 'Usuario', value: (r) => name(r.employee_id), mobile: 'title' },
        { key: 'action', header: 'Acción', render: (r) => <Badge tone={r.action === 'INSERT' ? 'ok' : r.action === 'DELETE' ? 'bad' : 'info'} dot={false}>{r.new_data?.event ?? r.action}</Badge> },
        { key: 'table_name', header: 'Tabla', render: (r) => <span className="num text-[13px]">{r.table_name}</span> },
        { key: 'changed_fields', header: 'Cambios', value: (r) => (r.changed_fields ?? []).join(', '),
          render: (r) => <span className="text-[13px] text-muted">{(r.changed_fields ?? []).map((f: string) => `${f}: ${fmtVal(r.old_data?.[f])} → ${fmtVal(r.new_data?.[f])}`).join(' · ') || '—'}</span> },
      ]} />
  );
}
const fmtVal = (v: unknown) => (v == null ? '∅' : typeof v === 'object' ? JSON.stringify(v).slice(0, 40) : String(v).slice(0, 40));
