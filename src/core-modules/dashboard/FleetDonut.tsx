import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, OctagonX, Wrench, type LucideIcon } from 'lucide-react';
import { useVehicles } from '@core/data/shared';
import { EmptyState, cx } from '@core/ui/primitives';

/**
 * Estado de la flota en una gráfica circular: Disponibles · En taller · Fuera de servicio.
 * Colores validados para daltonismo (ver index.css --color-chart-*); además cada
 * segmento lleva icono, nombre, número y % en la leyenda: nunca solo color.
 */
const GROUPS: { id: 'available' | 'shop' | 'out_of_service'; label: string; statuses: string[]; color: string; icon: LucideIcon }[] = [
  { id: 'available', label: 'Disponibles', statuses: ['available', 'assigned', 'in_operation'], color: 'var(--color-chart-ok)', icon: CheckCircle2 },
  { id: 'shop', label: 'En taller', statuses: ['maintenance', 'repair'], color: 'var(--color-chart-warn)', icon: Wrench },
  { id: 'out_of_service', label: 'Fuera de servicio', statuses: ['out_of_service'], color: 'var(--color-chart-bad)', icon: OctagonX },
];

const SIZE = 220, STROKE = 30, R = (SIZE - STROKE) / 2, C = 2 * Math.PI * R, GAP = 3;
const pct = (n: number, total: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);
const fmtPct = (p: number) => `${p.toLocaleString('es-PR', { maximumFractionDigits: 1 })}%`;

export function FleetDonut() {
  const { data, isLoading } = useVehicles();
  const [hover, setHover] = useState<string | null>(null);
  const vehicles = (data ?? []).filter((v) => v.status !== 'retired');
  const total = vehicles.length;
  const rows = GROUPS.map((g) => ({ ...g, n: vehicles.filter((v) => g.statuses.includes(v.status)).length }));
  const active = rows.find((r) => r.id === hover);

  // Segmentos: cada uno arranca donde terminó el anterior, con 3px de separación
  let offset = 0;
  const segs = rows.filter((r) => r.n > 0).map((r) => {
    const len = (r.n / total) * C;
    const seg = { ...r, dash: Math.max(len - (rows.filter((x) => x.n > 0).length > 1 ? GAP : 0), 0.5), start: offset };
    offset += len;
    return seg;
  });

  const summary = rows.map((r) => `${r.label}: ${r.n} (${fmtPct(pct(r.n, total))})`).join(', ');

  return (
    <section className="rounded-card border border-line bg-panel shadow-card">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-2">Estado de la flota</h2>
        <Link to="/flota" className="rounded-md px-2 py-1 text-[13px] font-medium text-muted transition-colors hover:bg-sunken hover:text-ink">Ver vehículos</Link>
      </header>

      {isLoading ? (
        <div className="grid place-items-center p-8"><div className="size-[220px] animate-pulse rounded-full border-[30px] border-sunken" /></div>
      ) : total === 0 ? (
        <EmptyState title="Sin vehículos registrados">Añada vehículos para ver su estado aquí.</EmptyState>
      ) : (
        <div className="grid items-center gap-6 p-4 sm:p-6 md:grid-cols-[auto_1fr] md:gap-10">
          <figure className="relative mx-auto aspect-square w-full max-w-[240px]">
            <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="size-full -rotate-90 overflow-visible" role="img" aria-label={`${total} vehículos. ${summary}`}>
              <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--color-sunken)" strokeWidth={STROKE} />
              {segs.map((s) => (
                <circle key={s.id} cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke={s.color}
                  strokeWidth={hover === s.id ? STROKE + 6 : STROKE}
                  strokeDasharray={`${s.dash} ${C - s.dash}`} strokeDashoffset={-s.start}
                  className={cx('donut-seg cursor-pointer transition-[stroke-width,opacity] duration-200', hover && hover !== s.id && 'opacity-35')}
                  onMouseEnter={() => setHover(s.id)} onMouseLeave={() => setHover(null)}>
                  <title>{`${s.label}: ${s.n} (${fmtPct(pct(s.n, total))})`}</title>
                </circle>
              ))}
            </svg>
            <figcaption className="pointer-events-none absolute inset-0 grid place-items-center text-center" aria-hidden>
              <div>
                <div className="num text-[44px] font-semibold leading-none tracking-tight">{active ? active.n : total}</div>
                <div className="mt-1.5 text-[13px] font-medium text-muted">{active ? `${active.label} · ${fmtPct(pct(active.n, total))}` : 'Vehículos'}</div>
              </div>
            </figcaption>
          </figure>

          <ul className="grid gap-2" aria-label="Detalle por estado">
            {rows.map((r) => {
              const Icon = r.icon;
              const p = pct(r.n, total);
              return (
                <li key={r.id}>
                  <Link to={`/flota?estado=${r.id}`} onMouseEnter={() => setHover(r.id)} onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(r.id)} onBlur={() => setHover(null)}
                    className={cx('group flex min-h-14 items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                      hover === r.id ? 'border-line-strong bg-paper' : 'border-transparent hover:bg-paper')}>
                    <span className="grid size-9 shrink-0 place-items-center rounded-md" style={{ background: `color-mix(in oklab, ${r.color} 14%, white)`, color: r.color }}>
                      <Icon className="size-[18px]" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink">{r.label}</span>
                      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-sunken">
                        <span className="donut-bar block h-full rounded-full" style={{ width: `${p}%`, background: r.color }} />
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="num block text-2xl font-semibold leading-none text-ink">{r.n}</span>
                      <span className="num mt-1 block text-[13px] text-muted">{fmtPct(p)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
