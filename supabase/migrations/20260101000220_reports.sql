-- @generated por scripts/modules.mjs — edite el archivo fuente, no este.
-- =============================================================================
-- MÓDULO · Reportes y analíticas
-- Depende de: core. Los reportes de cada dominio viven en su módulo (vistas);
-- aquí están el permiso general y los reportes transversales del núcleo.
-- =============================================================================
insert into public.app_modules (id, name) values ('reports', 'Reportes') on conflict (id) do nothing;

-- Tiempo fuera de servicio por vehículo en un rango (desde el historial de estados)
create or replace function public.report_downtime(p_from timestamptz, p_to timestamptz)
returns table (vehicle_id uuid, unit_number text, model text, status text, hours numeric)
language sql stable security definer set search_path = public as $$
  with h as (
    select s.vehicle_id, s.to_status, s.changed_at,
           coalesce(lead(s.changed_at) over (partition by s.vehicle_id order by s.changed_at, s.id), now()) as until
      from public.vehicle_status_history s)
  select v.id, v.unit_number, m.manufacturer || ' ' || m.model || coalesce(' ' || m.year, ''), h.to_status,
         round(sum(extract(epoch from (least(h.until, p_to) - greatest(h.changed_at, p_from)))) / 3600.0, 1)
    from h join public.vehicles v on v.id = h.vehicle_id join public.vehicle_models m on m.id = v.model_id
   where app.has_perm('reports.view') and app.has_perm('fleet.view')
     and h.to_status in ('maintenance','repair','out_of_service')
     and h.until > p_from and h.changed_at < p_to
   group by v.id, v.unit_number, m.manufacturer, m.model, m.year, h.to_status
   order by 5 desc;
$$;

-- Costos operacionales por vehículo y módulo (fuente: línea de tiempo, alimentada por cada módulo)
create or replace function public.report_costs(p_from timestamptz, p_to timestamptz)
returns table (vehicle_id uuid, unit_number text, module_id text, events bigint, labor_hours numeric, cost numeric)
language sql stable security definer set search_path = public as $$
  select t.vehicle_id, v.unit_number, t.module_id, count(*), coalesce(sum(t.labor_hours),0), coalesce(sum(t.cost),0)
    from public.vehicle_timeline t join public.vehicles v on v.id = t.vehicle_id
   where app.has_perm('reports.view') and app.has_perm('fleet.view')
     and t.occurred_at >= p_from and t.occurred_at < p_to and t.cost is not null
   group by t.vehicle_id, v.unit_number, t.module_id
   order by 6 desc;
$$;

-- Disponibilidad actual de la flota
create or replace view public.report_fleet_status with (security_invoker = true) as
  select v.status, m.manufacturer, m.model, m.year, count(*) as vehicles
    from public.vehicles v join public.vehicle_models m on m.id = v.model_id
   where v.archived_at is null
   group by v.status, m.manufacturer, m.model, m.year;

insert into public.permissions (id, module_id, action, label, sort) values
  ('reports.view',   'reports', 'view',   'Ver reportes (según permisos de cada módulo)', 1),
  ('reports.export', 'reports', 'export', 'Exportar reportes a PDF / Excel', 2)
on conflict (id) do nothing;
insert into public.role_permissions values ('supervisor','reports.view'), ('supervisor','reports.export')
on conflict do nothing;
