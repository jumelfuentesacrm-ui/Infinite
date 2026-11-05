import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Navigation, Plus, Radio, Copy, Gauge } from 'lucide-react';
import { supabase, functionsUrl } from '@core/data/supabase';
import { rpc, run, useAction, useData } from '@core/data/api';
import { useLiveTable } from '@core/data/realtime';
import { useAuth } from '@core/auth/AuthProvider';
import { useToast } from '@core/ui/Toast';
import { Badge, Button, Card, EmptyState, PageHeader, QueryView, Section, Spinner, UnitTag, cx } from '@core/ui/primitives';
import { Field, FormGrid, Input, Select } from '@core/ui/form';
import { VehicleSelect } from '@core/ui/pickers';
import { Modal } from '@core/ui/Modal';
import { DataTable } from '@core/ui/DataTable';
import { fmtAgo, fmtDateTime, fmtNum, today } from '@core/lib/format';

const FleetMap = lazy(() => import('./FleetMap'));
const keys = { map: ['gps', 'map'] as const };

interface MapRow { vehicle_id: string; unit_number: string; status: string; manufacturer: string; model: string; lat: number | null; lng: number | null; speed_kmh: number | null; recorded_at: string | null; source: string | null; employee_name: string | null; online: boolean | null }

const useFleetMap = () => useData(keys.map, () => run(supabase.from('gps_fleet_map').select('*').order('unit_number')) as Promise<MapRow[]>, { refetchInterval: 60_000 });

function useTrack(vehicleId: string | null, day: string) {
  return useData(['gps', 'track', vehicleId, day], () => {
    const from = new Date(day + 'T00:00:00');
    return run(supabase.from('gps_positions').select('lat, lng, recorded_at, speed_kmh').eq('vehicle_id', vehicleId!)
      .gte('recorded_at', from.toISOString()).lt('recorded_at', new Date(from.getTime() + 86_400_000).toISOString())
      .order('recorded_at').limit(5000)) as Promise<{ lat: number; lng: number; recorded_at: string; speed_kmh: number | null }[]>;
  }, { enabled: !!vehicleId });
}

