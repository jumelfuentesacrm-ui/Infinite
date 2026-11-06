/** DEMO — accesos rápidos en el login y aviso fijo de datos de ejemplo. */
import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { resetDemo } from './backend';

export const DEMO_USERS = [
  { code: 'ADMIN', pin: '482615', name: 'Marisol Rivera', role: 'Admin' },
  { code: 'SUP1', pin: '82641', name: 'Javier Ortiz', role: 'Supervisor' },
  { code: 'CH01', pin: '7391', name: 'Carlos Méndez', role: 'ATV/UTV' },
  { code: 'MEC1', pin: '5519', name: 'Mario Santiago', role: 'Mecánico' },
];

export function DemoUsers({ onPick }: { onPick: (pin: string) => void }) {
  return (
    <div className="mt-10 w-full">
      <p className="mb-2 text-center text-[11px] uppercase tracking-[0.16em] text-faint">Demo · entrar como</p>
      <div className="grid grid-cols-2 gap-2">
        {DEMO_USERS.map((u) => (
          <button key={u.code} onClick={() => onPick(u.pin)}
            className="rounded-lg border border-line bg-panel px-3 py-2 text-left transition-colors hover:border-line-strong">
            <span className="block text-[13px] font-medium text-ink">{u.role}</span>
            <span className="block text-[11px] tabular-nums text-muted">PIN {u.pin}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function DemoBanner() {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex h-[var(--demo-h)] items-center justify-center gap-3 overflow-hidden bg-brand px-4 pt-[env(safe-area-inset-top)] text-[12px] font-medium text-white">
      <span className="truncate"><span className="sm:hidden">Demo · datos de ejemplo</span><span className="hidden sm:inline">Demo con datos de ejemplo. Lo que haga se guarda solo en este navegador.</span></span>
      <button disabled={busy} onClick={() => { setBusy(true); resetDemo(); }}
        className="inline-flex items-center gap-1 rounded border border-white/40 px-2 py-0.5 hover:bg-white/15">
        <RotateCcw className="size-3" />{busy ? 'Reiniciando…' : 'Reiniciar demo'}
      </button>
    </div>
  );
}
