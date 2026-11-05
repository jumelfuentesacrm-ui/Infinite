-- =============================================================================
-- TALLER · Reportes recibidos (bandeja de los mecánicos)
-- Un reporte público llega como SOLICITUD pendiente. Un mecánico la acepta y la
-- marca "Solucionado" (o la pasa a orden de trabajo si necesita piezas).
-- Cada paso queda en el historial de la máquina y del mecánico (vehicle_timeline).
-- =============================================================================
alter table public.public_reports
  add column if not exists vehicle_id  uuid references public.vehicles(id),
  add column if not exists status      text not null default 'pending',
  add column if not exists accepted_by uuid references public.employees(id),
  add column if not exists accepted_at timestamptz,
  add column if not exists solved_by   uuid references public.employees(id),
  add column if not exists solved_at   timestamptz,
  add column if not exists resolution  text,
  add column if not exists labor_hours numeric(8,2);
update public.public_reports r set vehicle_id = v.id from public.vehicles v
 where r.vehicle_id is null and v.unit_number = r.unit_number;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'public_reports_status_check') then
    alter table public.public_reports add constraint public_reports_status_check
      check (status in ('pending','accepted','solved','converted'));
  end if;
end $$;
create index if not exists public_reports_status_idx on public.public_reports(status, created_at desc);

-- Lectura: personal del taller. Escritura solo por las funciones de abajo.
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'public_reports' and policyname = 'public_reports_read') then
    create policy public_reports_read on public.public_reports for select to authenticated
      using ((select app.has_perm('workorders.view')) and app.can_see_vehicle(vehicle_id));
  end if;
end $$;
grant select on public.public_reports to authenticated;
revoke insert, update, delete on public.public_reports from anon, authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'public_reports') then
    alter publication supabase_realtime add table public.public_reports;
  end if;
end $$;

