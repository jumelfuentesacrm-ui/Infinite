import { forwardRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Inbox, AlertTriangle, ChevronLeft, type LucideIcon } from 'lucide-react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ---------------------------------------------------------------- Botones
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark';
const btnBase = 'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap select-none';
const btnVariants: Record<BtnVariant, string> = {
  primary: 'bg-brand text-brand-ink hover:brightness-95 active:brightness-90',
  secondary: 'bg-panel text-ink border border-line-strong hover:bg-sunken',
  ghost: 'text-ink-2 hover:bg-sunken',
  danger: 'bg-bad text-white hover:brightness-95',
  dark: 'bg-ink text-white hover:bg-ink-2',
};
const btnSizes = { sm: 'h-8 px-2.5 text-[13px]', md: 'h-10 px-3.5 text-sm', lg: 'h-12 px-5 text-base' };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: keyof typeof btnSizes;
  icon?: LucideIcon;
  loading?: boolean;
  block?: boolean;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, loading, block, className, children, disabled, type = 'button', ...rest }, ref) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading}
      className={cx(btnBase, btnVariants[variant], btnSizes[size], block && 'w-full', className)} {...rest}>
      {loading ? <Loader2 className="size-4 animate-spin" /> : Icon && <Icon className="size-4" />}
      {children}
    </button>
  );
});

export function LinkButton({ to, variant = 'secondary', size = 'md', icon: Icon, children, className }: {
  to: string; variant?: BtnVariant; size?: keyof typeof btnSizes; icon?: LucideIcon; children: ReactNode; className?: string;
}) {
  return (
    <Link to={to} className={cx(btnBase, btnVariants[variant], btnSizes[size], className)}>
      {Icon && <Icon className="size-4" />}{children}
    </Link>
  );
}

// ---------------------------------------------------------------- Contenedores
export function Card({ children, className, pad = true }: { children: ReactNode; className?: string; pad?: boolean }) {
  return <div className={cx('rounded-card border border-line bg-panel shadow-card', pad && 'p-4', className)}>{children}</div>;
}

export function Section({ title, actions, children, className, description }: {
  title: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; description?: ReactNode;
}) {
  return (
    <section className={cx('rounded-card border border-line bg-panel shadow-card', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="truncate text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-2">{title}</h2>
          {description && <p className="text-xs text-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, back, eyebrow }: {
  title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: string; eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {back && (
          <Link to={back} className="mb-1 inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink">
            <ChevronLeft className="size-4" />Volver
          </Link>
        )}
        {eyebrow && <div className="mb-1 text-xs font-medium uppercase tracking-[0.08em] text-muted">{eyebrow}</div>}
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight md:text-2xl">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function KeyValue({ items, cols = 2 }: { items: [ReactNode, ReactNode][]; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={cx('grid gap-x-6 gap-y-3', cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2 lg:grid-cols-3')}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs text-muted">{k}</dt>
          <dd className="mt-0.5 truncate text-sm font-medium">{v ?? <span className="text-faint">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------- Estado
export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'idle' | 'brand';
const toneCls: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-warn', bad: 'bg-bad-soft text-bad',
  info: 'bg-info-soft text-info', idle: 'bg-idle-soft text-idle', brand: 'bg-brand-soft text-brand',
};
const dotCls: Record<Tone, string> = {
  ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad', info: 'bg-info', idle: 'bg-idle', brand: 'bg-brand',
};
export function Badge({ tone = 'idle', children, dot = true, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', toneCls[tone], className)}>
      {dot && <span className={cx('size-1.5 rounded-full', dotCls[tone])} />}{children}
    </span>
  );
}

/** Mapa de estados → etiqueta y tono. Cada módulo define el suyo. */
export type StatusMap = Record<string, { label: string; tone: Tone }>;
export function StatusBadge({ map, value }: { map: StatusMap; value: string | null | undefined }) {
  if (!value) return null;
  const s = map[value] ?? { label: value, tone: 'idle' as Tone };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function UnitTag({ children }: { children: ReactNode }) {
  return <span className="tag-unit">{children}</span>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
      <Loader2 className="size-4 animate-spin" />{label ?? 'Cargando…'}
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, children, action }: {
  icon?: LucideIcon; title: string; children?: ReactNode; action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      <div className="mb-3 grid size-11 place-items-center rounded-full bg-sunken text-muted"><Icon className="size-5" /></div>
      <p className="font-medium">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: { message: string } | null; retry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-card border border-bad/30 bg-bad-soft p-4 text-sm text-bad">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="flex-1">{error?.message ?? 'Error al cargar'}</div>
      {retry && <button className="font-medium underline" onClick={retry}>Reintentar</button>}
    </div>
  );
}

/** Envuelve una consulta: carga, error, vacío y contenido en un solo lugar */
export function QueryView<T>({ q, empty, children }: {
  q: { data: T | undefined; isLoading: boolean; error: { message: string } | null; refetch: () => unknown };
  empty?: ReactNode | ((d: T) => ReactNode | null);
  children: (d: T) => ReactNode;
}) {
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (q.data === undefined) return null;
  const isEmpty = Array.isArray(q.data) && q.data.length === 0;
  if (isEmpty && empty) return <>{typeof empty === 'function' ? empty(q.data) : empty}</>;
  return <>{children(q.data)}</>;
}

// ---------------------------------------------------------------- KPI
export function StatCard({ label, value, tone, icon: Icon, to, hint }: {
  label: string; value: ReactNode; tone?: Tone; icon?: LucideIcon; to?: string; hint?: ReactNode;
}) {
  const body = (
    <div className={cx('group relative h-full overflow-hidden rounded-card border border-line bg-panel p-3.5 shadow-card',
      to && 'transition-colors hover:border-line-strong')}>
      {tone && <span className={cx('absolute inset-y-0 left-0 w-[3px]', dotCls[tone])} />}
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12px] font-medium leading-tight text-muted">{label}</span>
        {Icon && <Icon className="size-4 shrink-0 text-faint" />}
      </div>
      <div className="num mt-2 text-[26px] font-semibold leading-none tracking-tight">{value}</div>
      {hint && <div className="mt-1.5 text-xs text-muted">{hint}</div>}
    </div>
  );
  return to ? <Link to={to} className="block">{body}</Link> : body;
}

// ---------------------------------------------------------------- Pestañas
export function Tabs<T extends string>({ tabs, value, onChange }: {
  tabs: { id: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <div className="scroll-x -mx-4 mb-4 border-b border-line px-4 md:mx-0 md:px-0">
      <div className="flex gap-1">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => onChange(t.id)}
            className={cx('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              value === t.id ? 'border-brand text-ink' : 'border-transparent text-muted hover:text-ink')}>
            {t.label}{t.count != null && <span className="num ml-1.5 text-xs text-faint">{t.count}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Selector segmentado compacto (filtros rápidos) */
export function Segmented<T extends string>({ options, value, onChange }: {
  options: { id: T; label: string }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-line-strong bg-panel p-0.5">
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)}
          className={cx('rounded-[5px] px-2.5 py-1 text-[13px] font-medium', value === o.id ? 'bg-ink text-white' : 'text-ink-2 hover:bg-sunken')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function useToggle(initial = false) {
  const [v, set] = useState(initial);
  return [v, () => set((x) => !x), set] as const;
}
