import { lazy } from 'react';
import { ClipboardCheck, ClipboardList } from 'lucide-react';
import { contribute, defineModule, lazyExport } from '@core/modules/types';
import { StatCard } from '@core/ui/primitives';
import { useCompliance } from './data';

const pages = () => import('./pages');

function InspectionKpis() {
  const { data = [] } = useCompliance();
  const pending = data.filter((r) => !r.inspected_today).length;
  return (
    <>
      <StatCard label="Inspecciones pendientes hoy" value={pending} tone={pending ? 'warn' : 'ok'} icon={ClipboardList} to="/inspecciones" />
      <StatCard label="Inspecciones completadas hoy" value={data.length - pending} icon={ClipboardCheck} to="/inspecciones" />
    </>
  );
}

export default defineModule({
  id: 'inspections',
  name: 'Inspecciones',
  icon: ClipboardCheck,
  routes: [
    { path: '/inspecciones', component: lazyExport(pages, 'InspectionsPage'), perm: ['inspections.view', 'inspections.view_own'] },
    { path: '/inspecciones/nueva', component: lazy(() => import('./InspectionForm')), perm: 'inspections.perform' },
    { path: '/inspecciones/:id', component: lazyExport(pages, 'InspectionDetail'), perm: ['inspections.view', 'inspections.view_own'] },
    { path: '/m/inspeccion', component: lazy(() => import('./InspectionForm')), perm: 'inspections.perform' },
  ],
  nav: [{ to: '/inspecciones', label: 'Inspecciones', icon: ClipboardCheck, perm: ['inspections.view', 'inspections.view_own'], group: 'operaciones', order: 10, mobile: true }],
  fieldActions: [{ to: '/m/inspeccion', label: 'Mi inspección', description: 'Antes de operar', icon: ClipboardCheck, perm: 'inspections.perform', tone: 'primary', order: 1 }],
  dashboard: [{ id: 'inspections-kpis', component: InspectionKpis, size: 'kpi', perm: 'inspections.view', order: 5 }],
  slots: [
    contribute('vehicle.tabs', { id: 'inspections', label: 'Inspecciones', perm: ['inspections.view', 'inspections.view_own'], order: 10,
      component: lazyExport(pages, 'VehicleInspectionsTab') }),
    contribute('employee.tabs', { id: 'inspections', label: 'Inspecciones', perm: 'inspections.view', order: 10,
      component: lazyExport(pages, 'EmployeeInspectionsTab') }),
  ],
  settings: [{ id: 'inspection-templates', title: 'Plantillas de inspección', perm: 'inspections.view', component: lazy(() => import('./TemplatesPanel')) }],
  entityLinks: { inspection: (id) => `/inspecciones/${id}` },
});
