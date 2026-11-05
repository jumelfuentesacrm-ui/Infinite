import { lazy } from 'react';
import { GitPullRequest, Settings } from 'lucide-react';
import { defineModule } from '@core/modules/types';

export default defineModule({
  id: 'settings',
  name: 'Configuración',
  icon: Settings,
  routes: [
    { path: '/ajustes', component: lazy(() => import('./SettingsPage')), perm: 'settings.view' },
    // Solicitudes de cambio: solo el administrador (settings.manage)
    { path: '/solicitudes', component: lazy(() => import('./RequestsPage')), perm: 'settings.manage' },
  ],
  nav: [
    { to: '/solicitudes', label: 'Solicitudes', icon: GitPullRequest, perm: 'settings.manage', group: 'administracion', order: 80 },
    { to: '/ajustes', label: 'Configuración', icon: Settings, perm: 'settings.view', group: 'administracion', order: 90 },
  ],
  entityLinks: { change_request: () => '/solicitudes' },
});
