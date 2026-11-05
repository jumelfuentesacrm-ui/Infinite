/**
 * Formularios: campos con estilo común + useForm con validación zod centralizada.
 */
import { useCallback, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import type { ZodType } from 'zod';
import { cx } from './primitives';

const inputCls = 'w-full rounded-md border border-line-strong bg-panel px-3 text-[15px] md:text-sm text-ink placeholder:text-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-sunken disabled:text-muted';

export function Field({ label, error, hint, children, required, className }: {
  label?: ReactNode; error?: string; hint?: ReactNode; children: ReactNode; required?: boolean; className?: string;
}) {
  return (
    <label className={cx('block min-w-0', className)}>
      {label && <span className="mb-1 block text-[13px] font-medium text-ink-2">{label}{required && <span className="text-bad"> *</span>}</span>}
      {children}
      {error ? <span className="mt-1 block text-xs text-bad">{error}</span> : hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, 'h-10', props.className)} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={cx(inputCls, 'py-2', props.className)} />;
}
export function Select({ options, placeholder, ...props }: SelectHTMLAttributes<HTMLSelectElement> & {
  options: { value: string; label: string }[]; placeholder?: string;
}) {
  return (
    <select {...props} className={cx(inputCls, 'h-10 pr-8', props.className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
export function Checkbox({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" {...props} className="size-4 rounded border-line-strong accent-[var(--color-brand)]" />
      {label}
    </label>
  );
}
export function FormGrid({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 | 3 }) {
  return <div className={cx('grid gap-4', cols === 2 && 'sm:grid-cols-2', cols === 3 && 'sm:grid-cols-3')}>{children}</div>;
}

/** Convierte strings vacíos en null antes de validar/guardar */
export const blankToNull = <T extends Record<string, unknown>>(o: T) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === '' ? null : v])) as T;

/** Estado de formulario + validación zod. */
export function useForm<T extends Record<string, any>>(initial: T, schema?: ZodType<any>) {
  const [values, setValues] = useState<T>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({});

  const set = useCallback(<K extends keyof T>(k: K, v: T[K]) => {
    setValues((s) => ({ ...s, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  }, []);

  /** props para <Input {...bind('campo')} /> */
  const bind = <K extends keyof T>(k: K) => ({
    value: (values[k] ?? '') as string | number,
    onChange: (e: { target: { value: string } }) => set(k, e.target.value as T[K]),
  });

  const validate = (): T | null => {
    if (!schema) return values;
    const r = schema.safeParse(blankToNull(values));
    if (r.success) return r.data as T;
    const errs: Partial<Record<keyof T, string>> = {};
    for (const issue of r.error.issues) {
      const k = issue.path[0] as keyof T;
      if (!errs[k]) errs[k] = issue.message;
    }
    setErrors(errs);
    return null;
  };

  return { values, set, bind, errors, validate, reset: (v: T = initial) => { setValues(v); setErrors({}); } };
}

/** Lista de selección múltiple con búsqueda (vehículos, empleados, modelos…) */
export function CheckList({ options, value, onChange, placeholder = 'Buscar…', height = 220 }: {
  options: { value: string; label: string; hint?: string }[]; value: string[]; onChange: (v: string[]) => void; placeholder?: string; height?: number;
}) {
  const [q, setQ] = useState('');
  const shown = options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()));
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <div className="rounded-md border border-line-strong">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder}
        className="h-9 w-full border-b border-line bg-transparent px-3 text-sm focus:outline-none" />
      <ul className="overflow-y-auto py-1" style={{ maxHeight: height }}>
        {shown.map((o) => (
          <li key={o.value}>
            <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-paper">
              <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} className="size-4 accent-[var(--color-brand)]" />
              <span className="flex-1">{o.label}</span>{o.hint && <span className="text-xs text-muted">{o.hint}</span>}
            </label>
          </li>
        ))}
        {!shown.length && <li className="px-3 py-2 text-sm text-muted">Sin resultados</li>}
      </ul>
      {value.length > 0 && <div className="border-t border-line px-3 py-1.5 text-xs text-muted">{value.length} seleccionado(s)</div>}
    </div>
  );
}
