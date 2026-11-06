import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, ChevronDown, ChevronLeft, Loader2, Send, Wrench } from 'lucide-react';
import { rpc } from '@core/data/api';
import { brand } from '@core/config';
import { cx } from '@core/ui/primitives';

/**
 * Reporte rápido en el taller — SIN PIN ni sesión.
 * Quien deja un ATV/UTV escoge el tipo, toca su número en la lista y dice qué le pasó.
 * El servidor valida la unidad, limita abusos y crea la orden de trabajo.
 */
type Unit = { unit_number: string; label: string; vehicle_type: string };
const ORDER = ['atv', 'utv'];
const TYPE_LABEL: Record<string, string> = { atv: 'ATV', utv: 'UTV', truck: 'Camión', car: 'Auto', van: 'Van', equipment: 'Equipo', other: 'Otro' };

export function PublicReport() {
  const [params] = useSearchParams();
  const [unit, setUnit] = useState((params.get('unidad') ?? '').toUpperCase());
  const [desc, setDesc] = useState('');
  const [name, setName] = useState('');
  const [units, setUnits] = useState<Unit[] | null>(null);
  const [type, setType] = useState<string>('');
  const [state, setState] = useState<{ status: 'idle' | 'sending' | 'done' | 'error'; msg?: string; order?: string }>({ status: 'idle' });
  const descRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    rpc<Unit[]>('public_vehicle_units').then((list) => {
      setUnits(list);
      // Enlace con ?unidad=…: abre ya con su tipo escogido
      const pre = list.find((u) => u.unit_number.toLowerCase() === unit.trim().toLowerCase());
      if (pre) setType(pre.vehicle_type);
    }).catch(() => setUnits([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tipos que existen en la flota (ATV y UTV primero)
  const types = useMemo(() => {
    // ATV y UTV siempre; otros tipos solo si hay unidades
    const present = [...new Set([...ORDER, ...(units ?? []).map((u) => u.vehicle_type)])];
    return present.sort((a, b) => (ORDER.indexOf(a) + 99 * +(ORDER.indexOf(a) < 0)) - (ORDER.indexOf(b) + 99 * +(ORDER.indexOf(b) < 0)));
  }, [units]);
  const list = useMemo(() => (units ?? []).filter((u) => u.vehicle_type === type)
    .sort((a, b) => a.unit_number.localeCompare(b.unit_number, 'es', { numeric: true })), [units, type]);
  const match = (units ?? []).find((u) => u.unit_number === unit);

  const valid = !!match && desc.trim().length >= 3;

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
    setUnit(''); setType(''); setDesc(''); setName(''); setState({ status: 'idle' });
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

            <fieldset>
              <legend className="mb-2 block text-sm font-medium">¿Qué es? <span className="text-bad">*</span></legend>
              {units === null ? (
                <div className="grid h-14 place-items-center text-muted"><Loader2 className="size-5 animate-spin" /></div>
              ) : (
                <div className={cx('grid gap-2', types.length === 2 ? 'grid-cols-2' : 'grid-cols-3')} role="radiogroup" aria-label="Tipo de unidad">
                  {types.map((t) => (
                    <button type="button" key={t} role="radio" aria-checked={type === t} onClick={() => { setType(t); if (match?.vehicle_type !== t) setUnit(''); }}
                      className={cx('h-14 rounded-lg border text-[17px] font-semibold tracking-wide transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.98]',
                        type === t ? 'border-ink bg-ink text-white' : 'border-line-strong bg-panel text-ink hover:border-ink/40')}>
                      {TYPE_LABEL[t] ?? t}
                    </button>
                  ))}
                </div>
              )}
            </fieldset>

            {type && (
              <fieldset className="fade-in">
                <legend className="mb-2 block text-sm font-medium">Número de {TYPE_LABEL[type] ?? 'unidad'} <span className="text-bad">*</span></legend>
                {!list.length && <p className="rounded-lg border border-line bg-panel px-4 py-3 text-sm text-muted">No hay {TYPE_LABEL[type] ?? 'unidades'} registrados todavía.</p>}
                {list.length > 0 && (
                  <div className="relative">
                    <select id="unit" value={match ? unit : ''} required aria-label={`Número de ${TYPE_LABEL[type] ?? 'unidad'}`}
                      onChange={(e) => { setUnit(e.target.value); if (e.target.value && !desc) setTimeout(() => descRef.current?.focus(), 50); }}
                      className={cx('h-14 w-full appearance-none rounded-lg border border-line-strong bg-panel pr-12 pl-4 text-xl outline-none transition-shadow focus:border-brand focus:ring-4 focus:ring-brand/15',
                        match ? 'font-mono font-semibold tracking-wide text-ink' : 'text-base text-faint')}>
                      <option value="" disabled>Escoja el número…</option>
                      {list.map((u) => <option key={u.unit_number} value={u.unit_number}>{u.unit_number}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute top-1/2 right-4 size-5 -translate-y-1/2 text-muted" aria-hidden />
                  </div>
                )}
                <p className={cx('mt-2 min-h-5 text-[13px]', match ? 'text-ink-2' : 'text-muted')}>
                  {match ? <>Unidad <span className="font-mono font-semibold">{match.unit_number}</span> · {match.label}</> : 'El número está detrás del asiento del pasajero o cerca del manubrio.'}
                </p>
              </fieldset>
            )}

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
