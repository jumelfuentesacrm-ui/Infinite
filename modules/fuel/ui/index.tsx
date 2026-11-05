import { Fuel } from 'lucide-react';
import { contribute, defineModule, lazyExport } from '@core/modules/types';

const pages = () => import('./pages');

export default defineModule({
  id: 'fuel',
  name: 'Combustible',
  icon: Fuel,
  routes: [
    { path: '/combustible', component: lazyExport(pages, 'FuelPage'), perm: 'fuel.view' },
    { path: '/combustible/nuevo', component: lazyExport(pages, 'FuelForm'), perm: 'fuel.create' },
    { path: '/m/combustible', component: lazyExport(pages, 'FuelForm'), perm: 'fuel.create' },
  ],
  nav: [{ to: '/combustible', label: 'Combustible', icon: Fuel, perm: 'fuel.view', group: 'flota', order: 40 }],
  fieldActions: [{ to: '/m/combustible', label: 'Registrar gasolina', description: 'Compra y recibo', icon: Fuel, perm: 'fuel.create', order: 6 }],
  slots: [
    contribute('vehicle.tabs', { id: 'fuel', label: 'Combustible', perm: 'fuel.view', order: 40, component: lazyExport(pages, 'VehicleFuelTab') }),
    contribute('employee.tabs', { id: 'fuel', label: 'Combustible', perm: 'fuel.view', order: 40, component: lazyExport(pages, 'EmployeeFuelTab') }),
  ],
  reports: [{ id: 'fuel', title: 'Consumo de combustible', description: 'Galones y costo por vehículo y mes', perm: 'fuel.view', component: lazyExport(pages, 'FuelReport') }],
  entityLinks: { fuel_log: () => '/combustible' },
});
