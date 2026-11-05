import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellRing, CheckCheck } from 'lucide-react';
import { Button, Card, EmptyState, PageHeader, QueryView, Segmented, cx } from '@core/ui/primitives';
import { fmtDateTime } from '@core/lib/format';
import { useMarkRead, useNotifications } from './data';
import { severityDot } from './Bell';

export default function NotificationsPage() {
  const [filter, setFilter] = useState<'all' | 'unread'>('unread');
  const q = useNotifications(200, filter === 'unread');
  const mark = useMarkRead();
  const nav = useNavigate();
  const canPush = 'Notification' in window && window.Notification.permission === 'default';

  return (
    <>
      <PageHeader title="Notificaciones" actions={<>
        {canPush && <Button size="sm" icon={BellRing} onClick={() => window.Notification.requestPermission()}>Activar avisos</Button>}
        <Button size="sm" icon={CheckCheck} onClick={() => q.data && mark.mutate(q.data.filter((n) => !n.is_read).map((n) => n.id))}>Marcar leídas</Button>
      </>} />
      <div className="mb-3"><Segmented value={filter} onChange={setFilter} options={[{ id: 'unread', label: 'Sin leer' }, { id: 'all', label: 'Todas' }]} /></div>
      <Card pad={false}>
        <QueryView q={q} empty={<EmptyState title="No hay notificaciones" />}>
          {(rows) => (
            <ul className="divide-y divide-line">
              {rows.map((n) => (
                <li key={n.id}>
                  <button onClick={() => { if (!n.is_read) mark.mutate([n.id]); if (n.link) nav(n.link); }}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-paper">
                    <span className={cx('mt-1.5 size-2.5 shrink-0 rounded-full', severityDot[n.severity])} />
                    <span className="min-w-0 flex-1">
                      <span className={cx('block text-sm', !n.is_read && 'font-semibold')}>{n.title}</span>
                      {n.body && <span className="block text-[13px] text-muted">{n.body}</span>}
                    </span>
                    <time className="num shrink-0 text-xs text-faint">{fmtDateTime(n.created_at)}</time>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </QueryView>
      </Card>
    </>
  );
}
