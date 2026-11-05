import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FileText, Plus, RefreshCw, Archive, ExternalLink, FileWarning } from 'lucide-react';
import { supabase } from '@core/data/supabase';
import { run, useAction, useData } from '@core/data/api';
import { uploadFile } from '@core/data/storage';
import { Can, useAuth } from '@core/auth/AuthProvider';
import { fmtDate } from '@core/lib/format';
import { Badge, Button, EmptyState, KeyValue, PageHeader, QueryView, Section, Segmented, StatCard, UnitTag } from '@core/ui/primitives';
import { Field, FormGrid, Input, Select, Textarea } from '@core/ui/form';
import { EmployeeSelect, VehicleSelect } from '@core/ui/pickers';
import { openStorageFile } from '@core/ui/media';
import { DataTable, type Column } from '@core/ui/DataTable';
import { Modal, useConfirm } from '@core/ui/Modal';

const MODULE = 'documents';
const keys = { all: ['documents'] as const };
const CATEGORIES: Record<string, string> = {
  registration: 'Registro', insurance: 'Seguro', inspection: 'Inspección oficial', warranty: 'Garantía', legal: 'Legal',
  manual: 'Manual', license: 'Licencia', certification: 'Certificación', other: 'Otro',
};
const OWNER: Record<string, string> = { vehicle: 'Vehículo', employee: 'Empleado', company: 'Compañía' };

interface Doc { id: string; owner_type: string; vehicle_id: string | null; employee_id: string | null; category: string; title: string; document_number: string | null; issued_at: string | null; expires_at: string | null; storage_path: string | null; file_name: string | null; notes: string | null; created_at: string; vehicles: { unit_number: string } | null; employees: { full_name: string } | null }

const daysLeft = (d: Doc) => (d.expires_at ? Math.ceil((new Date(d.expires_at + 'T12:00:00').getTime() - Date.now()) / 86_400_000) : null);
function Expiry({ d }: { d: Doc }) {
  const n = daysLeft(d);
  if (n == null) return <span className="text-faint">Sin vencimiento</span>;
  if (n < 0) return <Badge tone="bad">Vencido {fmtDate(d.expires_at)}</Badge>;
  if (n <= 30) return <Badge tone="warn">Vence en {n} d</Badge>;
  return <span className="num text-[13px]">{fmtDate(d.expires_at)}</span>;
}

const useDocs = (f: { vehicleId?: string; employeeId?: string } = {}) => useData([...keys.all, f], () => {
  let q = supabase.from('documents').select('*, vehicles(unit_number), employees!documents_employee_id_fkey(full_name)').is('archived_at', null).order('expires_at', { ascending: true, nullsFirst: false });
  if (f.vehicleId) q = q.eq('vehicle_id', f.vehicleId);
  if (f.employeeId) q = q.eq('employee_id', f.employeeId);
  return run(q) as Promise<Doc[]>;
});

const cols = (withOwner = true): Column<Doc>[] => [
  { key: 'title', header: 'Documento', mobile: 'title', render: (d) => <span className="font-medium">{d.title}</span> },
  { key: 'category', header: 'Categoría', value: (d) => CATEGORIES[d.category] },
  ...(withOwner ? [{ key: 'owner', header: 'Pertenece a', value: (d: Doc) => d.vehicles?.unit_number ?? d.employees?.full_name ?? 'Compañía',
    render: (d: Doc) => d.vehicles ? <UnitTag>{d.vehicles.unit_number}</UnitTag> : d.employees?.full_name ?? 'Compañía' }] : []),
  { key: 'document_number', header: 'Número', mobile: 'hide', render: (d) => <span className="num text-[13px]">{d.document_number ?? '—'}</span> },
  { key: 'expires_at', header: 'Vencimiento', value: (d) => d.expires_at, render: (d) => <Expiry d={d} /> },
];

