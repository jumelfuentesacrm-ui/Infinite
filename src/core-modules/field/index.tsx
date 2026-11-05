import { lazy } from 'react';
import { Smartphone } from 'lucide-react';
import { defineModule } from '@core/modules/types';

export default defineModule({
  id: 'field',
  name: 'Panel de campo',
  icon: Smartphone,
  routes: [{ path: '/m', component: lazy(() => import('./FieldHome')) }],
  nav: [{ to: '/m', label: 'Mi panel', icon: Smartphone, group: 'principal', order: 1 }],
});
