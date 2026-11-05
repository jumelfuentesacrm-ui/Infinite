import { lazy } from 'react';
import { Users } from 'lucide-react';
import { defineModule } from '@core/modules/types';

export default defineModule({
  id: 'employees',
  name: 'Empleados',
  icon: Users,
  routes: [
    { path: '/empleados', component: lazy(() => import('./EmployeesPage')), perm: 'employees.view' },
    { path: '/empleados/:id', component: lazy(() => import('./EmployeeDetail')), perm: 'employees.view' },
    { path: '/perfil', component: lazy(() => import('./ProfilePage')) },
  ],
  nav: [{ to: '/empleados', label: 'Empleados', icon: Users, perm: 'employees.view', group: 'administracion', order: 10 }],
});
