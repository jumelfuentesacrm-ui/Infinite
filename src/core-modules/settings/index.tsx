import { lazy } from 'react';
import { Settings } from 'lucide-react';
import { defineModule } from '@core/modules/types';

export default defineModule({
  id: 'settings',
  name: 'Configuración',
  icon: Settings,
  routes: [{ path: '/ajustes', component: lazy(() => import('./SettingsPage')), perm: 'settings.view' }],
  nav: [{ to: '/ajustes', label: 'Configuración', icon: Settings, perm: 'settings.view', group: 'administracion', order: 90 }],
});
