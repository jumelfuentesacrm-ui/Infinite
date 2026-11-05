import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { contribute, defineModule, lazyExport } from '@core/modules/types';

const pages = () => import('./pages');

export default defineModule({
  id: 'accidents',
  name: 'Accidentes',
  icon: ShieldAlert,
  routes: [
    { path: '/incidentes', component: lazyExport(pages, 'IncidentsPage'), perm: ['accidents.view', 'accidents.view_own'] },
    { path: '/incidentes/nuevo', component: lazyExport(pages, 'ReportIncident'), perm: 'accidents.report' },
    { path: '/incidentes/:id', component: lazyExport(pages, 'IncidentDetail'), perm: ['accidents.view', 'accidents.view_own'] },
    { path: '/m/incidente', component: lazyExport(pages, 'ReportIncident'), perm: 'accidents.report' },
  ],
  nav: [{ to: '/incidentes', label: 'Accidentes', icon: ShieldAlert, perm: ['accidents.view', 'accidents.view_own'], group: 'operaciones', order: 40 }],
  fieldActions: [{ to: '/m/incidente', label: 'Reportar accidente', description: 'Incidente o choque', icon: AlertTriangle, perm: 'accidents.report', tone: 'danger', order: 4 }],
  dashboard: [{ id: 'incidents-kpi', component: lazyExport(pages, 'OpenIncidentsKpi'), size: 'kpi', perm: 'accidents.view', order: 8 }],
  slots: [
    contribute('shell.quick', { id: 'quick-accident', perm: 'accidents.report', component: lazyExport(pages, 'QuickReportButton') }),
    contribute('vehicle.tabs', { id: 'incidents', label: 'Accidentes', perm: 'accidents.view', order: 50, component: lazyExport(pages, 'VehicleIncidentsTab') }),
  ],
  entityLinks: { incident: (id) => `/incidentes/${id}` },
});