-- Reporte público: ahora crea una solicitud pendiente (no una orden)
create or replace function public.public_report_problem(p_unit text, p_description text, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.vehicles; v_id uuid; v_desc text := trim(coalesce(p_description, '')); v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if not app.module_enabled('workorders') then raise exception 'El reporte no está disponible' using errcode = '42501'; end if;
  if length(v_desc) < 3 then raise exception 'Describa el problema' using errcode = '22023'; end if;
  if length(v_desc) > 2000 then raise exception 'La descripción es demasiado larga' using errcode = '22023'; end if;
  if length(coalesce(v_name, '')) > 80 then raise exception 'Nombre demasiado largo' using errcode = '22023'; end if;

  select * into v from public.vehicles
   where lower(trim(unit_number)) = lower(trim(coalesce(p_unit, ''))) and archived_at is null;
  if v.id is null then raise exception 'No existe la unidad %', trim(coalesce(p_unit, '')) using errcode = 'P0002'; end if;

  if (select count(*) from public.public_reports where unit_number = v.unit_number and created_at > now() - interval '10 minutes') >= 3
     or (select count(*) from public.public_reports where created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Demasiados reportes seguidos. Intente en unos minutos.' using errcode = '54000';
  end if;

  insert into public.public_reports(unit_number, vehicle_id, description, reporter_name)
  values (v.unit_number, v.id, v_desc, v_name) returning id into v_id;

  perform app.timeline_add(v.id, 'workorders', 'shop_report_received', 'Reporte recibido en el taller: ' || v_desc,
    'shop_report', v_id, jsonb_build_object('reporter', v_name));
  perform app.notify(array['admin','supervisor','mechanic'], 'workorders', 'shop_report',
    'Nuevo reporte · ' || v.unit_number, v_desc, '/taller/reportes', 'warning', 'shop_report', v_id);
  return jsonb_build_object('order_number', null, 'unit_number', v.unit_number);
end $$;
comment on function public.public_report_problem(text, text, text) is '@public';

create or replace function app.shop_report_get(p_id uuid)
returns public.public_reports language plpgsql security definer set search_path = public as $$
declare r public.public_reports;
begin
  perform app.require_perm('workorders.create');
  select * into r from public.public_reports where id = p_id for update;
  if r.id is null then raise exception 'Reporte no encontrado' using errcode = 'P0002'; end if;
  return r;
end $$;

-- Aceptar: el mecánico toma el reporte
create or replace function public.shop_report_accept(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.public_reports := app.shop_report_get(p_id);
begin
  if r.status <> 'pending' then raise exception 'Este reporte ya fue tomado' using errcode = '22023'; end if;
  update public.public_reports set status = 'accepted', accepted_by = app.current_employee_id(), accepted_at = now() where id = p_id;
  perform app.timeline_add(r.vehicle_id, 'workorders', 'shop_report_accepted', 'Reporte aceptado: ' || r.description,
    'shop_report', r.id);
end $$;

-- Solucionado: qué se hizo (y horas, opcional). Se puede marcar directo desde pendiente.
create or replace function public.shop_report_solve(p_id uuid, p_resolution text, p_hours numeric default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.public_reports := app.shop_report_get(p_id); v_emp uuid := app.current_employee_id();
begin
  if r.status in ('solved','converted') then raise exception 'Este reporte ya está cerrado' using errcode = '22023'; end if;
  if r.status = 'accepted' and r.accepted_by <> v_emp and coalesce(app.current_role_id(), '') <> 'admin' then
    raise exception 'Este reporte lo tomó otro mecánico' using errcode = '42501';
  end if;
  if coalesce(trim(p_resolution), '') = '' then raise exception 'Escriba qué se hizo' using errcode = '22023'; end if;
  if p_hours is not null and (p_hours < 0 or p_hours > 24) then raise exception 'Horas no válidas' using errcode = '22023'; end if;
  update public.public_reports
     set status = 'solved', accepted_by = coalesce(accepted_by, v_emp), accepted_at = coalesce(accepted_at, now()),
         solved_by = v_emp, solved_at = now(), resolution = trim(p_resolution), labor_hours = p_hours
   where id = p_id;
  perform app.timeline_add(r.vehicle_id, 'workorders', 'shop_report_solved', 'Solucionado: ' || trim(p_resolution),
    'shop_report', r.id, jsonb_build_object('problem', r.description), null, p_hours);
end $$;

-- Pasar a orden de trabajo (cuando hace falta piezas o más trabajo)
create or replace function public.shop_report_to_work_order(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare r public.public_reports := app.shop_report_get(p_id); v public.vehicles; v_emp uuid := app.current_employee_id(); v_wo uuid; v_num text;
begin
  if r.status in ('solved','converted') then raise exception 'Este reporte ya está cerrado' using errcode = '22023'; end if;
  if r.status = 'accepted' and r.accepted_by <> v_emp and coalesce(app.current_role_id(), '') <> 'admin' then
    raise exception 'Este reporte lo tomó otro mecánico' using errcode = '42501';
  end if;
  select * into v from public.vehicles where id = r.vehicle_id;
  insert into public.work_orders(vehicle_id, reported_problem, priority, status, source_type, source_id, due_at,
                                 observations, engine_hours_in, vehicle_status_before, opened_by, assigned_mechanic_id)
  values (v.id, r.description, 'normal', 'pending_diagnosis', 'public_report', r.id, now() + interval '7 days',
          nullif('Reportado por: ' || coalesce(r.reporter_name, ''), 'Reportado por: '), v.engine_hours, v.status, v_emp, v_emp)
  returning id, order_number into v_wo, v_num;
  update public.public_reports set status = 'converted', work_order_id = v_wo,
         accepted_by = coalesce(accepted_by, v_emp), accepted_at = coalesce(accepted_at, now()) where id = p_id;
  perform app.timeline_add(v.id, 'workorders', 'work_order_opened', 'Reporte pasado a orden ' || v_num || ': ' || r.description,
    'work_order', v_wo, jsonb_build_object('source', 'public_report'));
  return v_wo;
end $$;

-- Historial de un empleado (lo que hizo en cada máquina). Solo el admin ve el de otros.
create or replace function public.employee_history(p_employee uuid default null, p_limit int default 200)
returns table (id bigint, occurred_at timestamptz, vehicle_id uuid, unit_number text, module_id text, event_type text,
               title text, entity_type text, entity_id uuid, labor_hours numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_emp uuid := coalesce(p_employee, app.current_employee_id());
begin
  if v_emp is distinct from app.current_employee_id() and coalesce(app.current_role_id(), '') <> 'admin' then
    raise exception 'Solo el administrador ve el historial de otros empleados' using errcode = '42501';
  end if;
  return query
    select t.id, t.occurred_at, t.vehicle_id, v.unit_number, t.module_id, t.event_type, t.title, t.entity_type, t.entity_id, t.labor_hours
      from public.vehicle_timeline t join public.vehicles v on v.id = t.vehicle_id
     where t.employee_id = v_emp
     order by t.occurred_at desc limit least(greatest(p_limit, 1), 1000);
end $$;
