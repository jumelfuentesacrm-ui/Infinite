import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, GitPullRequest, X } from 'lucide-react';
import { supabase } from '@core/data/supabase';
import { rpc, run, useAction, useData } from '@core/data/api';
import { useLiveTable } from '@core/data/realtime';
import { fmtAgo, fmtDateTime } from '@core/lib/format';
import { Badge, Button, Card, EmptyState, PageHeader, QueryView, Segmented, type Tone } from '@core/ui/primitives';
import { Textarea } from '@core/ui/form';
import { useAuth } from '@core/auth/AuthProvider';

interface ChangeRequest {
  id: string; table_name: string; record_id: string; record_label: string | null; link: string | null;
  changes: Record<string, unknown>; previous: Record<string, unknown>; reason: string | null; status: string; requested_by: string;
  requested_at: string; decided_at: string | null; decision_notes: string | null;
  requester: { full_name: string; employee_code: string } | null; decider: { full_name: string } | null;
}

const TABLES: Record<string, string> = {
  'public.vehicles': 'Vehículo', 'public.vehicle_models': 'Modelo', 'public.employees': 'Empleado',
  'public.inventory_items': 'Pieza', 'public.suppliers': 'Proveedor', 'public.work_orders': 'Orden de trabajo',
  'public.maintenance_records': 'Mantenimiento', 'public.maintenance_intervals': 'Intervalo', 'public.maintenance_types': 'Tipo de mantenimiento',
  'public.inspection_templates': 'Plantilla', 'public.inspection_template_items': 'Punto de inspección', 'public.documents': 'Documento',
  'public.catalog_parts': 'Pieza OEM', 'public.manuals': 'Manual',
};

const FIELDS: Record<string, string> = {
  unit_number: 'Número de unidad', model_id: 'Modelo', vin: 'VIN / serie', plate: 'Tablilla', acquired_at: 'Fecha de adquisición',
  warranty_expires_at: 'Garantía vence', warranty_notes: 'Notas de garantía', current_location: 'Ubicación', notes: 'Notas',
  photo_path: 'Fotografía', archived_at: 'Archivado', status: 'Estado', full_name: 'Nombre', phone: 'Teléfono', job_title: 'Puesto',
  hired_at: 'Fecha de ingreso', sku: 'Código interno', name: 'Nombre', part_number: 'Nº de pieza', manufacturer: 'Fabricante',
  category: 'Categoría', description: 'Descripción', unit: 'Unidad', min_quantity: 'Cantidad mínima', location: 'Ubicación',
  supplier_id: 'Proveedor', contact: 'Contacto', email: 'Correo', address: 'Dirección', priority: 'Prioridad', diagnosis: 'Diagnóstico',
  model: 'Modelo', year: 'Año', vehicle_type: 'Tipo', uses_engine_hours: 'Usa horas', uses_mileage: 'Usa millaje',
};

const STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'Pendiente', tone: 'warn' }, approved: { label: 'Aprobada', tone: 'ok' },
  rejected: { label: 'Rechazada', tone: 'bad' }, cancelled: { label: 'Cancelada', tone: 'idle' },
};

const show = (v: unknown) => {
  if (v === null || v === undefined || v === '') return <span className="text-faint">vacío</span>;
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return fmtDateTime(v);
  if (typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v)) return <span className="num text-muted">(referencia)</span>;
  return String(v);
};

/** Solicitudes de cambio: el admin aprueba (se aplica) o rechaza. */
export default function RequestsPage() {
  const [scope, setScope] = useState<'pending' | 'done'>('pending');
  const q = useData(['change_requests', scope], () => {
    let x = supabase.from('change_requests')
      .select('*, requester:employees!change_requests_requested_by_fkey(full_name, employee_code), decider:employees!change_requests_decided_by_fkey(full_name)')
      .order('requested_at', { ascending: false }).limit(200);
    x = scope === 'pending' ? x.eq('status', 'pending') : x.neq('status', 'pending');
    return run(x) as Promise<ChangeRequest[]>;
  });
  useLiveTable('change_requests', [['change_requests']]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Solicitudes de cambio"
        subtitle="Lo ya guardado no se modifica directo: aquí llegan los cambios que piden los demás. Los de vehículos también los aprueba el supervisor." />
      <div className="mb-4">
        <Segmented value={scope} onChange={setScope} options={[{ id: 'pending', label: 'Pendientes' }, { id: 'done', label: 'Historial' }]} />
      </div>
      <QueryView q={q} empty={<EmptyState icon={GitPullRequest} title={scope === 'pending' ? 'No hay solicitudes pendientes' : 'Sin historial'}>
        Cuando un empleado edite algo ya guardado, la solicitud aparece aquí.</EmptyState>}>
        {(list) => <ul className="space-y-3">{list.map((r) => <li key={r.id}><RequestCard r={r} /></li>)}</ul>}
      </QueryView>
    </div>
  );
}

