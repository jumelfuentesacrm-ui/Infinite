import { BarChart3 } from 'lucide-react';
import { defineModule, lazyExport } from '@core/modules/types';

const pages = () => import('./pages');

/** El módulo de reportes reúne los reportes del núcleo y los que aporta cada módulo activo. */
export default defineModule({
  id: 'reports',
  name: 'Reportes',
  icon: BarChart3,
  routes: [
    { path: '/reportes', component: lazyExport(pages, 'ReportsPage'), perm: 'reports.view' },
    { path: '/reportes/:id', component: lazyExport(pages, 'ReportView'), perm: 'reports.view' },
  ],
  nav: [{ to: '/reportes', label: 'Reportes', icon: BarChart3, perm: 'reports.view', group: 'administracion', order: 0 }],
});
