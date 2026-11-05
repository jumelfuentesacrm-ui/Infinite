import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check, X, Minus, AlertOctagon, Send } from 'lucide-react';
import { rpc, useAction } from '@core/data/api';
import { attachFile } from '@core/data/storage';
import { fleetKeys, useMyVehicle, useVehicle, modelLabel } from '@core/data/shared';
import { useAuth } from '@core/auth/AuthProvider';
import { getPosition } from '@core/lib/geo';
import { fmtNum } from '@core/lib/format';
import { Button, Card, EmptyState, PageHeader, Spinner, cx } from '@core/ui/primitives';
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from '@core/ui/form';
import { VehicleSelect } from '@core/ui/pickers';
import { FilePicker } from '@core/ui/media';
import { useData } from '@core/data/api';
import { FUEL_LEVELS, keys, MODULE, useTemplateItems, type TemplateItem } from './data';

type Answer = { result?: 'ok' | 'fail' | 'na'; comment: string; photos: File[] };

export default function InspectionForm() {
  const [params] = useSearchParams();
  const { can } = useAuth();
  const mine = useMyVehicle();
  const [vehicleId, setVehicleId] = useState<string>(params.get('vehiculo') ?? '');
  useEffect(() => { if (!vehicleId && mine.data) setVehicleId(mine.data.id); }, [mine.data, vehicleId]);
  const canPick = can('fleet.view');

  if (mine.isLoading) return <Spinner />;
  if (!vehicleId && !canPick) return <EmptyState title="No tiene vehículo asignado">Pida a su supervisor que le asigne un vehículo para poder inspeccionarlo.</EmptyState>;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Inspección diaria" back={canPick ? '/inspecciones' : '/m'} />
      {canPick && <div className="mb-4"><Field label="Vehículo"><VehicleSelect value={vehicleId} onChange={setVehicleId} /></Field></div>}
      {vehicleId && <InspectionBody key={vehicleId} vehicleId={vehicleId} />}
    </div>
  );
}

