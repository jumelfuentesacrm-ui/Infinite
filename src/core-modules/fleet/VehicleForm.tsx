import { useState } from 'react';
import { z } from 'zod';
import { supabase } from '@core/data/supabase';
import { run, useAction } from '@core/data/api';
import { savedMsg, useSaveOrRequest } from '@core/data/changes';
import { uploadFile } from '@core/data/storage';
import { fleetKeys, type Vehicle } from '@core/data/shared';
import { Modal } from '@core/ui/Modal';
import { Button } from '@core/ui/primitives';
import { Field, FormGrid, Input, Textarea, useForm } from '@core/ui/form';
import { ModelSelect } from '@core/ui/pickers';
import { FilePicker } from '@core/ui/media';

const schema = z.object({
  unit_number: z.string({ required_error: 'Requerido' }).trim().min(1, 'Requerido').max(30),
  model_id: z.string({ required_error: 'Seleccione el modelo' }).uuid('Seleccione el modelo'),
  vin: z.string().trim().max(40).nullable(),
  plate: z.string().trim().max(20).nullable(),
  acquired_at: z.string().nullable(),
  engine_hours: z.coerce.number({ invalid_type_error: 'Número' }).min(0).nullable(),
  mileage: z.coerce.number().min(0).nullable(),
  warranty_expires_at: z.string().nullable(),
  warranty_notes: z.string().nullable(),
  current_location: z.string().nullable(),
  notes: z.string().nullable(),
});

export function VehicleForm({ open, onClose, vehicle }: { open: boolean; onClose: () => void; vehicle?: Vehicle }) {
  const f = useForm({
    unit_number: vehicle?.unit_number ?? '', model_id: vehicle?.model_id ?? '', vin: vehicle?.vin ?? '', plate: vehicle?.plate ?? '',
    acquired_at: vehicle?.acquired_at ?? '', engine_hours: vehicle?.engine_hours?.toString() ?? '0', mileage: vehicle?.mileage?.toString() ?? '',
    warranty_expires_at: vehicle?.warranty_expires_at ?? '', warranty_notes: vehicle?.warranty_notes ?? '',
    current_location: vehicle?.current_location ?? '', notes: vehicle?.notes ?? '',
  }, schema);
  const [photo, setPhoto] = useState<File[]>([]);
  const { save: saveOrRequest } = useSaveOrRequest();

  const save = useAction(async () => {
    const v = f.validate();
    if (!v) throw new Error('Revise los campos marcados');
    const data: Record<string, unknown> = { ...v };
    if (photo[0]) data.photo_path = (await uploadFile('fleet', 'vehicles', photo[0])).path;
    if (vehicle) {
      // Horas/millaje no se editan aquí (solo avanzan por lecturas); evita retrocesos
      delete data.engine_hours; delete data.mileage;
      return saveOrRequest('vehicles', vehicle.id, data, vehicle as unknown as Record<string, unknown>);
    }
    return run(supabase.from('vehicles').insert({ ...data, engine_hours: v.engine_hours ?? 0 }).select().single());
  }, { invalidate: [fleetKeys.vehicles], success: vehicle ? savedMsg('Vehículo actualizado') : 'Vehículo añadido', onSuccess: onClose });

  return (
    <Modal open={open} onClose={onClose} title={vehicle ? `Editar ${vehicle.unit_number}` : 'Añadir vehículo'} size="lg"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button></>}>
      <div className="space-y-4">
        <FormGrid cols={3}>
          <Field label="Número de unidad" required error={f.errors.unit_number}><Input {...f.bind('unit_number')} className="h-10 font-mono uppercase" placeholder="UTV-01" /></Field>
          <Field label="Modelo" required error={f.errors.model_id} className="sm:col-span-2"><ModelSelect value={f.values.model_id} onChange={(v) => f.set('model_id', v)} /></Field>
          <Field label="VIN / número de serie" error={f.errors.vin}><Input {...f.bind('vin')} className="h-10 font-mono" /></Field>
          <Field label="Tablilla"><Input {...f.bind('plate')} className="h-10 font-mono" /></Field>
          <Field label="Fecha de adquisición"><Input type="date" {...f.bind('acquired_at')} /></Field>
          {!vehicle && <>
            <Field label="Horas de motor actuales" error={f.errors.engine_hours}><Input type="number" step="0.1" min="0" inputMode="decimal" {...f.bind('engine_hours')} /></Field>
            <Field label="Millaje actual" hint="Si aplica"><Input type="number" step="0.1" min="0" inputMode="decimal" {...f.bind('mileage')} /></Field>
          </>}
          <Field label="Garantía vence"><Input type="date" {...f.bind('warranty_expires_at')} /></Field>
          <Field label="Ubicación actual" className={vehicle ? 'sm:col-span-2' : ''}><Input {...f.bind('current_location')} placeholder="Base principal" /></Field>
        </FormGrid>
        <Field label="Notas de garantía"><Input {...f.bind('warranty_notes')} /></Field>
        <Field label="Notas"><Textarea {...f.bind('notes')} /></Field>
        <Field label="Fotografía"><FilePicker files={photo} onChange={setPhoto} max={1} label="Foto" /></Field>
      </div>
    </Modal>
  );
}
