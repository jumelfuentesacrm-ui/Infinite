import { useState } from 'react';
import { Plus, Archive } from 'lucide-react';
import { supabase } from '@core/data/supabase';
import { run, useAction, useData } from '@core/data/api';
import { useModels, modelLabel, VEHICLE_TYPES } from '@core/data/shared';
import { useAuth } from '@core/auth/AuthProvider';
import { Badge, Button, Section, QueryView, cx } from '@core/ui/primitives';
import { Checkbox, Field, FormGrid, Input, Select } from '@core/ui/form';
import { Modal } from '@core/ui/Modal';
import { useTemplateItems, type Template, type TemplateItem } from './data';

/** Configuración › Plantillas de inspección (por modelo, por tipo o predeterminada) */
export default function TemplatesPanel() {
  const { can } = useAuth();
  const edit = can('inspections.manage');
  const models = useModels();
  const q = useData(['inspection_templates'], () => run(supabase.from('inspection_templates').select('*').order('is_default', { ascending: false }).order('name')) as Promise<Template[]>);
  const [sel, setSel] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const current = q.data?.find((t) => t.id === (sel ?? q.data?.[0]?.id));

  const scope = (t: Template) => t.model_id ? modelLabel(models.data?.find((m) => m.id === t.model_id)) : t.vehicle_type ? `Tipo ${VEHICLE_TYPES[t.vehicle_type]}` : 'Todos los vehículos';
  return (
    <div className="grid gap-4 md:grid-cols-[280px_1fr]">
      <Section title="Plantillas" actions={edit && <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>Nueva</Button>}>
        <QueryView q={q}>
          {(list) => (
            <ul className="-mx-2 space-y-0.5">
              {list.map((t) => (
                <li key={t.id}>
                  <button onClick={() => setSel(t.id)} className={cx('w-full rounded-md px-2 py-2 text-left', current?.id === t.id ? 'bg-sunken' : 'hover:bg-paper')}>
                    <div className="flex items-center gap-2 text-sm font-medium">{t.name}{t.is_default && <Badge tone="brand" dot={false}>Predeterminada</Badge>}{!t.active && <Badge dot={false}>Inactiva</Badge>}</div>
                    <div className="text-xs text-muted">{scope(t)}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </QueryView>
      </Section>
      {current && <TemplateItems template={current} editable={edit} />}
      {creating && <NewTemplate onClose={() => setCreating(false)} onCreated={setSel} />}
    </div>
  );
}

function TemplateItems({ template, editable }: { template: Template; editable: boolean }) {
  const q = useTemplateItems(template.id);
  const [item, setItem] = useState<Partial<TemplateItem> | null>(null);
  const archive = useAction((id: string) => run(supabase.from('inspection_template_items').update({ archived_at: new Date().toISOString() }).eq('id', id)),
    { invalidate: [['inspection_items', template.id]], success: 'Punto retirado (el historial no cambia)' });
  const toggleActive = useAction(() => run(supabase.from('inspection_templates').update({ active: !template.active }).eq('id', template.id)), { invalidate: [['inspection_templates']] });
  return (
    <Section title={template.name} description="Las inspecciones ya realizadas guardan su propia copia: editar la plantilla no altera el historial."
      actions={editable && <>
        <Button size="sm" variant="ghost" onClick={() => toggleActive.mutate()}>{template.active ? 'Desactivar' : 'Activar'}</Button>
        <Button size="sm" icon={Plus} onClick={() => setItem({ template_id: template.id, position: (q.data?.length ?? 0) + 1, is_critical: false, photo_required_on_fail: false })}>Punto</Button>
      </>}>
      <QueryView q={q}>
        {(items) => (
          <ul className="-my-1 divide-y divide-line">
            {items.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 py-2">
                <button className="min-w-0 text-left" disabled={!editable} onClick={() => setItem(i)}>
                  <div className="text-sm font-medium"><span className="num mr-2 text-faint">{i.position}</span>{i.label}
                    {i.is_critical && <Badge tone="bad" dot={false} className="ml-2">Crítico</Badge>}
                    {i.photo_required_on_fail && <Badge tone="info" dot={false} className="ml-1">Foto</Badge>}</div>
                  <div className="text-xs text-muted">{i.category}</div>
                </button>
                {editable && <Button size="sm" variant="ghost" icon={Archive} onClick={() => archive.mutate(i.id)} aria-label="Retirar" />}
              </li>
            ))}
          </ul>
        )}
      </QueryView>
      {item && <ItemForm item={item} onClose={() => setItem(null)} />}
    </Section>
  );
}

function ItemForm({ item, onClose }: { item: Partial<TemplateItem>; onClose: () => void }) {
  const [v, setV] = useState(item);
  const save = useAction(() => {
    const data = { template_id: v.template_id, position: Number(v.position) || 0, category: v.category || null, label: v.label?.trim(),
      help_text: v.help_text || null, is_critical: !!v.is_critical, photo_required_on_fail: !!v.photo_required_on_fail };
    if (!data.label) throw new Error('Escriba el punto a inspeccionar');
    return v.id ? run(supabase.from('inspection_template_items').update(data).eq('id', v.id)) : run(supabase.from('inspection_template_items').insert(data));
  }, { invalidate: [['inspection_items', item.template_id]], success: 'Guardado', onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title={v.id ? 'Editar punto' : 'Nuevo punto'} size="sm"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button></>}>
      <div className="space-y-3">
        <Field label="Punto a inspeccionar" required><Input value={v.label ?? ''} onChange={(e) => setV({ ...v, label: e.target.value })} /></Field>
        <FormGrid>
          <Field label="Categoría"><Input value={v.category ?? ''} onChange={(e) => setV({ ...v, category: e.target.value })} placeholder="Seguridad" /></Field>
          <Field label="Orden"><Input type="number" value={v.position ?? ''} onChange={(e) => setV({ ...v, position: Number(e.target.value) })} /></Field>
        </FormGrid>
        <Field label="Ayuda para el operador"><Input value={v.help_text ?? ''} onChange={(e) => setV({ ...v, help_text: e.target.value })} /></Field>
        <Checkbox label="Crítico: si no es conforme, el vehículo queda NO APTO" checked={!!v.is_critical} onChange={(e) => setV({ ...v, is_critical: e.target.checked })} />
        <Checkbox label="Exigir foto cuando no es conforme" checked={!!v.photo_required_on_fail} onChange={(e) => setV({ ...v, photo_required_on_fail: e.target.checked })} />
      </div>
    </Modal>
  );
}

function NewTemplate({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'model' | 'type'>('model');
  const [model, setModel] = useState('');
  const [type, setType] = useState('utv');
  const [copy, setCopy] = useState(true);
  const models = useModels();
  const save = useAction(async () => {
    if (!name.trim()) throw new Error('Escriba un nombre');
    const t = await run(supabase.from('inspection_templates').insert({ name, model_id: scope === 'model' ? model || null : null, vehicle_type: scope === 'type' ? type : null }).select().single()) as Template;
    if (copy) {
      const def = await run(supabase.from('inspection_templates').select('id').eq('is_default', true).limit(1)) as { id: string }[];
      if (def[0]) {
        const items = await run(supabase.from('inspection_template_items').select('*').eq('template_id', def[0].id).is('archived_at', null)) as TemplateItem[];
        if (items.length) await run(supabase.from('inspection_template_items').insert(items.map(({ id: _id, archived_at: _a, ...i }) => ({ ...i, template_id: t.id }))));
      }
    }
    return t;
  }, { invalidate: [['inspection_templates']], success: 'Plantilla creada', onSuccess: (t) => { onCreated(t.id); onClose(); } });
  return (
    <Modal open onClose={onClose} title="Nueva plantilla" size="sm"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Crear</Button></>}>
      <div className="space-y-3">
        <Field label="Nombre"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Inspección Can-Am Outlander" /></Field>
        <Field label="Aplica a"><Select value={scope} onChange={(e) => setScope(e.target.value as 'model' | 'type')} options={[{ value: 'model', label: 'Un modelo' }, { value: 'type', label: 'Un tipo de vehículo' }]} /></Field>
        {scope === 'model' ? <Field label="Modelo"><Select value={model} onChange={(e) => setModel(e.target.value)} placeholder="Seleccione" options={(models.data ?? []).map((m) => ({ value: m.id, label: modelLabel(m) }))} /></Field>
          : <Field label="Tipo"><Select value={type} onChange={(e) => setType(e.target.value)} options={Object.entries(VEHICLE_TYPES).map(([value, label]) => ({ value, label }))} /></Field>}
        <Checkbox label="Copiar los puntos de la plantilla predeterminada" checked={copy} onChange={(e) => setCopy(e.target.checked)} />
      </div>
    </Modal>
  );
}
