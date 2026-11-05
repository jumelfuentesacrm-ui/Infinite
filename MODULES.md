# Cómo crear un módulo

```
modules/mi_modulo/
  module.json
  db/schema.sql
  ui/index.tsx
```

## module.json
```json
{ "id": "mi_modulo", "name": "Mi módulo", "version": "1.0.0",
  "dependsOn": [], "integratesWith": [], "migration": "20260101000300" }
```
`migration` debe ser único y mayor que el de sus dependencias.

## db/schema.sql — plantilla
```sql
insert into public.app_modules (id, name) values ('mi_modulo', 'Mi módulo') on conflict (id) do nothing;

create table public.mi_tabla (... , created_by uuid, updated_by uuid, created_at timestamptz default now(), updated_at timestamptz default now());

insert into public.permissions (id, module_id, action, label) values
  ('mi_modulo.view', 'mi_modulo', 'view', 'Ver ...'),
  ('mi_modulo.create', 'mi_modulo', 'create', 'Crear ...') on conflict do nothing;
insert into public.role_permissions values ('supervisor', 'mi_modulo.view') on conflict do nothing;

alter table public.mi_tabla enable row level security;
create policy mi_read on public.mi_tabla for select to authenticated using ((select app.has_perm('mi_modulo.view')));
create policy mi_insert on public.mi_tabla for insert to authenticated with check ((select app.has_perm('mi_modulo.create')));

do $$ begin perform app.track('public.mi_tabla'); end $$;   -- auditoría + created_by/updated_by
```
Herramientas del núcleo: `app.require_perm()`, `app.notify()`, `app.notify_employee()`,
`app.timeline_add()` (historial del vehículo), `app.record_meter()` (horas/millaje),
`alert_jobs` (alertas periódicas). Operaciones de varios pasos: una función `security definer`.

## ui/index.tsx
```tsx
import { Box } from 'lucide-react';
import { contribute, defineModule, lazyExport } from '@core/modules/types';
const pages = () => import('./pages');

export default defineModule({
  id: 'mi_modulo', name: 'Mi módulo', icon: Box,
  routes: [{ path: '/mi-modulo', component: lazyExport(pages, 'ListPage'), perm: 'mi_modulo.view' }],
  nav: [{ to: '/mi-modulo', label: 'Mi módulo', icon: Box, perm: 'mi_modulo.view', group: 'operaciones' }],
  fieldActions: [],      // accesos en el teléfono
  dashboard: [],         // widgets (kpi | half | full)
  slots: [contribute('vehicle.tabs', { id: 'mi', label: 'Mi pestaña', component: lazyExport(pages, 'VehicleTab') })],
  reports: [], settings: [], entityLinks: {},
});
```
Use solo `@core/*`: `useData`, `useAction`, `rpc`, `DataTable`, `Modal`, `Field`, `VehicleSelect`,
`Attachments`… Nunca importe otro módulo: si necesita integrarse, declare o use un slot.

Luego: `npm run modules sync && npm run build`.
