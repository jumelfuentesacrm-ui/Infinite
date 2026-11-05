-- @generated por scripts/modules.mjs — edite el archivo fuente, no este.
-- =============================================================================
-- MÓDULO · Accidentes e incidentes
-- Depende de: core. Expediente permanente con estado de seguimiento.
-- =============================================================================
insert into public.app_modules (id, name) values ('accidents', 'Accidentes') on conflict (id) do nothing;

create sequence public.incident_number_seq;

create table public.incidents (
  id             uuid primary key default gen_random_uuid(),
  incident_number text not null unique default ('INC-' || lpad(nextval('public.incident_number_seq')::text, 5, '0')),
  incident_type  text not null check (incident_type in
                   ('collision','rollover','injury','property_damage','near_miss','mechanical_failure','theft','other')),
  severity       text not null default 'minor' check (severity in ('minor','moderate','major','critical')),
  vehicle_id     uuid references public.vehicles(id),
  reported_by    uuid not null references public.employees(id),
  occurred_at    timestamptz not null,
  lat            double precision,
  lng            double precision,
  location_text  text,
  description    text not null check (length(trim(description)) > 3),
  observations   text,
  injuries       boolean not null default false,
  vehicle_operable boolean,
  status         text not null default 'reported' check (status in ('reported','in_review','investigating','resolved','closed')),
  resolution     text,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  updated_at     timestamptz not null default now(),
  updated_by     uuid
);
create index incidents_vehicle_idx on public.incidents(vehicle_id, occurred_at desc);
create index incidents_status_idx on public.incidents(status);

create table public.incident_people (
  id          uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id),
  full_name   text not null,
  role        text not null default 'other' check (role in ('driver','passenger','witness','third_party','other')),
  phone       text,
  injured     boolean not null default false,
  notes       text
);

create table public.incident_status_history (
  id          bigint generated always as identity primary key,
  incident_id uuid not null references public.incidents(id),
  from_status text,
  to_status   text not null,
  notes       text,
  changed_by  uuid references public.employees(id),
  changed_at  timestamptz not null default now()
);

