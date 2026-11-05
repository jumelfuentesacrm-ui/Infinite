-- =============================================================================
-- MÓDULO · Ponches (reloj de asistencia)
-- Depende de: core. La hora la pone el servidor; el empleado no puede editar
-- sus registros. Las correcciones requieren aprobación y quedan auditadas.
-- =============================================================================
insert into public.app_modules (id, name) values ('timeclock', 'Ponches') on conflict (id) do nothing;

-- Geocerca (fase posterior): enabled=false por defecto
insert into public.app_settings (key, value) values
  ('timeclock', '{"geofence": {"enabled": false, "lat": null, "lng": null, "radius_m": 300}, "require_location": true}')
on conflict (key) do nothing;

create table public.time_punches (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees(id),
  punch_type   text not null check (punch_type in ('in','out','break_start','break_end')),
  punched_at   timestamptz not null default now(),
  lat          double precision,
  lng          double precision,
  accuracy_m   double precision,
  vehicle_id   uuid references public.vehicles(id),
  source       text not null default 'app' check (source in ('app','correction')),
  voided       boolean not null default false,
  voided_by_correction uuid,
  created_at   timestamptz not null default now()
);
create index time_punches_employee_idx on public.time_punches(employee_id, punched_at desc);
create index time_punches_date_idx on public.time_punches(punched_at desc);

create table public.time_punch_corrections (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references public.employees(id),
  punch_id        uuid references public.time_punches(id),     -- null = añadir ponche olvidado
  new_punch_type  text check (new_punch_type in ('in','out','break_start','break_end')),
  new_punched_at  timestamptz,
  void_only       boolean not null default false,
  reason          text not null check (length(trim(reason)) > 3),
  status          text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by    uuid not null references public.employees(id) default app.current_employee_id(),
  requested_at    timestamptz not null default now(),
  decided_by      uuid references public.employees(id),
  decided_at      timestamptz,
  decision_notes  text,
  check (void_only or (new_punch_type is not null and new_punched_at is not null))
);

create or replace function app.distance_m(lat1 float8, lng1 float8, lat2 float8, lng2 float8)
returns float8 language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)));
$$;

-- Último estado del empleado: off, in, break
create or replace function app.punch_state(p_emp uuid)
returns text language sql stable security definer set search_path = public as $$
  select case (select punch_type from public.time_punches
                where employee_id = p_emp and not voided order by punched_at desc limit 1)
           when 'in' then 'in' when 'break_end' then 'in' when 'break_start' then 'break' else 'off' end;
$$;

create or replace function public.my_punch_state()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('state', app.punch_state(app.current_employee_id()),
    'last', (select to_jsonb(p) from public.time_punches p where employee_id = app.current_employee_id()
               and not voided order by punched_at desc limit 1));
$$;

