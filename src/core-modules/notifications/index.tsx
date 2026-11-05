import { lazy } from 'react';
import { Bell } from 'lucide-react';
import { defineModule } from '@core/modules/types';

export default defineModule({
  id: 'notifications',
  name: 'Notificaciones',
  icon: Bell,
  routes: [{ path: '/notificaciones', component: lazy(() => import('./NotificationsPage')), perm: 'notifications.view' }],
});
