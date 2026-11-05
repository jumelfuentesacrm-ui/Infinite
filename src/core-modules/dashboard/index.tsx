import { lazy } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { defineModule } from '@core/modules/types';
import { RecentActivity, CriticalAlerts } from './widgets';
import { FleetDonut } from './FleetDonut';

export default defineModule({
  id: 'dashboard',
  name: 'Dashboard',
  icon: LayoutDashboard,
  routes: [{ path: '/dashboard', component: lazy(() => import('./DashboardPage')), perm: 'fleet.view' }],
  nav: [{ to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, perm: 'fleet.view', group: 'principal', order: 0 }],
  // Qué widgets se muestran se puede limitar por cliente: client.config.json → "dashboard": { "widgets": [...] }
  dashboard: [
    { id: 'fleet-donut', component: FleetDonut, size: 'full', order: 0, perm: 'fleet.view' },
    { id: 'alerts', component: CriticalAlerts, size: 'half', order: 11 },
    { id: 'activity', component: RecentActivity, size: 'half', order: 90, perm: 'fleet.view' },
  ],
});
