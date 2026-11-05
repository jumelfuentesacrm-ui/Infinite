import { lazy } from 'react';
import { Truck, Shapes } from 'lucide-react';
import { defineModule } from '@core/modules/types';

export default defineModule({
  id: 'fleet',
  name: 'Flota',
  icon: Truck,
  routes: [
    { path: '/flota', component: lazy(() => import('./VehiclesPage')), perm: 'fleet.view' },
    { path: '/flota/modelos', component: lazy(() => import('./ModelsPage')), perm: 'fleet.view' },
    { path: '/flota/:id', component: lazy(() => import('./VehicleDetail')), perm: ['fleet.view', 'fleet.view_own'] },
  ],
  nav: [
    { to: '/flota', label: 'Vehículos', icon: Truck, perm: 'fleet.view', group: 'flota', order: 10, mobile: true },
    { to: '/flota/modelos', label: 'Modelos', icon: Shapes, perm: 'fleet.manage', group: 'administracion', order: 30 },
  ],
});