export function DocumentsPage() {
  const q = useDocs();
  const nav = useNavigate();
  const [filter, setFilter] = useState<'all' | 'attention' | 'vehicle' | 'employee'>('all');
  const [adding, setAdding] = useState(false);
  const rows = (q.data ?? []).filter((d) => filter === 'all' || (filter === 'attention' ? (daysLeft(d) ?? 999) <= 30 : d.owner_type === filter));
  return (
    <>
      <PageHeader title="Documentos" actions={<Can perm="documents.create"><Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Subir documento</Button></Can>} />
      <DataTable rows={rows} loading={q.isLoading} error={q.error} columns={cols()} onRowClick={(d) => nav(`/documentos/${d.id}`)} exportName="Documentos"
        toolbar={<div className="scroll-x"><Segmented value={filter} onChange={setFilter} options={[{ id: 'all', label: 'Todos' }, { id: 'attention', label: 'Por vencer / vencidos' }, { id: 'vehicle', label: 'Vehículos' }, { id: 'employee', label: 'Empleados' }]} /></div>}
        empty={<EmptyState icon={FileText} title="Sin documentos" />} />
      {adding && <DocForm onClose={() => setAdding(false)} />}
    </>
  );
}

function DocForm({ onClose, preset, replaces }: { onClose: () => void; preset?: { vehicleId?: string; employeeId?: string }; replaces?: Doc }) {
  const nav = useNavigate();
  const [v, setV] = useState({
    owner_type: replaces?.owner_type ?? (preset?.vehicleId ? 'vehicle' : preset?.employeeId ? 'employee' : 'vehicle'),
    vehicle_id: replaces?.vehicle_id ?? preset?.vehicleId ?? '', employee_id: replaces?.employee_id ?? preset?.employeeId ?? '',
    category: replaces?.category ?? 'registration', title: replaces?.title ?? '', document_number: '', issued_at: '', expires_at: '', notes: '',
  });
  const [file, setFile] = useState<File | null>(null);
  const save = useAction(async () => {
    if (!v.title.trim()) throw new Error('Escriba el título del documento');
    if (v.owner_type === 'vehicle' && !v.vehicle_id) throw new Error('Seleccione el vehículo');
    if (v.owner_type === 'employee' && !v.employee_id) throw new Error('Seleccione el empleado');
    const up = file ? await uploadFile(MODULE, v.owner_type, file) : null;
    return run(supabase.from('documents').insert({
      owner_type: v.owner_type, vehicle_id: v.owner_type === 'vehicle' ? v.vehicle_id : null, employee_id: v.owner_type === 'employee' ? v.employee_id : null,
      category: v.category, title: v.title.trim(), document_number: v.document_number || null, issued_at: v.issued_at || null, expires_at: v.expires_at || null,
      notes: v.notes || null, storage_path: up?.path ?? null, file_name: up?.name ?? null, mime_type: up?.mime ?? null, replaces_id: replaces?.id ?? null,
    }).select('id').single()) as Promise<{ id: string }>;
  }, { invalidate: [keys.all], success: replaces ? 'Documento renovado (el anterior queda en el historial)' : 'Documento guardado', onSuccess: (d) => { onClose(); if (replaces) nav(`/documentos/${d.id}`); } });
  const f = (k: keyof typeof v) => ({ value: v[k], onChange: (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value }) });
  return (
    <Modal open onClose={onClose} title={replaces ? 'Renovar documento' : 'Subir documento'}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button></>}>
      <div className="space-y-3">
        {!preset && !replaces && <Field label="Pertenece a"><Select {...f('owner_type')} options={Object.entries(OWNER).map(([value, label]) => ({ value, label }))} /></Field>}
        {v.owner_type === 'vehicle' && !preset && !replaces && <Field label="Vehículo"><VehicleSelect value={v.vehicle_id} onChange={(id) => setV({ ...v, vehicle_id: id })} exclude={[]} /></Field>}
        {v.owner_type === 'employee' && !preset && !replaces && <Field label="Empleado"><EmployeeSelect value={v.employee_id} onChange={(id) => setV({ ...v, employee_id: id })} /></Field>}
        <FormGrid>
          <Field label="Categoría"><Select {...f('category')} options={Object.entries(CATEGORIES).map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="Título" required><Input {...f('title')} placeholder="Póliza de seguro 2026" /></Field>
          <Field label="Número"><Input className="h-10 font-mono" {...f('document_number')} /></Field>
          <div />
          <Field label="Fecha de emisión"><Input type="date" {...f('issued_at')} /></Field>
          <Field label="Fecha de vencimiento" hint="Se avisará 30 y 7 días antes"><Input type="date" {...f('expires_at')} /></Field>
        </FormGrid>
        <Field label="Archivo (PDF o foto)"><input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" /></Field>
        <Field label="Observaciones"><Textarea rows={2} {...f('notes')} /></Field>
      </div>
    </Modal>
  );
}