export function MapPage() {
  const q = useFleetMap();
  useLiveTable('gps_last_positions', [keys.map]);
  const [sel, setSel] = useState<string | null>(null);
  const [day, setDay] = useState(today());
  const track = useTrack(sel, day);
  const rows = q.data ?? [];
  const located = rows.filter((r) => r.lat != null);
  const selected = rows.find((r) => r.vehicle_id === sel);

  return (
    <>
      <PageHeader title="Mapa de la flota" subtitle={`${located.filter((r) => r.online).length} en línea · ${located.length} con ubicación · ${rows.length} vehículos`} />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card pad={false} className="overflow-hidden">
          <Suspense fallback={<Spinner />}>
            <FleetMap height="min(68vh, 640px)" activeId={sel} onSelect={setSel}
              points={located.map((r) => ({ id: r.vehicle_id, lat: r.lat!, lng: r.lng!, label: r.unit_number, online: !!r.online,
                popup: <div className="text-xs"><b>{r.unit_number}</b><br />{r.employee_name ?? ''}<br />{fmtAgo(r.recorded_at)}</div> }))}
              track={sel ? track.data?.map((p) => [p.lat, p.lng]) : undefined} />
          </Suspense>
        </Card>
        <div className="space-y-3">
          {selected && (
            <Section title={<span className="font-mono">{selected.unit_number}</span>} actions={<Button size="sm" variant="ghost" onClick={() => setSel(null)}>Cerrar</Button>}>
              <Field label="Recorrido del día"><Input type="date" value={day} max={today()} onChange={(e) => setDay(e.target.value)} className="h-9" /></Field>
              <div className="mt-3 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-muted">Puntos</span><span className="num">{track.data?.length ?? '…'}</span></div>
                <div className="flex justify-between"><span className="text-muted">Vel. máx.</span><span className="num">{fmtNum(Math.max(0, ...(track.data ?? []).map((p) => p.speed_kmh ?? 0)))} km/h</span></div>
                <div className="flex justify-between"><span className="text-muted">Última señal</span><span>{fmtAgo(selected.recorded_at)}</span></div>
              </div>
              <Link to={`/flota/${selected.vehicle_id}`} className="mt-3 block text-sm underline">Ver expediente</Link>
            </Section>
          )}
          <Card pad={false}>
            <QueryView q={q} empty={<EmptyState title="Sin vehículos" />}>
              {(list) => (
                <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
                  {list.map((r) => (
                    <li key={r.vehicle_id}>
                      <button onClick={() => setSel(r.vehicle_id)} className={cx('flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-paper', sel === r.vehicle_id && 'bg-brand-soft/50')}>
                        <span className={cx('size-2.5 shrink-0 rounded-full', r.online ? 'bg-ok' : r.lat != null ? 'bg-faint' : 'bg-line')} />
                        <UnitTag>{r.unit_number}</UnitTag>
                        <span className="min-w-0 flex-1 truncate text-xs text-muted">{r.lat == null ? 'Sin datos GPS' : `${r.online ? 'En línea' : 'Sin conexión'} · ${fmtAgo(r.recorded_at)}`}</span>
                        {r.speed_kmh != null && r.online && <span className="num text-xs">{Math.round(r.speed_kmh)} km/h</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </QueryView>
          </Card>
        </div>
      </div>
    </>
  );
}

/** Dashboard: mapa compacto */
export function MapWidget() {
  const q = useFleetMap();
  const pts = (q.data ?? []).filter((r) => r.lat != null);
  return (
    <Section title="Mapa de vehículos" actions={<Link to="/gps" className="text-xs text-muted hover:text-ink">Abrir mapa</Link>}>
      {pts.length === 0 ? <EmptyState icon={Navigation} title="Aún no hay ubicaciones">Las posiciones llegan desde los teléfonos de los choferes o rastreadores GPS.</EmptyState> : (
        <div className="-m-4 overflow-hidden rounded-b-card"><Suspense fallback={<Spinner />}>
          <FleetMap height={300} points={pts.map((r) => ({ id: r.vehicle_id, lat: r.lat!, lng: r.lng!, label: r.unit_number, online: !!r.online }))} />
        </Suspense></div>
      )}
    </Section>
  );
}

/** Pestaña del expediente del vehículo */
export function VehicleLocationTab({ vehicleId }: { vehicleId: string }) {
  const [day, setDay] = useState(today());
  const last = useData(['gps', 'last', vehicleId], () => run(supabase.from('gps_last_positions').select('*').eq('vehicle_id', vehicleId).maybeSingle()) as Promise<any>);
  const track = useTrack(vehicleId, day);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Día"><Input type="date" value={day} max={today()} onChange={(e) => setDay(e.target.value)} className="h-9" /></Field>
        {last.data && <p className="pb-2 text-sm text-muted">Última posición {fmtDateTime(last.data.recorded_at)} ({last.data.source})</p>}
      </div>
      <Card pad={false} className="overflow-hidden">
        {last.data || track.data?.length ? (
          <Suspense fallback={<Spinner />}>
            <FleetMap height={420} points={last.data ? [{ id: vehicleId, lat: last.data.lat, lng: last.data.lng, label: 'Última', online: true }] : []} track={track.data?.map((p) => [p.lat, p.lng])} />
          </Suspense>
        ) : <EmptyState icon={Navigation} title="Sin datos de ubicación" />}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Teléfono: compartir ubicación
const TRACK_KEY = 'fleet-ops:gps-share';

/** Se muestra bajo "Mi vehículo". Envía la posición mientras la app está abierta. */
export function ShareLocation() {
  const { can } = useAuth();
  const toast = useToast();
  const [on, setOn] = useState(() => localStorage.getItem(TRACK_KEY) === '1');
  const [last, setLast] = useState<Date | null>(null);
  const lastSent = useRef(0);
  const interval = useData(['app_settings', 'gps'], async () =>
    ((await run(supabase.from('app_settings').select('value').eq('key', 'gps').maybeSingle()) as any)?.value?.phone_interval_seconds ?? 30) as number);

  useEffect(() => {
    localStorage.setItem(TRACK_KEY, on ? '1' : '0');
    if (!on || !('geolocation' in navigator)) return;
    let wake: { release: () => Promise<void> } | null = null;
    (navigator as any).wakeLock?.request('screen').then((w: any) => { wake = w; }).catch(() => {});
    const id = navigator.geolocation.watchPosition(async (p) => {
      const now = Date.now();
      if (now - lastSent.current < (interval.data ?? 30) * 1000) return;
      lastSent.current = now;
      try {
        await rpc('report_position', { p_lat: p.coords.latitude, p_lng: p.coords.longitude,
          p_speed: p.coords.speed != null ? p.coords.speed * 3.6 : null, p_heading: p.coords.heading, p_accuracy: p.coords.accuracy,
          p_recorded_at: new Date(p.timestamp).toISOString() });
        setLast(new Date());
      } catch { /* sin conexión: se reintenta en la siguiente lectura */ }
    }, () => { toast.error('Active el permiso de ubicación para compartir su posición'); setOn(false); },
    { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 });
    return () => { navigator.geolocation.clearWatch(id); wake?.release().catch(() => {}); };
  }, [on, interval.data, toast]);

  if (!can('gps.report')) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-3 py-2.5">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-sm font-medium"><Radio className={cx('size-4', on ? 'animate-pulse text-ok' : 'text-faint')} />Compartir ubicación</div>
        <div className="text-xs text-muted">{on ? (last ? `Enviada ${fmtAgo(last)}` : 'Esperando señal…') : 'Mantenga la app abierta mientras opera'}</div>
      </div>
      <button role="switch" aria-checked={on} onClick={() => setOn(!on)}
        className={cx('relative h-7 w-12 shrink-0 rounded-full transition-colors', on ? 'bg-ok' : 'bg-line-strong')}>
        <span className={cx('absolute top-0.5 size-6 rounded-full bg-white shadow transition-all', on ? 'left-[22px]' : 'left-0.5')} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- Configuración: dispositivos
export function DevicesPanel() {
  const { can } = useAuth();
  const q = useData(['gps', 'devices'], () => run(supabase.from('gps_devices').select('id, name, kind, provider, external_id, vehicle_id, active, last_seen_at, vehicles(unit_number)').order('name')) as Promise<any[]>);
  const [adding, setAdding] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const toggle = useAction((d: { id: string; active: boolean }) => run(supabase.from('gps_devices').update({ active: d.active }).eq('id', d.id)), { invalidate: [['gps', 'devices']] });
  return (
    <Section title="Dispositivos GPS" description="Rastreadores o proveedores externos que envían posiciones aunque nadie tenga la app abierta."
      actions={can('gps.manage') && <Button size="sm" icon={Plus} onClick={() => setAdding(true)}>Registrar</Button>}>
      <DataTable rows={q.data} loading={q.isLoading} error={q.error} search={false} empty={<EmptyState icon={Gauge} title="Sin dispositivos" />} columns={[
        { key: 'name', header: 'Nombre', mobile: 'title' },
        { key: 'kind', header: 'Tipo', value: (d) => ({ tracker: 'Rastreador', phone: 'Teléfono/tableta', external: 'Proveedor externo' } as Record<string, string>)[d.kind] },
        { key: 'vehicle', header: 'Vehículo', render: (d) => d.vehicles ? <UnitTag>{d.vehicles.unit_number}</UnitTag> : '—' },
        { key: 'last_seen_at', header: 'Última señal', render: (d) => d.last_seen_at ? fmtAgo(d.last_seen_at) : 'Nunca' },
        { key: 'active', header: 'Estado', render: (d) => can('gps.manage')
          ? <button onClick={() => toggle.mutate({ id: d.id, active: !d.active })}><Badge tone={d.active ? 'ok' : 'idle'}>{d.active ? 'Activo' : 'Inactivo'}</Badge></button>
          : <Badge tone={d.active ? 'ok' : 'idle'}>{d.active ? 'Activo' : 'Inactivo'}</Badge> },
      ]} />
      {adding && <RegisterDevice onClose={() => setAdding(false)} onToken={setToken} />}
      {token && <TokenModal token={token} onClose={() => setToken(null)} />}
    </Section>
  );
}

function RegisterDevice({ onClose, onToken }: { onClose: () => void; onToken: (t: string) => void }) {
  const [v, setV] = useState({ name: '', kind: 'tracker', vehicle: '', provider: '', external_id: '' });
  const save = useAction(() => rpc<{ token: string }>('register_gps_device', { p_name: v.name, p_kind: v.kind, p_vehicle: v.vehicle,
    p_provider: v.provider || null, p_external_id: v.external_id || null }),
  { invalidate: [['gps', 'devices']], onSuccess: (r) => { onClose(); onToken(r.token); } });
  return (
    <Modal open onClose={onClose} title="Registrar dispositivo GPS" size="sm"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!v.name || !v.vehicle} loading={save.isPending} onClick={() => save.mutate()}>Registrar</Button></>}>
      <div className="space-y-3">
        <Field label="Nombre"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Rastreador UTV-01" /></Field>
        <Field label="Tipo"><Select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })} options={[{ value: 'tracker', label: 'Rastreador' }, { value: 'phone', label: 'Teléfono/tableta fija' }, { value: 'external', label: 'Proveedor externo' }]} /></Field>
        <Field label="Vehículo"><VehicleSelect value={v.vehicle} onChange={(id) => setV({ ...v, vehicle: id })} /></Field>
        <FormGrid>
          <Field label="Proveedor"><Input value={v.provider} onChange={(e) => setV({ ...v, provider: e.target.value })} /></Field>
          <Field label="ID / IMEI"><Input value={v.external_id} onChange={(e) => setV({ ...v, external_id: e.target.value })} /></Field>
        </FormGrid>
      </div>
    </Modal>
  );
}

function TokenModal({ token, onClose }: { token: string; onClose: () => void }) {
  const toast = useToast();
  const url = `${functionsUrl}/gps-ingest`;
  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast.success('Copiado'));
  return (
    <Modal open onClose={onClose} title="Token del dispositivo" size="md" footer={<Button variant="primary" onClick={onClose}>Listo, lo guardé</Button>}>
      <p className="mb-3 text-sm text-bad">Este token se muestra una sola vez. Configúrelo en el dispositivo ahora.</p>
      <Field label="URL de envío"><div className="flex gap-2"><Input readOnly value={url} className="h-10 font-mono text-xs" /><Button icon={Copy} onClick={() => copy(url)} /></div></Field>
      <Field label="Token (Authorization: Bearer …)" className="mt-3"><div className="flex gap-2"><Input readOnly value={token} className="h-10 font-mono text-xs" /><Button icon={Copy} onClick={() => copy(token)} /></div></Field>
      <p className="mt-3 text-xs text-muted">Formato estándar: POST JSON {'{ "points": [{ "lat", "lng", "speed_kmh", "recorded_at" }] }'}. Para rastreadores tipo OsmAnd/Traccar añada <code>?format=osmand&amp;token=…</code> a la URL.</p>
    </Modal>
  );
}
