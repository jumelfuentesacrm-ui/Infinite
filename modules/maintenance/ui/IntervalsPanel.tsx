import { useState } from 'react';
import { Plus } from 'lucide-react';
import { supabase } from '@core/data/supabase';
import { run, useAction, useData } from '@core/data/api';
import { useModels, modelLabel } from '@core/data/shared';
import { useAuth } from '@core/auth/AuthProvider';
import { Button, Section, EmptyState } from '@core/ui/primitives';
import { Checkbox, Field, FormGrid, Input, Select } from '@core/ui/form';
import { DataTable } from '@core/ui/DataTable';
import { Modal } from '@core/ui/Modal';
import { fmtNum } from '@core/lib/format';
import { keys, useTypes } from './data';

interface Interval { id?: string; model_id: string; maintenance_type_id: string; interval_hours: number | null; interval_days: number | null; interval_miles: number | null;
  warn_hours: number | null; warn_days: number | null; warn_miles: number | null; source_reference: string | null; notes: string | null; active: boolean; maintenance_types?: { name: string } }

/** Configuración › Intervalos por modelo (según manual del fabricante) */
export default function IntervalsPanel() {
  const { can } = useAuth();
  const models = useModels();
  const types = useTypes();
  const [model, setModel] = useState('');
  const sel = model || models.data?.[0]?.id || '';
  const q = useData([...keys.all, 'intervals', sel], () => run(supabase.from('maintenance_intervals').select('*, maintenance_types(name)').eq('model_id', sel).order('created_at')) as Promise<Interval[]>, { enabled: !!sel });
  const [edit, setEdit] = useState<Interval | null>(null);
  const [newType, setNewType] = useState(false);
  const blank = (): Interval => ({ model_id: sel, maintenance_type_id: '', interval_hours: null, interval_days: null, interval_miles: null, warn_hours: null, warn_days: null, warn_miles: null, source_reference: '', notes: '', active: true });
  return (
    <Section title="Intervalos de mantenimiento por modelo" description="Ingrese los intervalos del manual oficial de cada modelo e indique la fuente (manual y página). No se precargan valores de fábrica."
      actions={can('maintenance.manage') && <>
        <Button size="sm" variant="ghost" onClick={() => setNewType(true)}>Tipos</Button>
        <Button size="sm" icon={Plus} disabled={!sel} onClick={() => setEdit(blank())}>Intervalo</Button></>}>
      <div className="mb-3 max-w-sm"><Select value={sel} onChange={(e) => setModel(e.target.value)} options={(models.data ?? []).map((m) => ({ value: m.id, label: modelLabel(m) }))} /></div>
      <DataTable rows={q.data} loading={q.isLoading} error={q.error} search={false} onRowClick={can('maintenance.manage') ? setEdit : undefined}
        empty={<EmptyState title="Sin intervalos para este modelo" />} columns={[
          { key: 'type', header: 'Mantenimiento', mobile: 'title', value: (i) => i.maintenance_types?.name },
          { key: 'interval_hours', header: 'Cada (horas)', align: 'right', render: (i) => i.interval_hours ? <span className="num">{fmtNum(i.interval_hours)} h</span> : '—' },
          { key: 'interval_days', header: 'Cada (días)', align: 'right', render: (i) => i.interval_days ? <span className="num">{i.interval_days} d</span> : '—' },
          { key: 'interval_miles', header: 'Cada (millas)', align: 'right', render: (i) => i.interval_miles ? <span className="num">{fmtNum(i.interval_miles)}</span> : '—' },
          { key: 'source_reference', header: 'Fuente', mobile: 'hide', render: (i) => <span className="text-xs text-muted">{i.source_reference || '—'}</span> },
          { key: 'active', header: '', render: (i) => (i.active ? '' : 'Inactivo') },
        ]} />
      {edit && <IntervalForm interval={edit} types={types.data ?? []} onClose={() => setEdit(null)} />}
      {newType && <TypesModal onClose={() => setNewType(false)} />}
    </Section>
  );
}

function IntervalForm({ interval, types, onClose }: { interval: Interval; types: { id: string; name: string }[]; onClose: () => void }) {
  const [v, setV] = useState(interval);
  const num = (k: keyof Interval) => ({ value: (v[k] as number | null) ?? '', onChange: (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value === '' ? null : Number(e.target.value) }) });
  const save = useAction(() => {
    if (!v.maintenance_type_id) throw new Error('Seleccione el tipo');
    if (!v.interval_hours && !v.interval_days && !v.interval_miles) throw new Error('Indique al menos un intervalo (horas, días o millas)');
    const { maintenance_types: _t, id, ...data } = v;
    return id ? run(supabase.from('maintenance_intervals').update(data).eq('id', id)) : run(supabase.from('maintenance_intervals').insert(data));
  }, { invalidate: [keys.all, ['vehicles']], success: 'Intervalo guardado', onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title={v.id ? 'Editar intervalo' : 'Nuevo intervalo'}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button></>}>
      <div className="space-y-4">
        <Field label="Tipo de mantenimiento"><Select value={v.maintenance_type_id} disabled={!!v.id} onChange={(e) => setV({ ...v, maintenance_type_id: e.target.value })} placeholder="Seleccione" options={types.map((t) => ({ value: t.id, label: t.name }))} /></Field>
        <FormGrid cols={3}>
          <Field label="Cada (horas de motor)"><Input type="number" step="0.1" {...num('interval_hours')} /></Field>
          <Field label="Cada (días)"><Input type="number" {...num('interval_days')} /></Field>
          <Field label="Cada (millas)"><Input type="number" {...num('interval_miles')} /></Field>
          <Field label="Avisar antes (horas)"><Input type="number" {...num('warn_hours')} placeholder="10" /></Field>
          <Field label="Avisar antes (días)"><Input type="number" {...num('warn_days')} placeholder="14" /></Field>
          <Field label="Avisar antes (millas)"><Input type="number" {...num('warn_miles')} placeholder="100" /></Field>
        </FormGrid>
        <Field label="Fuente" hint="Ej. Manual de servicio Can-Am Outlander 2024, sección 3, pág. 41"><Input value={v.source_reference ?? ''} onChange={(e) => setV({ ...v, source_reference: e.target.value })} /></Field>
        <Field label="Notas"><Input value={v.notes ?? ''} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
        <Checkbox label="Activo" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />
      </div>
    </Modal>
  );
}

function TypesModal({ onClose }: { onClose: () => void }) {
  const types = useTypes();
  const [name, setName] = useState('');
  const add = useAction(() => run(supabase.from('maintenance_types').insert({ name: name.trim() })), { invalidate: [keys.all], success: 'Tipo añadido', onSuccess: () => setName('') });
  const archive = useAction((id: string) => run(supabase.from('maintenance_types').update({ archived_at: new Date().toISOString() }).eq('id', id)), { invalidate: [keys.all] });
  return (
    <Modal open onClose={onClose} title="Tipos de mantenimiento" size="sm" footer={<Button onClick={onClose}>Cerrar</Button>}>
      <ul className="mb-3 divide-y divide-line">{types.data?.map((t) => (
        <li key={t.id} className="flex items-center justify-between py-1.5 text-sm">{t.name}<button className="text-xs text-muted hover:text-bad" onClick={() => archive.mutate(t.id)}>Retirar</button></li>
      ))}</ul>
      <div className="flex gap-2"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nuevo tipo" /><Button disabled={!name.trim()} onClick={() => add.mutate()}>Añadir</Button></div>
    </Modal>
  );
}
