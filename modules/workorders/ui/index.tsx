import { Wrench, MessageSquareWarning } from 'lucide-react';
import { contribute, defineModule, lazyExport } from '@core/modules/types';

const pages = () => import('./pages');
const create = () => import('./CreateWorkOrder');

export default defineModule({
  id: 'workorders',
  name: 'Taller',
  icon: Wrench,
  routes: [
    { path: '/taller', component: lazyExport(pages, 'ShopHome'), perm: 'workorders.view' },
    { path: '/taller/:id', component: lazyExport(pages, 'WorkOrderDetail'), perm: ['workorders.view', 'workorders.report'] },
    { path: '/m/problema', component: lazyExport(create, 'ReportProblem'), perm: 'workorders.report' },
  ],
  // Sin PIN: quien deja una unidad en el taller reporta qué le pasó (ver db/zz_public_report.sql)
  publicRoutes: [{ path: '/reportar', label: 'Reportar problema sin PIN', icon: Wrench, component: lazyExport(() => import('./PublicReport'), 'PublicReport') }],
  nav: [{ to: '/taller', label: 'Órdenes de trabajo', icon: Wrench, perm: 'workorders.view', group: 'taller', order: 0, mobile: true }],
  fieldActions: [{ to: '/m/problema', label: 'Reportar problema', description: 'Falla mecánica', icon: MessageSquareWarning, perm: 'workorders.report', order: 5 }],
  dashboard: [
    { id: 'wo-kpi', component: lazyExport(pages, 'OpenOrdersKpi'), size: 'kpi', perm: 'workorders.view', order: 7 },
    { id: 'wo-pending', component: lazyExport(pages, 'PendingRepairsWidget'), size: 'half', perm: 'workorders.view', order: 25 },
  ],
  slots: [
    contribute('vehicle.tabs', { id: 'workorders', label: 'Órdenes de trabajo', perm: 'workorders.view', order: 30, component: lazyExport(pages, 'VehicleWorkOrdersTab') }),
    contribute('vehicle.actions', { id: 'wo-create', perm: 'workorders.create', order: 10, component: lazyExport(create, 'FromVehicle') }),
    contribute('inspection.actions', { id: 'wo-from-inspection', perm: 'workorders.create', component: lazyExport(create, 'FromInspection') }),
    contribute('incident.actions', { id: 'wo-from-incident', perm: 'workorders.create', component: lazyExport(create, 'FromIncident') }),
  ],
  reports: [
    { id: 'mechanics', title: 'Actividad de los mecánicos', description: 'Órdenes, horas y mano de obra por mecánico y mes', perm: 'settings.manage', component: lazyExport(pages, 'MechanicActivityReport') },
    { id: 'repairs', title: 'Reparaciones por vehículo', description: 'Órdenes, horas y costo acumulado por unidad', perm: 'inventory.view_costs', component: lazyExport(pages, 'RepairsByVehicleReport') },
  ],
  entityLinks: { work_order: (id) => `/taller/${id}` },
});
