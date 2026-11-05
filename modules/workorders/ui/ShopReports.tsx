import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, ClipboardList, Hand, Inbox, Wrench } from 'lucide-react';
import { supabase } from '@core/data/supabase';
import { rpc, run, useAction, useData } from '@core/data/api';
import { useLiveTable } from '@core/data/realtime';
import { useAuth, useWho } from '@core/auth/AuthProvider';
import { fmtAgo, fmtDateTime, fmtHours } from '@core/lib/format';
import { Badge, Button, Card, EmptyState, PageHeader, QueryView, Segmented, UnitTag, cx, type Tone } from '@core/ui/primitives';
import { Field, Input, Textarea } from '@core/ui/form';
import { Modal } from '@core/ui/Modal';
import { keys } from './data';

/**
 * Reportes que llegan del formulario público (/reportar).
 * Pendiente → Aceptado (un mecánico lo toma) → Solucionado, o → Orden de trabajo si necesita piezas.
 * Cada paso se registra en el historial de la máquina y del mecánico.
 */
export interface ShopReport {
  id: string; unit_number: string; vehicle_id: string | null; description: string; reporter_name: string | null;
  status: 'pending' | 'accepted' | 'solved' | 'converted'; created_at: string;
  accepted_by: string | null; accepted_at: string | null; solved_by: string | null; solved_at: string | null;
  resolution: string | null; labor_hours: number | null; work_order_id: string | null;
  accepter: { full_name: string } | null; solver: { full_name: string } | null;
  vehicles: { model: { manufacturer: string; model: string } | null } | null;
}

export const REPORT_STATUS: Record<ShopReport['status'], { label: string; tone: Tone }> = {
  pending: { label: 'Pendiente', tone: 'warn' }, accepted: { label: 'Aceptado', tone: 'info' },
  solved: { label: 'Solucionado', tone: 'ok' }, converted: { label: 'Pasó a orden', tone: 'brand' },
};

const rkeys = [...keys.all, 'reports'] as const;

export function useShopReports(scope: 'open' | 'closed') {
  useLiveTable('public_reports', [rkeys]);
  return useData([...rkeys, scope], () => {
    let q = supabase.from('public_reports')
      .select('*, accepter:employees!public_reports_accepted_by_fkey(full_name), solver:employees!public_reports_solved_by_fkey(full_name), vehicles(model:vehicle_models(manufacturer, model))')
      .order('created_at', { ascending: false }).limit(200);
    q = scope === 'open' ? q.in('status', ['pending', 'accepted']) : q.in('status', ['solved', 'converted']);
    return run(q) as Promise<ShopReport[]>;
  });
}

/** Bandeja en el inicio del taller: solo lo que necesita atención */
export function ShopReportsInbox() {
  const q = useShopReports('open');
  const list = q.data ?? [];
  if (!list.length) return null;
  const pending = list.filter((r) => r.status === 'pending').length;
  return (
    <section className="mb-5 rounded-card border border-warn/30 bg-warn-soft/40 p-3 sm:p-4" aria-label="Reportes recibidos">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Inbox className="size-4 text-warn" aria-hidden />Reportes recibidos
          {pending > 0 && <span className="num rounded-full bg-warn px-2 py-0.5 text-xs text-white">{pending} nuevo{pending === 1 ? '' : 's'}</span>}
        </h2>
        <Link to="/taller/reportes" className="rounded-md px-2 py-1 text-[13px] font-medium text-ink-2 hover:bg-panel">Ver todos</Link>
      </div>
      <ul className="grid gap-2 md:grid-cols-2">{list.slice(0, 6).map((r) => <li key={r.id}><ReportCard r={r} compact /></li>)}</ul>
    </section>
  );
}

export function ShopReportsPage() {
  const [scope, setScope] = useState<'open' | 'closed'>('open');
  const q = useShopReports(scope);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader back="/taller" title="Reportes del taller"
        subtitle="Lo que reportan al dejar una unidad. Acéptelo y márquelo solucionado, o páselo a orden si necesita piezas." />
      <div className="mb-4"><Segmented value={scope} onChange={setScope} options={[{ id: 'open', label: 'Por atender' }, { id: 'closed', label: 'Cerrados' }]} /></div>
      <QueryView q={q} empty={<EmptyState icon={Inbox} title={scope === 'open' ? 'No hay reportes por atender' : 'Sin reportes cerrados'} />}>
        {(list) => <ul className="grid gap-3">{list.map((r) => <li key={r.id}><ReportCard r={r} /></li>)}</ul>}
      </QueryView>
    </div>
  );
}

