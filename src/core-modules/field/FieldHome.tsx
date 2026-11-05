import { Link } from 'react-router-dom';
import { Truck } from 'lucide-react';
import { useAuth } from '@core/auth/AuthProvider';
import { useModules } from '@core/modules/registry';
import { Slot } from '@core/modules/Slot';
import { useMyVehicle, modelLabel, VEHICLE_STATUS } from '@core/data/shared';
import { Card, StatusBadge, cx } from '@core/ui/primitives';
import { StorageImage } from '@core/ui/media';
import { fmtDateTime, fmtLongDate, fmtNum } from '@core/lib/format';

/** Pantalla principal en el teléfono (choferes y mecánicos). Las acciones las aportan los módulos. */
export default function FieldHome() {
  const { profile, can } = useAuth();
  const { modules } = useModules();
  const veh = useMyVehicle();
  const actions = modules.flatMap((m) => m.fieldActions ?? []).filter((a) => can(a.perm)).sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
  const v = veh.data;
  const inspectedToday = v?.last_inspection_at && new Date(v.last_inspection_at).toDateString() === new Date().toDateString();

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-4">
        <div className="text-xs font-medium uppercase tracking-[0.08em] text-muted">{fmtLongDate(new Date())}</div>
        <h1 className="text-2xl font-semibold tracking-tight">Hola, {profile?.full_name.split(' ')[0]}</h1>
      </div>

      <Card pad={false} className="mb-4 overflow-hidden">
        {v ? (
          <Link to={`/flota/${v.id}`} className="flex gap-3 p-3">
            <StorageImage path={v.photo_path} alt={v.unit_number} className="size-20 shrink-0 rounded-md" />
            <div className="min-w-0 flex-1">
              <div className="text-xs text-muted">Mi vehículo</div>
              <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-lg font-semibold">{v.unit_number}</span><StatusBadge map={VEHICLE_STATUS} value={v.status} /></div>
              <div className="truncate text-sm text-muted">{modelLabel(v.vehicle_models)} · <span className="num">{fmtNum(v.engine_hours)} h</span></div>
              <div className={cx('mt-1 text-xs font-medium', inspectedToday ? 'text-ok' : 'text-warn')}>
                {inspectedToday ? `Inspeccionado hoy ${fmtDateTime(v.last_inspection_at).slice(-5)}` : 'Inspección de hoy pendiente'}
              </div>
            </div>
          </Link>
        ) : (
          <div className="flex items-center gap-3 p-4 text-sm text-muted"><Truck className="size-5" />{veh.isLoading ? 'Cargando…' : 'No tiene vehículo asignado'}</div>
        )}
        {v && <Slot name="field.vehicle" props={{ vehicleId: v.id }} />}
      </Card>

      <div className="grid grid-cols-2 gap-3">
        {actions.map((a) => (
          <Link key={a.to + a.label} to={a.to}
            className={cx('flex min-h-[112px] flex-col justify-between rounded-card border p-3.5 shadow-card active:scale-[0.98] transition-transform',
              a.tone === 'danger' ? 'border-bad/30 bg-bad text-white' : a.tone === 'primary' ? 'border-transparent bg-ink text-white' : 'border-line bg-panel')}>
            <a.icon className={cx('size-7', a.tone === 'default' || !a.tone ? 'text-brand' : '')} />
            <div>
              <div className="text-[15px] font-semibold leading-tight">{a.label}</div>
              {a.description && <div className={cx('mt-0.5 text-xs', a.tone && a.tone !== 'default' ? 'text-white/70' : 'text-muted')}>{a.description}</div>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
