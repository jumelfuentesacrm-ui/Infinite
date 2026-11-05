import { FileText } from 'lucide-react';
import { contribute, defineModule, lazyExport } from '@core/modules/types';

const pages = () => import('./pages');

export default defineModule({
  id: 'documents',
  name: 'Documentos',
  icon: FileText,
  routes: [
    { path: '/documentos', component: lazyExport(pages, 'DocumentsPage'), perm: 'documents.view' },
    { path: '/documentos/:id', component: lazyExport(pages, 'DocumentDetail'), perm: ['documents.view', 'documents.view_own'] },
  ],
  nav: [{ to: '/documentos', label: 'Documentos', icon: FileText, perm: 'documents.view', group: 'flota', order: 50 }],
  dashboard: [{ id: 'docs-kpi', component: lazyExport(pages, 'ExpiringKpi'), size: 'kpi', perm: 'documents.view', order: 10 }],
  slots: [
    contribute('vehicle.tabs', { id: 'documents', label: 'Documentos', perm: ['documents.view', 'documents.view_own'], order: 70, component: lazyExport(pages, 'VehicleDocsTab') }),
    contribute('employee.tabs', { id: 'documents', label: 'Documentos', perm: 'documents.view', order: 70, component: lazyExport(pages, 'EmployeeDocsTab') }),
  ],
  entityLinks: { document: (id) => `/documentos/${id}` },
});