function ReportCard({ r, compact }: { r: ShopReport; compact?: boolean }) {
  const { profile, can, isAdmin } = useAuth();
  const who = useWho();
  const nav = useNavigate();
  const [solving, setSolving] = useState(false);
  const mayAct = can('workorders.create');
  const mine = r.accepted_by === profile?.id;
  const takenByOther = r.status === 'accepted' && !mine && !isAdmin;
  const st = REPORT_STATUS[r.status];

  const accept = useAction(() => rpc('shop_report_accept', { p_id: r.id }), { invalidate: [rkeys], success: 'Reporte aceptado: ahora es suyo' });
  const toOrder = useAction(() => rpc<string>('shop_report_to_work_order', { p_id: r.id }),
    { invalidate: [rkeys, keys.all], success: 'Orden de trabajo creada', onSuccess: (id) => nav(`/taller/${id}`) });

  const accepter = who(r.accepter?.full_name, r.accepted_by);
  const solver = who(r.solver?.full_name, r.solved_by);

  return (
    <Card pad={false} className={cx('h-full overflow-hidden', r.status === 'pending' && 'border-warn/40')}>
      <div className="flex items-start justify-between gap-2 px-4 pt-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {r.vehicle_id ? <Link to={`/flota/${r.vehicle_id}`}><UnitTag>{r.unit_number}</UnitTag></Link> : <UnitTag>{r.unit_number}</UnitTag>}
          {r.vehicles?.model && <span className="truncate text-xs text-muted">{r.vehicles.model.manufacturer} {r.vehicles.model.model}</span>}
        </div>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      <p className={cx('px-4 pt-2 text-[15px] leading-snug', compact && 'line-clamp-3')}>{r.description}</p>
      <p className="px-4 pt-1.5 text-xs text-muted">
        {fmtAgo(r.created_at)}{r.reporter_name && ` · reportó ${r.reporter_name}`}
        {r.status === 'accepted' && (accepter ? ` · aceptado por ${accepter}` : ' · ya lo tomó un mecánico')}
      </p>

      {r.status === 'solved' && (
        <div className="mx-4 mt-3 rounded-md bg-ok-soft px-3 py-2 text-sm">
          <div className="flex items-center gap-1.5 font-medium text-ok"><CheckCircle2 className="size-4" aria-hidden />Solucionado {r.solved_at && fmtDateTime(r.solved_at)}</div>
          <p className="mt-1 text-ink">{r.resolution}</p>
          {(solver || r.labor_hours != null) && <p className="mt-0.5 text-xs text-muted">{[solver, r.labor_hours != null && fmtHours(r.labor_hours)].filter(Boolean).join(' · ')}</p>}
        </div>
      )}
      {r.status === 'converted' && r.work_order_id && (
        <Link to={`/taller/${r.work_order_id}`} className="mx-4 mt-3 flex items-center gap-1.5 rounded-md bg-brand-soft px-3 py-2 text-sm font-medium text-brand hover:underline">
          <ClipboardList className="size-4" aria-hidden />Ver la orden de trabajo
        </Link>
      )}

      {mayAct && (r.status === 'pending' || r.status === 'accepted') && !takenByOther ? (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-line bg-paper/60 px-4 py-3">
          {r.status === 'pending' && <Button icon={Hand} className="flex-1" loading={accept.isPending} onClick={() => accept.mutate()}>Aceptar</Button>}
          <Button variant="primary" icon={CheckCircle2} className="flex-1" onClick={() => setSolving(true)}>Solucionado</Button>
          {!compact && <Button variant="ghost" icon={Wrench} loading={toOrder.isPending} onClick={() => toOrder.mutate()}>Pasar a orden</Button>}
        </div>
      ) : <div className="h-3" />}

      {solving && <SolveModal r={r} onClose={() => setSolving(false)} onOrder={() => { setSolving(false); toOrder.mutate(); }} />}
    </Card>
  );
}

function SolveModal({ r, onClose, onOrder }: { r: ShopReport; onClose: () => void; onOrder: () => void }) {
  const [text, setText] = useState('');
  const [hours, setHours] = useState('');
  const save = useAction(() => rpc('shop_report_solve', { p_id: r.id, p_resolution: text, p_hours: hours === '' ? null : Number(hours) }),
    { invalidate: [rkeys, ['employee_history']], success: 'Marcado como solucionado', onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title={`Solucionado · ${r.unit_number}`}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" icon={CheckCircle2} disabled={text.trim().length < 3} loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button></>}>
      <p className="mb-3 rounded-md bg-sunken px-3 py-2 text-sm text-ink-2">{r.description}</p>
      <div className="space-y-3">
        <Field label="¿Qué se hizo?" required><Textarea rows={4} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Ej. Se cambió la bujía y se limpió el filtro de aire" /></Field>
        <Field label="Horas de trabajo" hint="Opcional"><Input type="number" inputMode="decimal" step="0.25" min="0" max="24" value={hours} onChange={(e) => setHours(e.target.value)} /></Field>
        <p className="text-[13px] text-muted">¿Necesita piezas o más trabajo? <button type="button" className="font-medium text-brand underline" onClick={onOrder}>Pasar a orden de trabajo</button></p>
      </div>
    </Modal>
  );
}
