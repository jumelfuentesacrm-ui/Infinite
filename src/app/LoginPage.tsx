import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Delete, Loader2 } from 'lucide-react';
import { PUBLIC_ROUTES } from '@core/modules/registry';
import { useAuth } from '@core/auth/AuthProvider';
import { brand } from '@core/config';
import { cx } from '@core/ui/primitives';

const DemoUsers = import.meta.env.VITE_DEMO === '1' ? lazy(() => import('../demo/DemoUI').then((m) => ({ default: m.DemoUsers }))) : null;

/** Máximo de dígitos que se muestran como puntos (no revela el largo según el rol) */
const SLOTS = 6;
const MAX = 8;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * Entrada solo con PIN. El PIN identifica a la persona:
 * 4 dígitos empleados · 5 supervisores · 6 administradores (configurable por rol).
 */
export function LoginPage() {
  const { login } = useAuth();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);

  const submit = useCallback(async (p: string) => {
    if (p.length < 4 || busy) return;
    setBusy(true); setError(null);
    try { await login(p); }
    catch (e) { setError((e as Error).message); setPin(''); setShake((n) => n + 1); }
    finally { setBusy(false); }
  }, [busy, login]);

  const press = useCallback((d: string) => {
    if (busy) return;
    setError(null);
    setPin((p) => (p + d).slice(0, MAX));
  }, [busy]);
  const erase = useCallback(() => { setError(null); setPin((p) => p.slice(0, -1)); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') erase();
      else if (e.key === 'Enter') submit(pin);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press, erase, submit, pin]);

  const slots = Math.max(SLOTS, pin.length);
  const ready = pin.length >= 4 && !busy;

  return (
    <div className="login-bg flex min-h-dvh flex-col text-ink">
      <main className="flex flex-1 flex-col items-center justify-center px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-6">
        <div className="fade-in w-full max-w-[320px]">
          <header className="text-center">
            {brand.logo && <img src={brand.logo} alt={brand.company} width={150} height={58} className="mx-auto mb-4 h-auto w-[150px] select-none" draggable={false} />}
            <p className="text-[13px] font-medium uppercase tracking-[0.2em] text-muted">{brand.company}</p>
            <h1 className="mt-2 text-[26px] font-semibold tracking-tight">{brand.name}</h1>
          </header>

          <section className={cx(brand.logo ? 'mt-6' : 'mt-10')} aria-label="Ingreso con PIN">
            <p className="text-center text-[15px] text-ink-2">Ingrese su PIN</p>

            <div key={shake} className={cx('mt-5 flex h-6 items-center justify-center gap-3.5', shake > 0 && 'pin-shake')}
              role="img" aria-label={pin.length ? `${pin.length} dígitos escritos` : 'Sin dígitos'}>
              {Array.from({ length: slots }).map((_, i) => (
                <span key={i} className={cx('size-3 rounded-full transition-all duration-200',
                  i < pin.length ? (error ? 'scale-100 bg-bad' : 'scale-100 bg-ink') : 'scale-[0.8] bg-line-strong')} />
              ))}
            </div>
            <p className="mt-3 h-5 text-center text-[13px] text-bad" role="alert" aria-live="assertive">{error}</p>

            <div className="mt-4 grid grid-cols-3 justify-items-center gap-x-6 gap-y-4">
              {KEYS.map((d) => <Key key={d} onClick={() => press(d)} label={d}>{d}</Key>)}
              <button type="button" onClick={erase} disabled={!pin || busy} aria-label="Borrar un dígito"
                className="grid size-[72px] place-items-center rounded-full text-muted transition-[color,transform] duration-150 hover:text-ink active:scale-95 disabled:opacity-0">
                <Delete className="size-6" strokeWidth={1.6} />
              </button>
              <Key onClick={() => press('0')} label="0">0</Key>
              <button type="button" onClick={() => submit(pin)} disabled={!ready} aria-label="Entrar"
                className={cx('grid size-[72px] place-items-center rounded-full transition-[background-color,color,transform,opacity] duration-200 active:scale-95',
                  ready ? 'bg-ink text-white hover:bg-ink-2' : 'bg-transparent text-faint')}>
                {busy ? <Loader2 className="size-6 animate-spin" /> : <ArrowRight className="size-6" strokeWidth={1.8} />}
              </button>
            </div>
          </section>

          {DemoUsers && <Suspense fallback={null}><DemoUsers onPick={(p) => { setPin(p); submit(p); }} /></Suspense>}
        </div>
      </main>

      <footer className="flex flex-col items-center gap-2 px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-center">
        {/* Accesos públicos que aportan los módulos (ej. reporte en el taller) */}
        {PUBLIC_ROUTES.filter((r) => r.label).map(({ path, label }) => (
          <Link key={path} to={path} className="inline-flex min-h-11 items-center rounded-full px-4 text-[14px] font-medium text-ink-2 underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink hover:decoration-ink">
            {label}
          </Link>
        ))}
        <p className="text-[12px] text-faint">¿Olvidó su PIN? El administrador le asigna uno nuevo.</p>
      </footer>
    </div>
  );
}

function Key({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label}
      className="grid size-[72px] touch-manipulation select-none place-items-center rounded-full border border-line bg-panel text-[28px] font-normal tabular-nums text-ink shadow-[0_1px_0_rgba(21,24,28,0.04)] transition-[background-color,border-color,transform] duration-150 hover:border-line-strong active:scale-95 active:bg-sunken">
      {children}
    </button>
  );
}
