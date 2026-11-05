import { lazy, Suspense, useEffect, useRef, useState } from 'react';

const DemoUsers = import.meta.env.VITE_DEMO === '1' ? lazy(() => import('../demo/DemoUI').then((m) => ({ default: m.DemoUsers }))) : null;
import { Delete, Loader2, LogIn } from 'lucide-react';
import { useAuth } from '@core/auth/AuthProvider';
import { brand } from '@core/config';
import { cx } from '@core/ui/primitives';

const LAST_CODE = 'fleet-ops:last-code';

/** Acceso por código de empleado + PIN con teclado numérico grande (pensado para guantes y sol). */
export function LoginPage() {
  const { login } = useAuth();
  const [code, setCode] = useState(() => localStorage.getItem(LAST_CODE) ?? '');
  const [pin, setPin] = useState('');
  const [step, setStep] = useState<'code' | 'pin'>(code ? 'pin' : 'code');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (step === 'code') codeRef.current?.focus(); }, [step]);

  const submit = async (p = pin) => {
    if (p.length < 4 || busy) return;
    setBusy(true); setError(null);
    try {
      await login(code, p);
      localStorage.setItem(LAST_CODE, code.toUpperCase());
    } catch (e) {
      setError((e as Error).message); setPin('');
    } finally { setBusy(false); }
  };

  const press = (d: string) => {
    if (busy) return;
    setError(null);
    const next = (pin + d).slice(0, 8);
    setPin(next);
  };

  useEffect(() => {
    if (step !== 'pin') return;
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
      else if (e.key === 'Enter') submit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="flex min-h-dvh flex-col bg-rail text-white">
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-10">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-xl bg-brand font-mono text-lg font-bold">{brand.shortName.slice(0, 2).toUpperCase()}</div>
          <h1 className="text-xl font-semibold">{brand.name}</h1>
          <p className="mt-1 text-sm text-rail-text">{brand.company}</p>
        </div>

        {step === 'code' ? (
          <form className="w-full max-w-xs" onSubmit={(e) => { e.preventDefault(); if (code.trim().length >= 2) setStep('pin'); }}>
            <label className="mb-2 block text-sm text-rail-text">Código de empleado</label>
            <input ref={codeRef} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters"
              autoComplete="username" placeholder="Ej. CH01"
              className="h-14 w-full rounded-lg border border-white/15 bg-rail-2 px-4 text-center font-mono text-2xl tracking-[0.2em] text-white placeholder:text-white/25 focus:border-brand focus:outline-none" />
            <button type="submit" disabled={code.trim().length < 2}
              className="mt-4 h-12 w-full rounded-lg bg-brand font-semibold disabled:opacity-40">Continuar</button>
          </form>
        ) : (
          <div className="w-full max-w-xs">
            <button onClick={() => { setStep('code'); setPin(''); setError(null); }}
              className="mx-auto mb-5 block rounded-full border border-white/15 px-3 py-1 font-mono text-sm tracking-widest text-rail-text hover:text-white">
              {code} · cambiar
            </button>
            <div className="mb-2 flex justify-center gap-3" aria-label={`${pin.length} dígitos`}>
              {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
                <span key={i} className={cx('size-3.5 rounded-full border-2 transition-colors', i < pin.length ? 'border-brand bg-brand' : 'border-white/30')} />
              ))}
            </div>
            <p className={cx('mb-4 h-5 text-center text-sm', error ? 'text-[#FFA8A8]' : 'text-rail-text')}>{error ?? 'Ingrese su PIN'}</p>
            <div className="grid grid-cols-3 gap-3">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                <button key={d} onClick={() => press(d)} className="h-16 rounded-xl bg-rail-2 font-mono text-2xl font-semibold active:bg-white/15">{d}</button>
              ))}
              <button onClick={() => setPin((p) => p.slice(0, -1))} className="grid h-16 place-items-center rounded-xl text-rail-text active:bg-white/10" aria-label="Borrar"><Delete /></button>
              <button onClick={() => press('0')} className="h-16 rounded-xl bg-rail-2 font-mono text-2xl font-semibold active:bg-white/15">0</button>
              <button onClick={() => submit()} disabled={pin.length < 4 || busy} aria-label="Entrar"
                className="grid h-16 place-items-center rounded-xl bg-brand disabled:opacity-40">{busy ? <Loader2 className="animate-spin" /> : <LogIn />}</button>
            </div>
          </div>
        )}
        {DemoUsers && <Suspense fallback={null}><DemoUsers onPick={(c, p) => { setCode(c); setStep('pin'); setPin(p); setError(null); setBusy(true);
          login(c, p).catch((e) => { setError((e as Error).message); setPin(''); }).finally(() => setBusy(false)); }} /></Suspense>}
      </div>
      <p className="safe-bottom pb-4 text-center text-xs text-white/30">¿Olvidó su PIN? Pida a su supervisor que lo restablezca.</p>
    </div>
  );
}
