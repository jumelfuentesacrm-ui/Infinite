import { useEffect, useState } from 'react';
import { Clock, Coffee, LogIn, LogOut, MapPin, Check, X, Plus, Timer } from 'lucide-react';
import { supabase } from '@core/data/supabase';
import { rpc, run, useAction, useData } from '@core/data/api';
import { useAuth } from '@core/auth/AuthProvider';
import { getPosition } from '@core/lib/geo';
import { fmtDate, fmtDateTime, fmtHours, fmtTime, today, toLocalInput } from '@core/lib/format';
import { Badge, Button, Card, EmptyState, PageHeader, QueryView, Section, StatCard, Tabs, cx } from '@core/ui/primitives';
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from '@core/ui/form';
import { EmployeeSelect } from '@core/ui/pickers';
import { DataTable } from '@core/ui/DataTable';
import { Modal } from '@core/ui/Modal';

const TYPE: Record<string, string> = { in: 'Entrada', out: 'Salida', break_start: 'Inicio descanso', break_end: 'Fin descanso' };
const keys = { all: ['timeclock'] as const };

interface Punch { id: string; employee_id: string; punch_type: string; punched_at: string; lat: number | null; lng: number | null; accuracy_m: number | null; source: string; voided: boolean; employees?: { full_name: string }; vehicles?: { unit_number: string } | null }

function usePunches(filter: { employeeId?: string; from?: string; to?: string }) {
  return useData([...keys.all, 'punches', filter], () => {
    let q = supabase.from('time_punches').select('*, employees(full_name), vehicles(unit_number)').order('punched_at', { ascending: false }).limit(500);
    if (filter.employeeId) q = q.eq('employee_id', filter.employeeId);
    if (filter.from) q = q.gte('punched_at', new Date(filter.from + 'T00:00:00').toISOString());
    if (filter.to) q = q.lt('punched_at', new Date(new Date(filter.to + 'T00:00:00').getTime() + 86_400_000).toISOString());
    return run(q) as Promise<Punch[]>;
  });
}

/** Teléfono: ponchar */
export function PunchPage() {
  const { profile } = useAuth();
  const state = useData([...keys.all, 'state'], () => rpc<{ state: 'off' | 'in' | 'break'; last: Punch | null }>('my_punch_state'), { refetchInterval: 60_000 });
  const todayPunches = usePunches({ employeeId: profile?.id, from: today(), to: today() });
  const [locating, setLocating] = useState(false);
  const [correction, setCorrection] = useState(false);
  const punch = useAction(async (type: string) => {
    setLocating(true);
    const pos = await getPosition().finally(() => setLocating(false));
    return rpc('punch', { p_type: type, p_lat: pos?.lat ?? null, p_lng: pos?.lng ?? null, p_accuracy: pos?.accuracy ?? null });
  }, { invalidate: [keys.all, ['dashboard']], success: 'Ponche registrado' });

  const s = state.data?.state ?? 'off';
  const label = { off: 'Fuera de turno', in: 'En turno', break: 'En descanso' }[s];
  const busy = punch.isPending || locating;
  return (
    <div className="mx-auto max-w-md">
      <PageHeader title="Ponches" back="/m" />
      <Card className="mb-4 text-center">
        <div className="num text-5xl font-semibold tracking-tight"><LiveClock /></div>
        <div className="mt-1 text-sm capitalize text-muted">{new Date().toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        <div className="mt-3"><Badge tone={s === 'in' ? 'ok' : s === 'break' ? 'warn' : 'idle'}>{label}</Badge></div>
        {state.data?.last && <div className="mt-2 text-xs text-muted">Último: {TYPE[state.data.last.punch_type]} a las {fmtTime(state.data.last.punched_at)}</div>}
      </Card>
      <div className="grid gap-3">
        {s === 'off' && <Big icon={LogIn} label="Marcar entrada" tone="primary" busy={busy} onClick={() => punch.mutate('in')} />}
        {s === 'in' && <>
          <Big icon={Coffee} label="Iniciar descanso" busy={busy} onClick={() => punch.mutate('break_start')} />
          <Big icon={LogOut} label="Marcar salida" tone="dark" busy={busy} onClick={() => punch.mutate('out')} />
        </>}
        {s === 'break' && <Big icon={Timer} label="Terminar descanso" tone="primary" busy={busy} onClick={() => punch.mutate('break_end')} />}
      </div>
      {locating && <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-muted"><MapPin className="size-3.5" />Obteniendo ubicación…</p>}
      <Section title="Hoy" className="mt-5" actions={<Button size="sm" variant="ghost" onClick={() => setCorrection(true)}>Solicitar corrección</Button>}>
        <QueryView q={todayPunches} empty={<p className="text-sm text-muted">Sin ponches hoy</p>}>
          {(rows) => <ul className="space-y-1.5">{rows.map((p) => (
            <li key={p.id} className={cx('flex justify-between text-sm', p.voided && 'line-through opacity-50')}>
              <span>{TYPE[p.punch_type]}{p.source === 'correction' && <span className="ml-1 text-xs text-muted">(corregido)</span>}</span><span className="num">{fmtTime(p.punched_at)}</span>
            </li>))}</ul>}
        </QueryView>
      </Section>
      {correction && profile && <CorrectionForm employeeId={profile.id} onClose={() => setCorrection(false)} />}
    </div>
  );
}

function LiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15_000); return () => clearInterval(t); }, []);
  return <>{fmtTime(now)}</>;
}

