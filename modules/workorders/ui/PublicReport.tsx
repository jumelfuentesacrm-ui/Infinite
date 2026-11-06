import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, ChevronLeft, Loader2, Send, Wrench } from 'lucide-react';
import { rpc } from '@core/data/api';
import { brand } from '@core/config';
import { cx } from '@core/ui/primitives';

/**
 * Reporte rápido en el taller — SIN PIN ni sesión.
 * Quien deja un ATV/UTV escribe el número de unidad y qué le pasó.
 * El servidor valida la unidad, limita abusos y crea la orden de trabajo.
 */
export function PublicReport() {
  const [params] = useSearchParams();
  const [unit, setUnit] = useState((params.get('unidad') ?? '').toUpperCase());
  const [desc, setDesc] = useState('');
  const [name, setName] = useState('');
  const [units, setUnits] = useState<{ unit_number: string; label: string }[]>([]);
  const [state, setState] = useState<{ status: 'idle' | 'sending' | 'done' | 'error'; msg?: string; order?: string }>({ status: 'idle' });
  const descRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    rpc<{ unit_number: string; label: string }[]>('public_vehicle_units').then(setUnits).catch(() => setUnits([]));
  }, []);

  const match = useMemo(() => units.find((u) => u.unit_number.toLowerCase() === unit.trim().toLowerCase()), [units, unit]);
  const suggestions = useMemo(() => {
    const q = unit.trim().toLowerCase();
    if (!q || match) return [];
    return units.filter((u) => u.unit_number.toLowerCase().includes(q)).slice(0, 6);
  }, [units, unit, match]);

  const valid = unit.trim().length > 0 && desc.trim().length >= 3;

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || state.status === 'sending') return;
    setState({ status: 'sending' });
    try {
      const r = await rpc<{ order_number: string | null; unit_number: string }>('public_report_problem', { p_unit: unit.trim(), p_description: desc.trim(), p_name: name.trim() || null });
      setState({ status: 'done', order: r.order_number ?? undefined, msg: r.unit_number });
    } catch (err) {
      setState({ status: 'error', msg: (err as Error).message || 'No se pudo enviar. Intente de nuevo.' });
    }
  }

  function reset() {
    setUnit(''); setDesc(''); setName(''); setState({ status: 'idle' });
  }

  return (
    <div className="min-h-dvh bg-paper">
      <header className="border-b border-line bg-rail pt-[env(safe-area-inset-top)] text-white">
        <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-3.5">
          {brand.mark
            ? <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white p-1"><img src={brand.mark} alt="" className="size-full object-contain" /></span>
            : <span className="grid size-9 place-items-center rounded-lg bg-brand font-mono text-sm font-bold">{brand.shortName.slice(0, 2).toUpperCase()}</span>}
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold leading-tight">{brand.name}</div>
            <div className="text-xs text-rail-text">Reporte en el taller</div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-4 pt-6 pb-[max(2rem,env(safe-area-inset-bottom))]">
        {state.status === 'done' ? (
          <div className="fade-in rounded-card border border-line bg-panel p-6 text-center shadow-card" role="status">
            <div className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-ok-soft text-ok"><CheckCircle2 className="size-7" /></div>
            <h1 className="text-xl font-semibold">Reporte enviado</h1>
            <p className="mt-2 text-sm text-muted">El taller ya fue avisado sobre la unidad <span className="tag-unit">{state.msg}</span></p>
            {state.order && <p className="mt-1 text-sm text-muted">Número de orden <span className="num font-semibold text-ink">{state.order}</span></p>}
            <p className="mt-1 text-sm text-muted">Un mecánico lo va a revisar.</p>
            <button onClick={reset} className="mt-6 inline-flex h-12 w-full items-center justify-center rounded-lg bg-ink text-[15px] font-medium text-white transition-colors hover:bg-ink-2 active:scale-[0.99]">
              Reportar otra unidad
            </button>
          </div>
        ) : (
          <form onSubmit={send} className="fade-in space-y-5" noValidate>
            <div>
              <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight"><Wrench className="size-5 text-brand" aria-hidden />¿Qué le pasó a la unidad?</h1>
              <p className="mt-1 text-sm text-muted">No necesita PIN. El mecánico recibe el aviso al instante.</p>
            </div>

            <div>
              <label htmlFor="unit" className="mb-1.5 block text-sm font-medium">Número de ATV / UTV <span className="text-bad">*</span></label>
              <input id="unit" value={unit} onChange={(e) => setUnit(e.target.value.toUpperCase())} autoComplete="off" autoCapitalize="characters"
                inputMode="text" placeholder="Ej. ATV-24" required aria-describedby="unit-help"
                className="h-14 w-full rounded-lg border border-line-strong bg-panel px-4 font-mono text-xl font-semibold tracking-wide outline-none transition-shadow placeholder:font-sans placeholder:text-base placeholder:font-normal placeholder:tracking-normal placeholder:text-faint focus:border-brand focus:ring-4 focus:ring-brand/15" />
              <p id="unit-help" className={cx('mt-1.5 min-h-5 text-[13px]', match ? 'text-ok' : 'text-muted')}>
                {match ? `✓ ${match.label}` : 'Está en la placa o calcomanía de la unidad.'}
              </p>
              {suggestions.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-2" aria-label="Unidades parecidas">
                  {suggestions.map((u) => (
                    <button type="button" key={u.unit_number} onClick={() => { setUnit(u.unit_number); descRef.current?.focus(); }}
                      className="tag-unit min-h-10 px-3 text-[15px] transition-colors hover:border-brand">{u.unit_number}</button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label htmlFor="desc" className="mb-1.5 block text-sm font-medium">Descripción del problema <span className="text-bad">*</span></label>
              <textarea id="desc" ref={descRef} value={desc} onChange={(e) => setDesc(e.target.value)} rows={5} maxLength={2000} required
                placeholder="Ej. No prende, hace ruido en la rueda delantera, se apagó subiendo la cuesta…"
                className="w-full resize-y rounded-lg border border-line-strong bg-panel px-4 py-3 text-base leading-relaxed outline-none transition-shadow placeholder:text-faint focus:border-brand focus:ring-4 focus:ring-brand/15" />
            </div>

            <div>
              <label htmlFor="name" className="mb-1.5 block text-sm font-medium">Su nombre <span className="font-normal text-muted">(opcional)</span></label>
              <input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name"
                className="h-12 w-full rounded-lg border border-line-strong bg-panel px-4 text-base outline-none transition-shadow focus:border-brand focus:ring-4 focus:ring-brand/15" />
            </div>

            {state.status === 'error' && <p role="alert" className="rounded-lg border border-bad/30 bg-bad-soft px-4 py-3 text-sm text-bad">{state.msg}</p>}

            <button type="submit" disabled={!valid || state.status === 'sending'}
              className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-lg bg-brand text-base font-semibold text-brand-ink shadow-card transition-[filter,transform] hover:brightness-95 active:scale-[0.99] disabled:opacity-50">
              {state.status === 'sending' ? <Loader2 className="size-5 animate-spin" /> : <Send className="size-5" />}
              {state.status === 'sending' ? 'Enviando…' : 'Enviar reporte'}
            </button>

            <Link to="/" className="flex min-h-11 items-center justify-center gap-1 text-sm text-muted hover:text-ink">
              <ChevronLeft className="size-4" />Entrar con PIN
            </Link>
          </form>
        )}
      </main>
    </div>
  );
}