create or replace function public.punch(p_type text, p_lat float8 default null, p_lng float8 default null,
                                        p_accuracy float8 default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := app.current_employee_id(); v_state text; v_cfg jsonb; v_id uuid; v_vehicle uuid; v_dist float8;
begin
  perform app.require_perm('timeclock.punch');
  select value into v_cfg from public.app_settings where key = 'timeclock';
  if coalesce((v_cfg->>'require_location')::boolean, true) and (p_lat is null or p_lng is null) then
    raise exception 'Active la ubicación del teléfono para ponchar' using errcode = '22023';
  end if;
  if coalesce((v_cfg->'geofence'->>'enabled')::boolean, false) then
    v_dist := app.distance_m(p_lat, p_lng, (v_cfg->'geofence'->>'lat')::float8, (v_cfg->'geofence'->>'lng')::float8);
    if v_dist > coalesce((v_cfg->'geofence'->>'radius_m')::float8, 300) then
      raise exception 'Está fuera del área permitida para ponchar (% m)', round(v_dist) using errcode = '22023';
    end if;
  end if;

  v_state := app.punch_state(v_emp);
  if (p_type = 'in' and v_state <> 'off') or (p_type = 'out' and v_state = 'off')
     or (p_type = 'break_start' and v_state <> 'in') or (p_type = 'break_end' and v_state <> 'break') then
    raise exception 'Ponche no válido: su estado actual es "%"',
      case v_state when 'in' then 'en turno' when 'break' then 'en descanso' else 'fuera de turno' end
      using errcode = '22023';
  end if;
  if exists (select 1 from public.time_punches where employee_id = v_emp and not voided
              and punched_at > now() - interval '30 seconds') then
    raise exception 'Ya registró un ponche hace unos segundos' using errcode = '23505';
  end if;

  select vehicle_id into v_vehicle from public.vehicle_assignments where employee_id = v_emp and ended_at is null;
  insert into public.time_punches(employee_id, punch_type, lat, lng, accuracy_m, vehicle_id)
  values (v_emp, p_type, p_lat, p_lng, p_accuracy, v_vehicle) returning id into v_id;
  return v_id;
end $$;

create or replace function public.request_punch_correction(p_employee uuid, p_punch uuid, p_type text,
  p_at timestamptz, p_reason text, p_void_only boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_employee <> app.current_employee_id() then perform app.require_perm('timeclock.edit');
  else perform app.require_perm('timeclock.punch'); end if;
  insert into public.time_punch_corrections(employee_id, punch_id, new_punch_type, new_punched_at, reason, void_only)
  values (p_employee, p_punch, p_type, p_at, p_reason, coalesce(p_void_only,false)) returning id into v_id;
  perform app.notify(array['admin','supervisor'], 'timeclock', 'correction_requested',
    'Corrección de ponche pendiente', p_reason, '/ponches/correcciones', 'info', 'time_punch_correction', v_id);
  return v_id;
end $$;

create or replace function public.decide_punch_correction(p_id uuid, p_approve boolean, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
declare c public.time_punch_corrections; v_new uuid;
begin
  perform app.require_perm('timeclock.approve');
  select * into c from public.time_punch_corrections where id = p_id and status = 'pending' for update;
  if c.id is null then raise exception 'Corrección no encontrada o ya decidida' using errcode = 'P0002'; end if;
  if c.employee_id = app.current_employee_id() then
    raise exception 'No puede aprobar correcciones de sus propios ponches' using errcode = '42501';
  end if;
  if p_approve then
    if c.punch_id is not null then
      update public.time_punches set voided = true, voided_by_correction = c.id where id = c.punch_id;
    end if;
    if not c.void_only then
      insert into public.time_punches(employee_id, punch_type, punched_at, source)
      values (c.employee_id, c.new_punch_type, c.new_punched_at, 'correction') returning id into v_new;
    end if;
  end if;
  update public.time_punch_corrections
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = app.current_employee_id(), decided_at = now(), decision_notes = p_notes
   where id = p_id;
  perform app.notify_employee(c.employee_id, 'timeclock', 'correction_decided',
    'Corrección de ponche ' || case when p_approve then 'aprobada' else 'rechazada' end, p_notes, '/m/ponches');
end $$;

-- Jornadas por día (en zona horaria de la compañía): horas trabajadas y descanso
create or replace view public.timeclock_daily with (security_invoker = true) as
with tz as (select coalesce((select value->>'timezone' from public.app_settings where key='company'),'UTC') z),
p as (
  select tp.*, (tp.punched_at at time zone (select z from tz))::date as work_date,
         lead(tp.punched_at) over (partition by tp.employee_id order by tp.punched_at) as next_at
    from public.time_punches tp where not tp.voided)
select employee_id, work_date,
       min(punched_at) filter (where punch_type = 'in')  as first_in,
       max(punched_at) filter (where punch_type = 'out') as last_out,
       round(sum(extract(epoch from (next_at - punched_at))) filter (where punch_type in ('in','break_end') and next_at is not null) / 3600.0, 2) as worked_hours,
       round(sum(extract(epoch from (next_at - punched_at))) filter (where punch_type = 'break_start' and next_at is not null) / 3600.0, 2) as break_hours,
       count(*) as punches
  from p group by employee_id, work_date;

insert into public.permissions (id, module_id, action, label, sort) values
  ('timeclock.view',     'timeclock', 'view',     'Ver ponches de todos', 1),
  ('timeclock.view_own', 'timeclock', 'view_own', 'Ver sus ponches', 2),
  ('timeclock.punch',    'timeclock', 'punch',    'Ponchar', 3),
  ('timeclock.edit',     'timeclock', 'edit',     'Solicitar correcciones a terceros', 4),
  ('timeclock.approve',  'timeclock', 'approve',  'Aprobar correcciones', 5)
on conflict (id) do nothing;
insert into public.role_permissions values
  ('supervisor','timeclock.view'), ('supervisor','timeclock.view_own'), ('supervisor','timeclock.punch'),
  ('supervisor','timeclock.edit'), ('supervisor','timeclock.approve'),
  ('driver','timeclock.view_own'), ('driver','timeclock.punch'),
  ('mechanic','timeclock.view_own'), ('mechanic','timeclock.punch')
on conflict do nothing;

alter table public.time_punches enable row level security;
alter table public.time_punch_corrections enable row level security;
create policy punches_read on public.time_punches for select to authenticated
  using ((select app.has_perm('timeclock.view'))
      or (employee_id = (select app.current_employee_id()) and (select app.has_perm('timeclock.view_own'))));
create policy corrections_read on public.time_punch_corrections for select to authenticated
  using ((select app.has_perm('timeclock.view')) or employee_id = (select app.current_employee_id()));
revoke insert, update on public.time_punches, public.time_punch_corrections from authenticated;

do $$ begin
  perform app.track('public.time_punches', false);
  perform app.track('public.time_punch_corrections', false);
end $$;