function Big({ icon: Icon, label, onClick, busy, tone }: { icon: typeof Clock; label: string; onClick: () => void; busy?: boolean; tone?: 'primary' | 'dark' }) {
  return (
    <button onClick={onClick} disabled={busy}
      className={cx('flex h-20 items-center justify-center gap-3 rounded-card text-lg font-semibold shadow-card transition-transform active:scale-[0.98] disabled:opacity-60',
        tone === 'primary' ? 'bg-brand text-white' : tone === 'dark' ? 'bg-ink text-white' : 'border border-line bg-panel')}>
      <Icon className="size-6" />{label}
    </button>
  );
}

function CorrectionForm({ employeeId, onClose, punch }: { employeeId?: string; onClose: () => void; punch?: Punch }) {
  const { can, profile } = useAuth();
  const [emp, setEmp] = useState(employeeId ?? '');
  const [type, setType] = useState(punch?.punch_type ?? 'out');
  const [at, setAt] = useState(toLocalInput(punch ? new Date(punch.punched_at) : new Date()));
  const [reason, setReason] = useState('');
  const [voidOnly, setVoidOnly] = useState(false);
  const save = useAction(() => rpc('request_punch_correction', { p_employee: emp, p_punch: punch?.id ?? null, p_type: voidOnly ? null : type,
    p_at: voidOnly ? null : new Date(at).toISOString(), p_reason: reason, p_void_only: voidOnly }),
  { invalidate: [keys.all], success: 'Corrección enviada para aprobación', onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title={punch ? 'Corregir ponche' : 'Solicitar corrección'} size="sm"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={reason.trim().length < 4 || !emp} loading={save.isPending} onClick={() => save.mutate()}>Enviar</Button></>}>
      <div className="space-y-3">
        {can('timeclock.edit') && !employeeId && <Field label="Empleado"><EmployeeSelect value={emp} onChange={setEmp} /></Field>}
        {punch && <p className="text-sm text-muted">Original: {TYPE[punch.punch_type]} · {fmtDateTime(punch.punched_at)}</p>}
        {punch && <Checkbox label="Solo anular este ponche" checked={voidOnly} onChange={(e) => setVoidOnly(e.target.checked)} />}
        {!voidOnly && <FormGrid>
          <Field label="Tipo"><Select value={type} onChange={(e) => setType(e.target.value)} options={Object.entries(TYPE).map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="Fecha y hora correcta"><Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></Field>
        </FormGrid>}
        <Field label="Motivo" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej. olvidé ponchar la salida" /></Field>
        <p className="text-xs text-muted">{emp === profile?.id ? 'Un supervisor debe aprobarla. ' : ''}El registro original no se borra: queda anulado y auditado.</p>
      </div>
    </Modal>
  );
}

/** Administración de ponches */
export function TimeclockAdmin() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'daily' | 'punches' | 'corrections'>('daily');
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [correct, setCorrect] = useState<Punch | 'new' | null>(null);
  const daily = useData([...keys.all, 'daily', from, to], () =>
    run(supabase.from('timeclock_daily').select('*').gte('work_date', from).lte('work_date', to).order('work_date', { ascending: false })) as Promise<any[]>);
  const emps = useData(['employees', 'names'], () => run(supabase.from('employees').select('id, full_name')) as Promise<{ id: string; full_name: string }[]>);
  const name = (id: string) => emps.data?.find((e) => e.id === id)?.full_name ?? '…';
  const punches = usePunches({ from, to });
  const corrections = useData([...keys.all, 'corrections'], () =>
    run(supabase.from('time_punch_corrections').select('*, employee:employees!time_punch_corrections_employee_id_fkey(full_name), requester:employees!time_punch_corrections_requested_by_fkey(full_name)')
      .order('requested_at', { ascending: false }).limit(200)) as Promise<any[]>);
  const decide = useAction((a: { id: string; ok: boolean }) => rpc('decide_punch_correction', { p_id: a.id, p_approve: a.ok }), { invalidate: [keys.all], success: 'Decisión registrada' });
  const pending = corrections.data?.filter((c) => c.status === 'pending').length ?? 0;

  return (
    <>
      <PageHeader title="Ponches" actions={can('timeclock.edit') && <Button icon={Plus} onClick={() => setCorrect('new')}>Corrección</Button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'daily', label: 'Jornadas' }, { id: 'punches', label: 'Registros' }, { id: 'corrections', label: 'Correcciones', count: pending || undefined }]} />
      {tab !== 'corrections' && (
        <div className="mb-3 flex flex-wrap gap-2">
          <Field label="Desde"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" /></Field>
          <Field label="Hasta"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" /></Field>
        </div>
      )}
      {tab === 'daily' && <DataTable rows={daily.data} loading={daily.isLoading} error={daily.error} exportName="Jornadas" rowKey={(r) => r.employee_id + r.work_date} columns={[
        { key: 'employee', header: 'Empleado', mobile: 'title', value: (r) => name(r.employee_id) },
        { key: 'work_date', header: 'Fecha', render: (r) => fmtDate(r.work_date) },
        { key: 'first_in', header: 'Entrada', render: (r) => <span className="num">{fmtTime(r.first_in)}</span> },
        { key: 'last_out', header: 'Salida', render: (r) => r.last_out ? <span className="num">{fmtTime(r.last_out)}</span> : <Badge tone="ok">En turno</Badge> },
        { key: 'worked_hours', header: 'Trabajadas', align: 'right', render: (r) => <span className="num font-medium">{fmtHours(r.worked_hours)}</span> },
        { key: 'break_hours', header: 'Descanso', align: 'right', render: (r) => <span className="num">{fmtHours(r.break_hours)}</span> },
      ]} />}
      {tab === 'punches' && <DataTable rows={punches.data} loading={punches.isLoading} error={punches.error} exportName="Ponches"
        onRowClick={can('timeclock.edit') ? (p) => setCorrect(p) : undefined} columns={[
          { key: 'punched_at', header: 'Fecha y hora', mobile: 'title', render: (p) => <span className={cx('num', p.voided && 'line-through opacity-50')}>{fmtDateTime(p.punched_at)}</span> },
          { key: 'employee', header: 'Empleado', value: (p) => p.employees?.full_name },
          { key: 'punch_type', header: 'Tipo', value: (p) => TYPE[p.punch_type], render: (p) => <>{TYPE[p.punch_type]}{p.source === 'correction' && <Badge tone="info" dot={false} className="ml-1.5">corrección</Badge>}{p.voided && <Badge dot={false} className="ml-1.5">anulado</Badge>}</> },
          { key: 'vehicle', header: 'Vehículo', mobile: 'hide', value: (p) => p.vehicles?.unit_number },
          { key: 'gps', header: 'Ubicación', mobile: 'hide', render: (p) => p.lat ? <a onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 underline" target="_blank" rel="noopener" href={`https://maps.google.com/?q=${p.lat},${p.lng}`}><MapPin className="size-3.5" />±{Math.round(p.accuracy_m ?? 0)} m</a> : '—' },
        ]} />}
      {tab === 'corrections' && <DataTable rows={corrections.data} loading={corrections.isLoading} error={corrections.error} columns={[
        { key: 'requested_at', header: 'Solicitada', mobile: 'title', render: (c) => <span className="num">{fmtDateTime(c.requested_at)}</span> },
        { key: 'employee', header: 'Empleado', value: (c) => c.employee?.full_name },
        { key: 'change', header: 'Cambio', value: (c) => c.void_only ? 'Anular ponche' : `${TYPE[c.new_punch_type]} · ${fmtDateTime(c.new_punched_at)}` },
        { key: 'reason', header: 'Motivo' },
        { key: 'status', header: 'Estado', render: (c) => c.status === 'pending' && can('timeclock.approve') ? (
          <span className="flex gap-1"><Button size="sm" icon={Check} onClick={() => decide.mutate({ id: c.id, ok: true })}>Aprobar</Button><Button size="sm" variant="ghost" icon={X} onClick={() => decide.mutate({ id: c.id, ok: false })}>Rechazar</Button></span>
        ) : <Badge tone={c.status === 'approved' ? 'ok' : c.status === 'rejected' ? 'bad' : 'warn'}>{{ pending: 'Pendiente', approved: 'Aprobada', rejected: 'Rechazada' }[c.status as string]}</Badge> },
      ]} />}
      {correct && <CorrectionForm punch={correct === 'new' ? undefined : correct} employeeId={correct === 'new' ? undefined : correct.employee_id} onClose={() => setCorrect(null)} />}
    </>
  );
}

