import { Boxes } from 'lucide-react';
import { contribute, defineModule, lazyExport } from '@core/modules/types';

const pages = () => import('./pages');

export default defineModule({
  id: 'inventory',
  name: 'Inventario',
  icon: Boxes,
  routes: [
    { path: '/inventario', component: lazyExport(pages, 'InventoryPage'), perm: 'inventory.view' },
    { path: '/inventario/compras', component: lazyExport(pages, 'PurchasesPage'), perm: ['inventory.view', 'inventory.request'] },
    { path: '/inventario/proveedores', component: lazyExport(pages, 'SuppliersPage'), perm: 'inventory.view' },
    { path: '/inventario/:id', component: lazyExport(pages, 'ItemDetail'), perm: 'inventory.view' },
  ],
  nav: [{ to: '/inventario', label: 'Inventario', icon: Boxes, perm: 'inventory.view', group: 'taller', order: 10, mobile: true }],
  dashboard: [{ id: 'low-stock', component: lazyExport(pages, 'LowStockKpi'), size: 'kpi', perm: 'inventory.view', order: 9 }],
  slots: [contribute('workorder.parts', { id: 'inventory-picker', perm: 'inventory.view', order: 10, component: lazyExport(pages, 'InventoryPartPicker') })],
  reports: [
    { id: 'stock', title: 'Inventario actual y piezas agotadas', description: 'Existencias, disponibles, mínimos y valor', perm: 'inventory.view', component: lazyExport(pages, 'StockReport') },
    { id: 'parts-usage', title: 'Uso y desgaste de piezas', description: 'Piezas gastadas de más a menos usos por periodo, siempre con el acumulado del año (YTD)', perm: 'inventory.usage_report', component: lazyExport(pages, 'UsageReport') },
    { id: 'top-parts', title: 'Piezas más utilizadas', description: 'Consumo acumulado por pieza', perm: 'inventory.view', component: lazyExport(pages, 'TopPartsReport') },
  ],
  entityLinks: { inventory_item: (id) => `/inventario/${id}`, purchase_request: () => '/inventario/compras' },
});
