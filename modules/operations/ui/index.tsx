import { CalendarDays, CalendarCheck } from 'lucide-react';
import { defineModule, lazyExport } from '@core/modules/types';

const pages = () => import('./pages');

export default defineModule({
  id: 'operations',
  name: 'Operaciones',
  icon: CalendarDays,
  routes: [
    { path: '/operaciones', component: lazyExport(pages, 'CalendarPage'), perm: 'operations.view' },
    { path: '/m/asignaciones', component: lazyExport(pages, 'MyAssignments'), perm: 'operations.view_own' },
  ],
  nav: [
    { to: '/operaciones', label: 'Operaciones', icon: CalendarDays, perm: 'operations.view', group: 'operaciones', order: 0, mobile: true },
    { to: '/m/asignaciones', label: 'Mis asignaciones', icon: CalendarCheck, perm: 'operations.view_own', group: 'principal', order: 2 },
  ],
  fieldActions: [{ to: '/m/asignaciones', label: 'Mi horario', description: 'Asignaciones', icon: CalendarCheck, perm: 'operations.view_own', order: 3 }],
  dashboard: [
    { id: 'ops-kpi', component: lazyExport(pages, 'ActiveOpsKpi'), size: 'kpi', perm: 'operations.view', order: 3 },
    { id: 'ops-today', component: lazyExport(pages, 'TodayOperations'), size: 'half', perm: 'operations.view', order: 20 },
  ],
  entityLinks: { operation: () => '/operaciones' },
});