export function EmployeePunchesTab({ employeeId }: { employeeId: string }) {
  const q = usePunches({ employeeId });
  return <DataTable rows={q.data} loading={q.isLoading} error={q.error} exportName="Ponches-empleado" columns={[
    { key: 'punched_at', header: 'Fecha y hora', mobile: 'title', render: (p) => <span className={cx('num', p.voided && 'line-through opacity-50')}>{fmtDateTime(p.punched_at)}</span> },
    { key: 'punch_type', header: 'Tipo', value: (p) => TYPE[p.punch_type] },
  ]} empty={<EmptyState icon={Clock} title="Sin ponches" />} />;
}

export function OnShiftKpi() {
  const q = useData(['dashboard', 'onshift'], () => run(supabase.from('timeclock_daily').select('employee_id, last_out').eq('work_date', today())) as Promise<any[]>);
  return <StatCard label="Empleados en turno" value={q.data?.filter((r) => !r.last_out).length ?? '—'} icon={Clock} tone="info" to="/ponches" />;
}

/** Configuración › geocerca */
export function GeofencePanel() {
  const { can } = useAuth();
  const q = useData(['app_settings', 'timeclock'], () => run(supabase.from('app_settings').select('value').eq('key', 'timeclock').single()) as Promise<{ value: any }>);
  const [v, setV] = useState<any>(null);
  const cfg = v ?? q.data?.value;
  const save = useAction(() => run(supabase.from('app_settings').update({ value: cfg }).eq('key', 'timeclock')), { invalidate: [['app_settings']], success: 'Guardado' });
  const here = async () => { const p = await getPosition(); if (p) setV({ ...cfg, geofence: { ...cfg.geofence, lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) } }); };
  if (!cfg) return null;
  const g = cfg.geofence ?? {};
  const setG = (patch: object) => setV({ ...cfg, geofence: { ...g, ...patch } });
  return (
    <Section title="Ponches y geocerca" description="Con la geocerca activa, solo se puede ponchar dentro del radio indicado. El servidor lo valida.">
      <fieldset disabled={!can('settings.manage')} className="max-w-xl space-y-3">
        <Checkbox label="Exigir ubicación GPS para ponchar" checked={cfg.require_location !== false} onChange={(e) => setV({ ...cfg, require_location: e.target.checked })} />
        <Checkbox label="Activar geocerca" checked={!!g.enabled} onChange={(e) => setG({ enabled: e.target.checked })} />
        <FormGrid cols={3}>
          <Field label="Latitud"><Input type="number" step="0.000001" value={g.lat ?? ''} onChange={(e) => setG({ lat: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
          <Field label="Longitud"><Input type="number" step="0.000001" value={g.lng ?? ''} onChange={(e) => setG({ lng: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
          <Field label="Radio (m)"><Input type="number" value={g.radius_m ?? 300} onChange={(e) => setG({ radius_m: Number(e.target.value) })} /></Field>
        </FormGrid>
        <div className="flex gap-2"><Button icon={MapPin} onClick={here}>Usar mi ubicación actual</Button><Button variant="primary" loading={save.isPending} disabled={!v} onClick={() => save.mutate()}>Guardar</Button></div>
      </fieldset>
    </Section>
  );
}