-- p: {incident_type, severity, vehicle_id?, occurred_at?, lat, lng, location_text, description,
--     observations, injuries, vehicle_operable, people:[{full_name, role, phone, injured, notes}]}
create or replace function public.report_incident(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := app.current_employee_id(); v_vehicle uuid; v_id uuid; v_num text; v_unit text;
begin
  perform app.require_perm('accidents.report');
  v_vehicle := coalesce(nullif(p->>'vehicle_id','')::uuid,
    (select vehicle_id from public.vehicle_assignments where employee_id = v_emp and ended_at is null));
  if v_vehicle is not null and not app.can_see_vehicle(v_vehicle) then
    raise exception 'No tiene acceso a este vehículo' using errcode = '42501';
  end if;

  insert into public.incidents(incident_type, severity, vehicle_id, reported_by, occurred_at, lat, lng, location_text,
                               description, observations, injuries, vehicle_operable)
  values (p->>'incident_type', coalesce(p->>'severity','minor'), v_vehicle, v_emp,
          least(coalesce((p->>'occurred_at')::timestamptz, now()), now()),
          (p->>'lat')::float8, (p->>'lng')::float8, p->>'location_text', p->>'description', p->>'observations',
          coalesce((p->>'injuries')::boolean, false), (p->>'vehicle_operable')::boolean)
  returning id, incident_number into v_id, v_num;

  insert into public.incident_people(incident_id, full_name, role, phone, injured, notes)
  select v_id, x->>'full_name', coalesce(x->>'role','other'), x->>'phone', coalesce((x->>'injured')::boolean,false), x->>'notes'
    from jsonb_array_elements(coalesce(p->'people','[]')) x where coalesce(x->>'full_name','') <> '';

  insert into public.incident_status_history(incident_id, to_status, changed_by) values (v_id, 'reported', v_emp);

  if v_vehicle is not null then
    select unit_number into v_unit from public.vehicles where id = v_vehicle;
    perform app.timeline_add(v_vehicle, 'accidents', 'incident', 'Incidente ' || v_num || ' reportado',
      'incident', v_id, jsonb_build_object('type', p->>'incident_type', 'severity', coalesce(p->>'severity','minor')));
    if (p->>'vehicle_operable')::boolean is false then
      update public.vehicles set status = 'out_of_service', status_reason = 'Incidente ' || v_num where id = v_vehicle;
    end if;
  end if;

  perform app.notify(array['admin','supervisor'], 'accidents', 'incident_reported',
    'Incidente ' || v_num || coalesce(' · ' || v_unit, ''),
    left(p->>'description', 160), '/incidentes/' || v_id,
    case when coalesce((p->>'injuries')::boolean,false) or p->>'severity' in ('major','critical') then 'critical' else 'warning' end,
    'incident', v_id);
  return jsonb_build_object('id', v_id, 'incident_number', v_num);
end $$;

create or replace function public.set_incident_status(p_id uuid, p_status text, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  perform app.require_perm('accidents.edit');
  select status into v_old from public.incidents where id = p_id for update;
  if v_old is null then raise exception 'Incidente no encontrado' using errcode = 'P0002'; end if;
  if v_old = 'closed' and not app.has_perm('accidents.manage') then
    raise exception 'El incidente está cerrado' using errcode = '42501';
  end if;
  update public.incidents set status = p_status,
         resolution = case when p_status in ('resolved','closed') then coalesce(p_notes, resolution) else resolution end
   where id = p_id;
  insert into public.incident_status_history(incident_id, from_status, to_status, notes, changed_by)
  values (p_id, v_old, p_status, p_notes, app.current_employee_id());
end $$;

insert into public.permissions (id, module_id, action, label, sort) values
  ('accidents.view',     'accidents', 'view',     'Ver todos los incidentes', 1),
  ('accidents.view_own', 'accidents', 'view_own', 'Ver sus reportes', 2),
  ('accidents.report',   'accidents', 'report',   'Reportar incidentes', 3),
  ('accidents.edit',     'accidents', 'edit',     'Dar seguimiento y cambiar estado', 4),
  ('accidents.manage',   'accidents', 'manage',   'Reabrir incidentes cerrados', 5)
on conflict (id) do nothing;
insert into public.role_permissions values
  ('supervisor','accidents.view'), ('supervisor','accidents.view_own'), ('supervisor','accidents.report'), ('supervisor','accidents.edit'),
  ('driver','accidents.view_own'), ('driver','accidents.report'),
  ('mechanic','accidents.view_own'), ('mechanic','accidents.report')
on conflict do nothing;

alter table public.incidents               enable row level security;
alter table public.incident_people         enable row level security;
alter table public.incident_status_history enable row level security;
create policy incidents_read on public.incidents for select to authenticated
  using ((select app.has_perm('accidents.view'))
      or (reported_by = (select app.current_employee_id()) and (select app.has_perm('accidents.view_own'))));
create policy incidents_update on public.incidents for update to authenticated
  using ((select app.has_perm('accidents.edit'))) with check ((select app.has_perm('accidents.edit')));
create policy incident_people_read on public.incident_people for select to authenticated
  using (exists (select 1 from public.incidents i where i.id = incident_id));
create policy incident_people_insert on public.incident_people for insert to authenticated
  with check ((select app.has_perm('accidents.edit')));
create policy incident_history_read on public.incident_status_history for select to authenticated
  using (exists (select 1 from public.incidents i where i.id = incident_id));
revoke insert on public.incidents, public.incident_status_history from authenticated;
revoke update on public.incident_status_history, public.incident_people from authenticated;
-- El estado solo cambia por set_incident_status (deja historial)
revoke update on public.incidents from authenticated;
grant update (observations, severity, location_text) on public.incidents to authenticated;

do $$ begin
  perform app.track('public.incidents');
  perform app.track('public.incident_people', false);
end $$;
