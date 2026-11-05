import { MapPinned } from 'lucide-react';
import { contribute, defineModule, lazyExport } from '@core/modules/types';

const pages = () => import('./pages');

export default defineModule({
  id: 'gps',
  name: 'GPS',
  icon: MapPinned,
  routes: [{ path: '/gps', component: lazyExport(pages, 'MapPage'), perm: 'gps.view' }],
  nav: [{ to: '/gps', label: 'Mapa GPS', icon: MapPinned, perm: 'gps.view', group: 'flota', order: 20, mobile: true }],
  dashboard: [{ id: 'gps-map', component: lazyExport(pages, 'MapWidget'), size: 'half', perm: 'gps.view', order: 12 }],
  slots: [
    contribute('vehicle.tabs', { id: 'gps', label: 'Ubicación', perm: 'gps.view', order: 60, component: lazyExport(pages, 'VehicleLocationTab') }),
    contribute('field.vehicle', { id: 'gps-share', perm: 'gps.report', component: lazyExport(pages, 'ShareLocation') }),
  ],
  settings: [{ id: 'gps-devices', title: 'Dispositivos GPS', perm: 'gps.view', component: lazyExport(pages, 'DevicesPanel') }],
});