export function DocumentDetail() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const nav = useNavigate();
  const confirm = useConfirm();
  const q = useData([...keys.all, id], () => run(supabase.from('documents').select('*, vehicles(unit_number), employees!documents_employee_id_fkey(full_name)').eq('id', id).single()) as Promise<Doc & { archived_at: string | null; replaces_id: string | null }>);
  const [renew, setRenew] = useState(false);
  const archive = useAction(() => run(supabase.from('documents').update({ archived_at: new Date().toISOString() }).eq('id', id)), { invalidate: [keys.all], success: 'Documento archivado', onSuccess: () => nav('/documentos') });
  return (
    <QueryView q={q}>
      {(d) => (
        <div className="mx-auto max-w-3xl">
          <PageHeader back="/documentos" eyebrow={CATEGORIES[d.category]} title={d.title} subtitle={d.archived_at ? <Badge>Archivado</Badge> : <Expiry d={d} />}
            actions={<>
              {d.storage_path && <Button variant="primary" icon={ExternalLink} onClick={() => openStorageFile(d.storage_path!)}>Abrir archivo</Button>}
              {can('documents.create') && !d.archived_at && <Button icon={RefreshCw} onClick={() => setRenew(true)}>Renovar</Button>}
              {can('documents.edit') && !d.archived_at && <Button variant="ghost" icon={Archive} onClick={async () => { if (await confirm({ title: 'Archivar documento', body: 'Dejará de mostrarse y de generar recordatorios. No se borra.', confirm: 'Archivar' })) archive.mutate(); }}>Archivar</Button>}
            </>} />
          <Section title="Datos">
            <KeyValue items={[['Pertenece a', d.vehicles ? <UnitTag>{d.vehicles.unit_number}</UnitTag> : d.employees?.full_name ?? 'Compañía'], ['Número', d.document_number],
              ['Emisión', fmtDate(d.issued_at)], ['Vencimiento', fmtDate(d.expires_at)], ['Archivo', d.file_name], ['Subido', fmtDate(d.created_at)]]} />
            {d.notes && <p className="mt-3 border-t border-line pt-3 text-sm">{d.notes}</p>}
          </Section>
          {renew && <DocForm replaces={d} onClose={() => setRenew(false)} />}
        </div>
      )}
    </QueryView>
  );
}

function OwnerTab({ vehicleId, employeeId }: { vehicleId?: string; employeeId?: string }) {
  const q = useDocs({ vehicleId, employeeId });
  const nav = useNavigate();
  const [adding, setAdding] = useState(false);
  return <>
    <div className="mb-3 flex justify-end"><Can perm="documents.create"><Button icon={Plus} onClick={() => setAdding(true)}>Subir documento</Button></Can></div>
    <DataTable rows={q.data} loading={q.isLoading} error={q.error} columns={cols(false)} search={false} onRowClick={(d) => nav(`/documentos/${d.id}`)} empty={<EmptyState icon={FileText} title="Sin documentos" />} />
    {adding && <DocForm preset={{ vehicleId, employeeId }} onClose={() => setAdding(false)} />}
  </>;
}
export const VehicleDocsTab = ({ vehicleId }: { vehicleId: string }) => <OwnerTab vehicleId={vehicleId} />;
export const EmployeeDocsTab = ({ employeeId }: { employeeId: string }) => <OwnerTab employeeId={employeeId} />;

export function ExpiringKpi() {
  const q = useData(['dashboard', 'docs'], () => run(supabase.from('documents_expiring').select('id, expiry_status').neq('expiry_status', 'valid')) as Promise<any[]>);
  return <StatCard label="Documentos por vencer / vencidos" value={q.data?.length ?? '—'} tone={q.data?.length ? 'warn' : 'ok'} icon={FileWarning} to="/documentos" />;
}
