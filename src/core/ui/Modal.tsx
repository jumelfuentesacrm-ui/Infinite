import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button, cx } from './primitives';

/** Panel modal. En teléfono sube desde abajo; en escritorio es un panel lateral o centrado. */
export function Modal({ open, onClose, title, children, footer, size = 'md' }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg';
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('input,select,textarea')?.focus();
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="backdrop-in fixed inset-0 z-50 flex items-end justify-center bg-ink/50 md:items-center md:p-6" onMouseDown={onClose}>
      <div ref={ref} role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}
        aria-labelledby="modal-title" className={cx('sheet-in flex max-h-[calc(100dvh-env(safe-area-inset-top)-0.75rem)] w-full md:max-h-[92dvh] flex-col rounded-t-2xl bg-panel shadow-pop md:rounded-xl',
          size === 'sm' && 'md:max-w-md', size === 'md' && 'md:max-w-xl', size === 'lg' && 'md:max-w-3xl')}>
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 id="modal-title" className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="-mr-2 grid size-10 place-items-center rounded-md text-muted transition-colors hover:bg-sunken hover:text-ink" aria-label="Cerrar"><X className="size-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer && <div className="safe-bottom flex flex-wrap justify-end gap-2 border-t border-line px-4 pt-3 [&>button]:flex-1 sm:[&>button]:flex-none">{footer}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Confirmación
interface ConfirmOpts { title: string; body?: ReactNode; confirm?: string; danger?: boolean }
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => { state?.resolve(v); setState(null); };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal open={!!state} onClose={() => close(false)} title={state?.title} size="sm"
        footer={<>
          <Button onClick={() => close(false)}>Cancelar</Button>
          <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{state?.confirm ?? 'Confirmar'}</Button>
        </>}>
        <div className="text-sm text-ink-2">{state?.body}</div>
      </Modal>
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);