function RequestCard({ r }: { r: ChangeRequest }) {
  const [notes, setNotes] = useState('');
  const decide = useAction((ok: boolean) => rpc('decide_change_request', { p_id: r.id, p_approve: ok, p_notes: notes || null }),
    { invalidate: [['change_requests'], ['vehicles'], ['employees'], ['inventory'], ['work_orders'], ['vehicle_models']],
      success: (_o) => 'Solicitud atendida' });
  const { isAdmin, profile } = useAuth();
  const keys = Object.keys(r.changes);
  const pending = r.status === 'pending';
  // El supervisor decide solicitudes de vehículos, pero no las suyas
  const canDecide = isAdmin || (r.table_name === 'public.vehicles' && r.requested_by !== profile?.id);

  return (
    <Card pad={false} className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-[0.06em] text-muted">{TABLES[r.table_name] ?? r.table_name}</div>
          <div className="mt-0.5 text-[15px] font-semibold">
            {r.link ? <Link to={r.link} className="hover:underline">{r.record_label ?? 'Registro'}</Link> : r.record_label ?? 'Registro'}
          </div>
          <div className="mt-0.5 text-[13px] text-muted">
            {r.requester?.full_name ?? '—'} <span className="num">({r.requester?.employee_code})</span> · {fmtAgo(r.requested_at)}
          </div>
        </div>
        <Badge tone={STATUS[r.status]?.tone}>{STATUS[r.status]?.label}</Badge>
      </div>

      <div className="divide-y divide-line">
        {keys.map((k) => (
          <div key={k} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[160px_1fr] sm:gap-4">
            <div className="text-[13px] font-medium text-ink-2">{FIELDS[k] ?? k}</div>
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
              <span className="max-w-full break-words rounded bg-bad-soft/60 px-1.5 py-0.5 text-ink-2 line-through decoration-bad/40">{show(r.previous[k])}</span>
              <ArrowRight className="size-3.5 shrink-0 text-faint" aria-hidden />
              <span className="max-w-full break-words rounded bg-ok-soft px-1.5 py-0.5 font-medium">{show(r.changes[k])}</span>
            </div>
          </div>
        ))}
      </div>

      {r.reason && <p className="border-t border-line px-4 py-2.5 text-sm"><span className="text-muted">Motivo: </span>{r.reason}</p>}

      {pending && !canDecide ? (
        <p className="border-t border-line px-4 py-2.5 text-[13px] text-muted">Esperando aprobación del administrador.</p>
      ) : pending ? (
        <div className="flex flex-col gap-2 border-t border-line bg-paper/60 px-4 py-3 sm:flex-row sm:items-end">
          <Textarea rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Nota para el empleado (opcional)" className="sm:flex-1" aria-label="Nota" />
          <div className="flex gap-2">
            <Button icon={X} className="flex-1 sm:flex-none" loading={decide.isPending && decide.variables === false} onClick={() => decide.mutate(false)}>Rechazar</Button>
            <Button variant="primary" icon={Check} className="flex-1 sm:flex-none" loading={decide.isPending && decide.variables === true} onClick={() => decide.mutate(true)}>Aprobar y aplicar</Button>
          </div>
        </div>
      ) : (
        <p className="border-t border-line px-4 py-2.5 text-[13px] text-muted">
          {STATUS[r.status]?.label} {r.decided_at && fmtAgo(r.decided_at)}{r.decider && ` por ${r.decider.full_name}`}{r.decision_notes && ` — ${r.decision_notes}`}
        </p>
      )}
    </Card>
  );
}
