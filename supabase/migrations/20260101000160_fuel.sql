-- @generated por scripts/modules.mjs — edite el archivo fuente, no este.
-- =============================================================================
-- MÓDULO · Control de combustible
-- Depende de: core.
-- =============================================================================
insert into public.app_modules (id, name) values ('fuel', 'Combustible') on conflict (id) do nothing;

create table public.fuel_logs (
  id           uuid primary key default gen_random_uuid(),
  vehicle_id   uuid not null references public.vehicles(id),
  employee_id  uuid not null references public.employees(id) default app.current_employee_id(),
  purchased_at timestamptz not null default now(),
  quantity     numeric(10,3) not null check (quantity > 0),
  unit         text not null default 'gal' check (unit in ('gal','l')),
  amount       numeric(10,2) not null check (amount >= 0),
  fuel_type    text check (fuel_type in ('regular','premium','diesel','mixed','other')),
  station      text,
  engine_hours numeric(10,1),
  mileage      numeric(10,1),
  notes        text,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  updated_at   timestamptz not null default now(),
  updated_by   uuid
);
create index fuel_logs_vehicle_idx on public.fuel_logs(vehicle_id, purchased_at desc);
create index fuel_logs_employee_idx on public.fuel_logs(employee_id, purchased_at desc);

create or replace function app.fuel_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.purchased_at > now() + interval '5 minutes' then
    raise exception 'La fecha de compra no puede estar en el futuro' using errcode = '22023';
  end if;
  perform app.record_meter(new.vehicle_id, new.engine_hours, new.mileage, 'fuel', new.id);
  perform app.timeline_add(new.vehicle_id, 'fuel', 'fuel',
    'Combustible: ' || new.quantity || ' ' || new.unit, 'fuel_log', new.id,
    jsonb_build_object('amount', new.amount), new.amount, null, new.purchased_at, new.employee_id);
  return new;
end $$;
create trigger fuel_logs_after_insert after insert on public.fuel_logs
  for each row execute function app.fuel_after_insert();

create or replace view public.fuel_summary_by_vehicle with (security_invoker = true) as
  select f.vehicle_id, v.unit_number, date_trunc('month', f.purchased_at)::date as month,
         count(*) as fills,
         sum(case when f.unit = 'l' then f.quantity / 3.785411784 else f.quantity end)::numeric(12,2) as gallons,
         sum(f.amount)::numeric(12,2) as total_amount
    from public.fuel_logs f join public.vehicles v on v.id = f.vehicle_id
   where f.archived_at is null
   group by f.vehicle_id, v.unit_number, date_trunc('month', f.purchased_at);

insert into public.permissions (id, module_id, action, label, sort) values
  ('fuel.view',     'fuel', 'view',     'Ver todo el historial de combustible', 1),
  ('fuel.view_own', 'fuel', 'view_own', 'Ver sus registros', 2),
  ('fuel.create',   'fuel', 'create',   'Registrar compras de combustible', 3),
  ('fuel.edit',     'fuel', 'edit',     'Corregir / archivar registros', 4)
on conflict (id) do nothing;
insert into public.role_permissions values
  ('supervisor','fuel.view'), ('supervisor','fuel.view_own'), ('supervisor','fuel.create'), ('supervisor','fuel.edit'),
  ('driver','fuel.view_own'), ('driver','fuel.create')
on conflict do nothing;

alter table public.fuel_logs enable row level security;
create policy fuel_read on public.fuel_logs for select to authenticated
  using ((select app.has_perm('fuel.view'))
      or (employee_id = (select app.current_employee_id()) and (select app.has_perm('fuel.view_own'))));
create policy fuel_insert on public.fuel_logs for insert to authenticated
  with check ((select app.has_perm('fuel.create')) and app.can_see_vehicle(vehicle_id)
              and (employee_id = (select app.current_employee_id()) or (select app.has_perm('fuel.edit'))));
create policy fuel_update on public.fuel_logs for update to authenticated
  using ((select app.has_perm('fuel.edit'))) with check ((select app.has_perm('fuel.edit')));

do $$ begin perform app.track('public.fuel_logs'); end $$;
