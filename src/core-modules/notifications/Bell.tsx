import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useLiveTable } from '@core/data/realtime';
import { cx } from '@core/ui/primitives';
import { fmtAgo } from '@core/lib/format';
import { notifKeys, useMarkRead, useNotifications, type Notification } from './data';

export const severityDot = { info: 'bg-info', warning: 'bg-warn', critical: 'bg-bad' } as const;

export function NotificationBell() {
  const { data = [] } = useNotifications(30);
  const mark = useMarkRead();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  useLiveTable('notifications', [notifKeys.all]);

  const unread = data.filter((n) => !n.is_read);
  const prevCount = useRef(unread.length);
  useEffect(() => {
    // Aviso del sistema si llegan nuevas críticas y el usuario lo permitió
    const fresh = unread.length - prevCount.current;
    if (fresh > 0 && document.hidden && 'Notification' in window && window.Notification.permission === 'granted') {
      const n = unread[0];
      new window.Notification(n.title, { body: n.body ?? undefined, tag: n.id });
    }
    prevCount.current = unread.length;
  }, [unread]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const go = (n: Notification) => {
    if (!n.is_read) mark.mutate([n.id]);
    setOpen(false);
    if (n.link) nav(n.link);
  };

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-md p-2 hover:bg-sunken" aria-label={`Notificaciones (${unread.length})`}>
        <Bell className="size-5" />
        {unread.length > 0 && (
          <span className="num absolute top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] font-semibold text-white">
            {unread.length > 99 ? '99+' : unread.length}
          </span>
        )}
      </button>
      {open && (
        <div className="fixed inset-x-2 top-[calc(3.5rem+env(safe-area-inset-top))] z-50 max-h-[70dvh] overflow-hidden rounded-xl border border-line bg-panel shadow-pop md:absolute md:inset-x-auto md:top-11 md:right-0 md:w-[380px]">
          <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
            <span className="text-sm font-semibold">Notificaciones</span>
            {unread.length > 0 && <button className="text-xs text-muted hover:text-ink" onClick={() => mark.mutate(unread.map((n) => n.id))}>Marcar todas leídas</button>}
          </div>
          <ul className="max-h-[52dvh] divide-y divide-line overflow-y-auto">
            {data.slice(0, 12).map((n) => (
              <li key={n.id}>
                <button onClick={() => go(n)} className={cx('flex w-full gap-2.5 px-3.5 py-2.5 text-left hover:bg-paper', !n.is_read && 'bg-brand-soft/40')}>
                  <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', severityDot[n.severity])} />
                  <span className="min-w-0 flex-1">
                    <span className={cx('block text-[13px] leading-snug', !n.is_read && 'font-semibold')}>{n.title}</span>
                    {n.body && <span className="mt-0.5 block truncate text-xs text-muted">{n.body}</span>}
                    <span className="mt-0.5 block text-[11px] text-faint">{fmtAgo(n.created_at)}</span>
                  </span>
                </button>
              </li>
            ))}
            {!data.length && <li className="px-4 py-8 text-center text-sm text-muted">Todo al día</li>}
          </ul>
          <Link to="/notificaciones" onClick={() => setOpen(false)} className="block border-t border-line py-2.5 text-center text-sm font-medium hover:bg-paper">Ver todas</Link>
        </div>
      )}
    </div>
  );
}