function InspectionBody({ vehicleId }: { vehicleId: string }) {
  const nav = useNavigate();
  const { data: v } = useVehicle(vehicleId);
  const tpl = useData(['inspection_template_for', vehicleId], () => rpc<string>('inspection_template_for', { p_vehicle: vehicleId }));
  const items = useTemplateItems(tpl.data);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [hours, setHours] = useState('');
  const [miles, setMiles] = useState('');
  const [fuel, setFuel] = useState('');
  const [notes, setNotes] = useState('');
  const [unfit, setUnfit] = useState(false);
  const [photos, setPhotos] = useState<File[]>([]);

  const groups = useMemo(() => {
    const g = new Map<string, TemplateItem[]>();
    (items.data ?? []).forEach((i) => g.set(i.category ?? 'General', [...(g.get(i.category ?? 'General') ?? []), i]));
    return [...g.entries()];
  }, [items.data]);
  const total = items.data?.length ?? 0;
  const done = Object.values(answers).filter((a) => a.result).length;
  const fails = (items.data ?? []).filter((i) => answers[i.id]?.result === 'fail');
  const criticalFail = fails.some((i) => i.is_critical);
  const set = (id: string, patch: Partial<Answer>) => setAnswers((a) => ({ ...a, [id]: { ...(a[id] ?? { comment: '', photos: [] }), ...patch } }));

  const submit = useAction(async () => {
    const list = items.data ?? [];
    const missing = list.filter((i) => !answers[i.id]?.result);
    if (missing.length) throw new Error(`Faltan ${missing.length} punto(s): ${missing.slice(0, 3).map((i) => i.label).join(', ')}…`);
    const noPhoto = list.find((i) => answers[i.id].result === 'fail' && i.photo_required_on_fail && !answers[i.id].photos.length);
    if (noPhoto) throw new Error(`"${noPhoto.label}" requiere foto cuando no es conforme`);
    const noComment = list.find((i) => answers[i.id].result === 'fail' && !answers[i.id].comment.trim());
    if (noComment) throw new Error(`Describa el problema en "${noComment.label}"`);
    const pos = await getPosition(6000);
    const res = await rpc<{ id: string; result: string; results: Record<string, string> }>('submit_inspection', {
      p_vehicle: vehicleId, p_template: tpl.data, p_notes: notes || null,
      p_results: list.map((i) => ({ item_id: i.id, result: answers[i.id].result, comment: answers[i.id].comment || null })),
      p_engine_hours: hours ? Number(hours) : null, p_mileage: miles ? Number(miles) : null, p_fuel_level: fuel || null,
      p_mark_unfit: unfit, p_lat: pos?.lat ?? null, p_lng: pos?.lng ?? null,
    });
    // Fotos: la inspección ya quedó guardada; las fotos se adjuntan a cada punto
    for (const i of list) for (const f of answers[i.id].photos) await attachFile(MODULE, 'inspection_result', res.results[i.id], f, i.label);
    for (const f of photos) await attachFile(MODULE, 'inspection', res.id, f);
    return res;
  }, {
    invalidate: [keys.all, fleetKeys.vehicles, fleetKeys.myVehicle],
    success: (r) => r.result === 'fail' ? 'Inspección enviada. Vehículo marcado NO APTO y se notificó al supervisor.' : 'Inspección enviada',
    onSuccess: (r) => nav(`/inspecciones/${r.id}`, { replace: true }),
  });

  if (tpl.isLoading || items.isLoading || !v) return <Spinner />;
  if (!tpl.data) return <EmptyState title="No hay plantilla de inspección para este modelo" />;

  return (
    <div className="space-y-4 pb-24">
      <Card className="flex items-center justify-between">
        <div>
          <div className="font-mono text-lg font-semibold">{v.unit_number}</div>
          <div className="text-sm text-muted">{modelLabel(v.vehicle_models)}</div>
        </div>
        <div className="text-right"><div className="num text-xl font-semibold">{done}/{total}</div><div className="text-xs text-muted">puntos</div></div>
      </Card>

      {groups.map(([cat, list]) => (
        <section key={cat}>
          <h2 className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">{cat}</h2>
          <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-panel shadow-card">
            {list.map((i) => {
              const a = answers[i.id];
              return (
                <div key={i.id} className={cx('p-3', a?.result === 'fail' && 'bg-bad-soft/50')}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium">{i.label}{i.is_critical && <span className="ml-1.5 align-middle text-[10px] font-semibold uppercase text-bad">crítico</span>}</div>
                      {i.help_text && <div className="text-xs text-muted">{i.help_text}</div>}
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <Choice active={a?.result === 'ok'} tone="ok" onClick={() => set(i.id, { result: 'ok' })} label="Conforme"><Check className="size-5" /></Choice>
                      <Choice active={a?.result === 'fail'} tone="bad" onClick={() => set(i.id, { result: 'fail' })} label="No conforme"><X className="size-5" /></Choice>
                      <Choice active={a?.result === 'na'} tone="idle" onClick={() => set(i.id, { result: 'na' })} label="No aplica"><Minus className="size-5" /></Choice>
                    </div>
                  </div>
                  {a?.result === 'fail' && (
                    <div className="mt-3 space-y-2">
                      <Textarea rows={2} placeholder="Describa el problema" value={a.comment} onChange={(e) => set(i.id, { comment: e.target.value })} />
                      <FilePicker files={a.photos} onChange={(f) => set(i.id, { photos: f })} max={4} />
                    </div>
                  )}
                  {a?.result && a.result !== 'fail' && (
                    <input className="mt-2 w-full border-0 border-b border-dashed border-line bg-transparent px-0 py-1 text-sm placeholder:text-faint focus:border-brand focus:outline-none"
                      placeholder="Comentario (opcional)" value={a.comment} onChange={(e) => set(i.id, { comment: e.target.value })} />
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <Card className="space-y-4">
        <FormGrid cols={3}>
          {v.vehicle_models?.uses_engine_hours && <Field label="Horas de motor" hint={`Última: ${fmtNum(v.engine_hours)} h`}><Input type="number" inputMode="decimal" step="0.1" value={hours} onChange={(e) => setHours(e.target.value)} /></Field>}
          {v.vehicle_models?.uses_mileage && <Field label="Millaje" hint={`Último: ${fmtNum(v.mileage)}`}><Input type="number" inputMode="decimal" step="0.1" value={miles} onChange={(e) => setMiles(e.target.value)} /></Field>}
          <Field label="Combustible"><Select value={fuel} onChange={(e) => setFuel(e.target.value)} placeholder="—" options={FUEL_LEVELS} /></Field>
        </FormGrid>
        <Field label="Observaciones"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <Field label="Fotos generales"><FilePicker files={photos} onChange={setPhotos} /></Field>
        <div className={cx('rounded-md border p-3', criticalFail || unfit ? 'border-bad/40 bg-bad-soft' : 'border-line')}>
          <Checkbox label={<span className="font-medium">Marcar vehículo como NO APTO para operar</span>} checked={unfit || criticalFail} disabled={criticalFail} onChange={(e) => setUnfit(e.target.checked)} />
          {criticalFail && <p className="mt-1 flex items-center gap-1.5 text-xs text-bad"><AlertOctagon className="size-3.5" />Hay un punto crítico no conforme: el vehículo quedará fuera de servicio.</p>}
        </div>
      </Card>

      <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-panel/95 px-4 pt-3 backdrop-blur md:static md:border-0 md:bg-transparent md:p-0">
        <Button variant="primary" size="lg" block icon={Send} loading={submit.isPending} disabled={done < total} onClick={() => submit.mutate()}>
          {done < total ? `Faltan ${total - done} puntos` : fails.length ? `Enviar (${fails.length} no conforme)` : 'Enviar inspección'}
        </Button>
      </div>
    </div>
  );
}

function Choice({ active, tone, onClick, label, children }: { active?: boolean; tone: 'ok' | 'bad' | 'idle'; onClick: () => void; label: string; children: React.ReactNode }) {
  const on = { ok: 'bg-ok text-white border-ok', bad: 'bg-bad text-white border-bad', idle: 'bg-idle text-white border-idle' }[tone];
  return (
    <button type="button" onClick={onClick} aria-label={label} aria-pressed={active} title={label}
      className={cx('grid size-11 place-items-center rounded-lg border-2 transition-colors', active ? on : 'border-line text-faint hover:border-line-strong')}>
      {children}
    </button>
  );
}
