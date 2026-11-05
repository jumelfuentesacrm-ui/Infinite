import { lazy } from 'react';
import { BookOpen } from 'lucide-react';
import { contribute, defineModule, lazyExport } from '@core/modules/types';

const pages = () => import('./pages');

export default defineModule({
  id: 'parts_catalog',
  name: 'Catálogo OEM',
  icon: BookOpen,
  routes: [
    { path: '/catalogo', component: lazyExport(pages, 'CatalogPage'), perm: 'parts_catalog.view' },
    { path: '/catalogo/manuales', component: lazyExport(pages, 'ManualsPage'), perm: 'parts_catalog.view' },
    { path: '/catalogo/importar', component: lazy(() => import('./ImportPage')), perm: 'parts_catalog.import' },
  ],
  nav: [{ to: '/catalogo', label: 'Catálogo OEM', icon: BookOpen, perm: 'parts_catalog.view', group: 'taller', order: 15 }],
  slots: [contribute('workorder.parts', { id: 'catalog-picker', perm: 'parts_catalog.view', order: 20, component: lazyExport(pages, 'CatalogPartPicker') })],
  settings: [{ id: 'catalog-links', title: 'Vínculos OEM', perm: 'parts_catalog.link', component: lazyExport(pages, 'LinkSuggestionsPanel') }],
});
