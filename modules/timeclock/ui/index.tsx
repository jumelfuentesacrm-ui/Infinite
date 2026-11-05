import { Clock } from 'lucide-react';
import { contribute, defineModule, lazyExport } from '@core/modules/types';

const pages = () => import('./pages');

export default defineModule({
  id: 'timeclock',
  name: 'Ponches',
  icon: Clock,
  routes: [
    { path: '/ponches', component: lazyExport(pages, 'TimeclockAdmin'), perm: 'timeclock.view' },
    { path: '/ponches/correcciones', component: lazyExport(pages, 'TimeclockAdmin'), perm: 'timeclock.view' },
    { path: '/m/ponches', component: lazyExport(pages, 'PunchPage'), perm: 'timeclock.punch' },
  ],
  nav: [
    { to: '/ponches', label: 'Ponches', icon: Clock, perm: 'timeclock.view', group: 'operaciones', order: 30 },
    { to: '/m/ponches', label: 'Ponchar', icon: Clock, perm: 'timeclock.punch', group: 'principal', order: 3, mobile: true },
  ],
  fieldActions: [{ to: '/m/ponches', label: 'Ponchar', description: 'Entrada, salida, descanso', icon: Clock, perm: 'timeclock.punch', order: 2 }],
  dashboard: [{ id: 'onshift', component: lazyExport(pages, 'OnShiftKpi'), size: 'kpi', perm: 'timeclock.view', order: 4 }],
  slots: [contribute('employee.tabs', { id: 'timeclock', label: 'Ponches', perm: 'timeclock.view', order: 20, component: lazyExport(pages, 'EmployeePunchesTab') })],
  settings: [{ id: 'timeclock', title: 'Ponches', perm: 'settings.view', component: lazyExport(pages, 'GeofencePanel') }],
});
