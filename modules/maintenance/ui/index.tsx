import { lazy } from 'react';
import { CalendarClock } from 'lucide-react';
import { contribute, defineModule, lazyExport } from '@core/modules/types';

const pages = () => import('./pages');

export default defineModule({
  id: 'maintenance',
  name: 'Mantenimiento',
  icon: CalendarClock,
  routes: [
    { path: '/mantenimiento', component: lazyExport(pages, 'MaintenancePage'), perm: 'maintenance.view' },
    { path: '/mantenimiento/:id', component: lazyExport(pages, 'MaintenanceDetail'), perm: 'maintenance.view' },
  ],
  nav: [{ to: '/mantenimiento', label: 'Mantenimiento', icon: CalendarClock, perm: 'maintenance.view', group: 'taller', order: 20 }],
  dashboard: [
    { id: 'maintenance-kpi', component: lazyExport(pages, 'DueKpi'), size: 'kpi', perm: 'maintenance.view', order: 6 },
    { id: 'maintenance-upcoming', component: lazyExport(pages, 'UpcomingWidget'), size: 'half', perm: 'maintenance.view', order: 30 },
  ],
  slots: [
    contribute('vehicle.tabs', { id: 'maintenance', label: 'Mantenimiento', perm: 'maintenance.view', order: 20, component: lazyExport(pages, 'VehicleMaintenanceTab') }),
    contribute('vehicle.actions', { id: 'maintenance-schedule', perm: 'maintenance.create', order: 20, component: lazyExport(pages, 'ScheduleButton') }),
  ],
  reports: [{ id: 'maintenance', title: 'Historial de mantenimiento', description: 'Mantenimientos completados con horas, responsables y costos', perm: 'maintenance.view', component: lazyExport(pages, 'MaintenanceReport') }],
  settings: [{ id: 'maintenance-intervals', title: 'Intervalos de mantenimiento', perm: 'maintenance.view', component: lazy(() => import('./IntervalsPanel')) }],
  entityLinks: { maintenance_record: (id) => `/mantenimiento/${id}` },
});
