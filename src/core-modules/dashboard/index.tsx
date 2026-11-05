import { lazy } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { defineModule } from '@core/modules/types';
import { FleetKpis, FleetStatusPanel, RecentActivity, CriticalAlerts } from './widgets';

export default defineModule({
  id: 'dashboard',
  name: 'Dashboard',
  icon: LayoutDashboard,
  routes: [{ path: '/dashboard', component: lazy(() => import('./DashboardPage')), perm: 'fleet.view' }],
  nav: [{ to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, perm: 'fleet.view', group: 'principal', order: 0 }],
  dashboard: [
    { id: 'fleet-kpis', component: FleetKpis, size: 'kpi', order: 0, perm: 'fleet.view' },
    { id: 'fleet-status', component: FleetStatusPanel, size: 'half', order: 10, perm: 'fleet.view' },
    { id: 'alerts', component: CriticalAlerts, size: 'half', order: 11 },
    { id: 'activity', component: RecentActivity, size: 'half', order: 90, perm: 'fleet.view' },
  ],
});
