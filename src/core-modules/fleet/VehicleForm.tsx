import { useState } from 'react';
import { z } from 'zod';
import { supabase } from '@core/data/supabase';
import { rpc, run, useAction } from '@core/data/api';
import { diff, savedMsg, useSaveOrRequest } from '@core/data/changes';
import { uploadFile } from '@core/data/storage';
import { fleetKeys, type Vehicle } from '@core/data/shared';
import { Modal } from '@core/ui/Modal';
import { AlertTriangle } from 'lucide-react';
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
  const { save: saveOrRequest, isAdmin } = useSaveOrRequest();
  // Número de vehículo repetido: se ofrece sobrescribir el existente (admin directo; los demás, por solicitud)
  const [dup, setDup] = useState<{ id: string; unit_number: string; archived: boolean } | null>(null);
  const [reason, setReason] = useState('');

  const save = useAction(async () => {
    const v = f.validate();
    if (!v) throw new Error('Revise los campos marcados');
    const data: Record<string, unknown> = { ...v };
    if (vehicle) {
      if (photo[0]) data.photo_path = (await uploadFile('fleet', 'vehicles', photo[0])).path;
      // Horas/millaje no se editan aquí (solo avanzan por lecturas); evita retrocesos
      delete data.engine_hours; delete data.mileage;
      return saveOrRequest('vehicles', vehicle.id, data, vehicle as unknown as Record<string, unknown>);
    }
    const existing = await rpc<{ id: string; unit_number: string; archived: boolean } | null>('vehicle_by_unit', { p_unit: v.unit_number });
    if (existing) { setDup(existing); return 'duplicate' as const; }
    if (photo[0]) data.photo_path = (await uploadFile('fleet', 'vehicles', photo[0])).path;
    await run(supabase.from('vehicles').insert({ ...data, engine_hours: v.engine_hours ?? 0 }).select().single());
    return 'saved' as const;
  }, {
    invalidate: [fleetKeys.vehicles],
    success: (r) => r === 'duplicate' ? '' : vehicle ? savedMsg('Vehículo actualizado')(r) : 'Vehículo añadido',
    onSuccess: (r) => { if (r !== 'duplicate') onClose(); },
  });

  // Sobrescribir el vehículo existente con lo escrito (sin horas/millaje: esos solo avanzan por lecturas)
  const overwrite = useAction(async () => {
    const v = f.validate();
    if (!v || !dup) throw new Error('Revise los campos marcados');
    const before = await run(supabase.from('vehicles').select('*').eq('id', dup.id).single()) as Record<string, unknown>;
    // Solo lo que escribió: los campos vacíos no borran lo que ya tiene el vehículo
    const data: Record<string, unknown> = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null && x !== ''));
    data.unit_number = before.unit_number;
    delete data.engine_hours; delete data.mileage;
    if (photo[0]) data.photo_path = (await uploadFile('fleet', 'vehicles', photo[0])).path;
    if (!Object.keys(diff(before, data)).length) throw new Error('Lo que escribió es igual a lo que ya tiene ese vehículo');
    return saveOrRequest('vehicles', dup.id, data, before, reason.trim() || 'Sobrescribir datos del vehículo');
  }, {
    invalidate: [fleetKeys.vehicles],
    success: (r) => r === 'requested' ? 'Solicitud enviada al administrador o supervisor' : 'Vehículo sobrescrito',
    onSuccess: onClose,
  });

  return (
    <Modal open={open} onClose={onClose} title={vehicle ? `Editar ${vehicle.unit_number}` : 'Añadir vehículo'} size="lg"
      footer={dup
        ? <><Button onClick={() => setDup(null)}>Cambiar número</Button><Button variant="primary" loading={overwrite.isPending} onClick={() => overwrite.mutate()}>{isAdmin ? 'Sobrescribir' : 'Enviar solicitud'}</Button></>
        : <><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button></>}>
      <div className="space-y-4">
        {dup && (
          <div role="alert" className="rounded-md border border-warn/40 bg-warn-soft p-3.5 text-sm">
            <p className="flex items-start gap-2 font-medium text-ink">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
              El vehículo <span className="font-mono">{dup.unit_number}</span> ya existe{dup.archived ? ' (archivado)' : ''}.
            </p>
            <p className="mt-1 pl-6 text-ink-2">
              {isAdmin
                ? 'Puede sobrescribir sus datos con lo que escribió aquí, o cambiar el número.'
                : 'No se puede repetir el número. Si quiere sobrescribir sus datos con lo que escribió, se envía una solicitud al administrador o supervisor.'}
            </p>
            {!isAdmin && <div className="mt-2.5 pl-6"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (opcional)" aria-label="Motivo" /></div>}
          </div>
        )}
        <FormGrid cols={3}>
          <Field label="Número de unidad" required error={f.errors.unit_number}><Input {...f.bind('unit_number')} onInput={() => dup && setDup(null)} className="h-10 font-mono uppercase" placeholder="UTV-01" /></Field>
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
