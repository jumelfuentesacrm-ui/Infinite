import { useState } from 'react';
import { savedMsg, useSaveOrRequest } from '@core/data/changes';
import { Plus } from 'lucide-react';
import { z } from 'zod';
import { supabase } from '@core/data/supabase';
import { run, useAction } from '@core/data/api';
import { fleetKeys, useModels, VEHICLE_TYPES, type VehicleModel } from '@core/data/shared';
import { Can } from '@core/auth/AuthProvider';
import { Button, PageHeader, Badge } from '@core/ui/primitives';
import { DataTable } from '@core/ui/DataTable';
import { Modal } from '@core/ui/Modal';
import { Checkbox, Field, FormGrid, Input, Select, Textarea, useForm } from '@core/ui/form';

const schema = z.object({
  manufacturer: z.string({ required_error: 'Requerido' }).trim().min(1, 'Requerido'),
  model: z.string({ required_error: 'Requerido' }).trim().min(1, 'Requerido'),
  year: z.coerce.number().int().min(1950).max(2100).nullable(),
  vehicle_type: z.string(),
  uses_engine_hours: z.boolean(),
  uses_mileage: z.boolean(),
  notes: z.string().nullable(),
});

export default function ModelsPage() {
  const q = useModels();
  const [editing, setEditing] = useState<VehicleModel | 'new' | null>(null);
  return (
    <>
      <PageHeader back="/flota" title="Modelos de vehículo" subtitle="Cada modelo tiene sus propias plantillas de inspección, intervalos de mantenimiento y catálogo de piezas."
        actions={<Can perm="fleet.manage"><Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>Nuevo modelo</Button></Can>} />
      <DataTable rows={q.data} loading={q.isLoading} error={q.error} onRowClick={(m) => setEditing(m)} columns={[
        { key: 'manufacturer', header: 'Marca', mobile: 'title', value: (m) => `${m.manufacturer} ${m.model}`, render: (m) => <span className="font-medium">{m.manufacturer} {m.model}</span> },
        { key: 'year', header: 'Año', render: (m) => <span className="num">{m.year ?? '—'}</span> },
        { key: 'vehicle_type', header: 'Tipo', value: (m) => VEHICLE_TYPES[m.vehicle_type] },
        { key: 'meters', header: 'Indicador', value: (m) => [m.uses_engine_hours && 'Horas', m.uses_mileage && 'Millaje'].filter(Boolean).join(' + '),
          render: (m) => <span className="flex gap-1">{m.uses_engine_hours && <Badge tone="info" dot={false}>Horas</Badge>}{m.uses_mileage && <Badge dot={false}>Millaje</Badge>}</span> },
      ]} />
      {editing && <ModelForm model={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ModelForm({ model, onClose }: { model?: VehicleModel; onClose: () => void }) {
  const f = useForm({
    manufacturer: model?.manufacturer ?? '', model: model?.model ?? '', year: model?.year?.toString() ?? '',
    vehicle_type: model?.vehicle_type ?? 'utv', uses_engine_hours: model?.uses_engine_hours ?? true,
    uses_mileage: model?.uses_mileage ?? false, notes: model?.notes ?? '',
  }, schema);
  const { save: saveOrRequest } = useSaveOrRequest();
  const save = useAction(async () => {
    const v = f.validate(); if (!v) throw new Error('Revise los campos');
    return model ? saveOrRequest('vehicle_models', model.id, v, model as unknown as Record<string, unknown>) : run(supabase.from('vehicle_models').insert(v));
  }, { invalidate: [fleetKeys.models, fleetKeys.vehicles], success: savedMsg('Modelo guardado'), onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title={model ? 'Editar modelo' : 'Nuevo modelo'}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button></>}>
      <div className="space-y-4">
        <FormGrid cols={3}>
          <Field label="Marca" required error={f.errors.manufacturer}><Input {...f.bind('manufacturer')} /></Field>
          <Field label="Modelo" required error={f.errors.model}><Input {...f.bind('model')} /></Field>
          <Field label="Año" error={f.errors.year}><Input type="number" {...f.bind('year')} /></Field>
        </FormGrid>
        <Field label="Tipo"><Select {...f.bind('vehicle_type')} options={Object.entries(VEHICLE_TYPES).map(([value, label]) => ({ value, label }))} /></Field>
        <div className="flex flex-wrap gap-5">
          <Checkbox label="Usa horas de motor" checked={f.values.uses_engine_hours} onChange={(e) => f.set('uses_engine_hours', e.target.checked)} />
          <Checkbox label="Usa millaje" checked={f.values.uses_mileage} onChange={(e) => f.set('uses_mileage', e.target.checked)} />
        </div>
        <Field label="Notas"><Textarea {...f.bind('notes')} /></Field>
      </div>
    </Modal>
  );
}
