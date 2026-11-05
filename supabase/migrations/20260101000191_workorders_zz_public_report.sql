-- @generated por scripts/modules.mjs — edite el archivo fuente, no este.
-- =============================================================================
-- TALLER · Reporte público (sin PIN) + reglas de mecánicos
-- Quien deja un ATV/UTV en el taller escribe el número de unidad y qué pasó.
-- Se crea una orden de trabajo y se avisa a los mecánicos y al admin.
-- Funciones marcadas con el comentario '@public' quedan disponibles para anon
-- (ver supabase/core/999_hardening.sql). Nada más es accesible sin sesión.
-- =============================================================================

-- Mecánicos pueden abrir órdenes (registrar arreglos y mantenimientos)
insert into public.role_permissions values ('mechanic','workorders.create') on conflict do nothing;

alter table public.work_orders drop constraint if exists work_orders_source_type_check;
alter table public.work_orders add constraint work_orders_source_type_check
  check (source_type in ('manual','inspection','incident','maintenance','driver_report','public_report'));

-- Bitácora de reportes públicos (control de abuso). Ningún rol de la API la lee.
create table if not exists public.public_reports (
  id            uuid primary key default gen_random_uuid(),
  unit_number   text not null,
  description   text not null,
  reporter_name text,
  work_order_id uuid references public.work_orders(id),
  created_at    timestamptz not null default now()
);
alter table public.public_reports enable row level security;
revoke all on public.public_reports from anon, authenticated;

-- Unidades activas para el selector del formulario público (solo número y modelo)
create or replace function public.public_vehicle_units()
returns table (unit_number text, label text)
language sql stable security definer set search_path = public as $$
  select v.unit_number, trim(m.manufacturer || ' ' || m.model)
    from public.vehicles v join public.vehicle_models m on m.id = v.model_id
   where v.archived_at is null and v.status <> 'retired'
   order by v.unit_number;
$$;
comment on function public.public_vehicle_units() is '@public';

create or replace function public.public_report_problem(p_unit text, p_description text, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.vehicles; v_id uuid; v_num text; v_desc text := trim(coalesce(p_description, ''));
begin
  if not app.module_enabled('workorders') then raise exception 'El reporte no está disponible' using errcode = '42501'; end if;
  if length(v_desc) < 3 then raise exception 'Describa el problema' using errcode = '22023'; end if;
  if length(v_desc) > 2000 then raise exception 'La descripción es demasiado larga' using errcode = '22023'; end if;
  if length(coalesce(p_name, '')) > 80 then raise exception 'Nombre demasiado largo' using errcode = '22023'; end if;

  select * into v from public.vehicles
   where lower(trim(unit_number)) = lower(trim(coalesce(p_unit, ''))) and archived_at is null;
  if v.id is null then raise exception 'No existe la unidad %', trim(coalesce(p_unit, '')) using errcode = 'P0002'; end if;

  -- Límite: 3 reportes por unidad cada 10 min, 60 por hora en total
  if (select count(*) from public.public_reports where unit_number = v.unit_number and created_at > now() - interval '10 minutes') >= 3
     or (select count(*) from public.public_reports where created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Demasiados reportes seguidos. Intente en unos minutos.' using errcode = '54000';
  end if;

  insert into public.work_orders(vehicle_id, reported_problem, priority, status, source_type, due_at,
                                 observations, engine_hours_in, vehicle_status_before)
  values (v.id, v_desc, 'normal', 'new', 'public_report', now() + interval '7 days',
          nullif('Reportado por: ' || nullif(trim(coalesce(p_name, '')), ''), 'Reportado por: '),
          v.engine_hours, v.status)
  returning id, order_number into v_id, v_num;

  insert into public.public_reports(unit_number, description, reporter_name, work_order_id)
  values (v.unit_number, v_desc, nullif(trim(coalesce(p_name, '')), ''), v_id);

  perform app.timeline_add(v.id, 'workorders', 'work_order_opened', 'Reporte en taller ' || v_num || ': ' || v_desc,
    'work_order', v_id, jsonb_build_object('source', 'public_report'));
  perform app.notify(array['admin','supervisor','mechanic'], 'workorders', 'work_order_new',
    'Reporte en taller · ' || v.unit_number, v_desc, '/taller/' || v_id, 'warning', 'work_order', v_id);
  return jsonb_build_object('order_number', v_num, 'unit_number', v.unit_number);
end $$;
comment on function public.public_report_problem(text, text, text) is '@public';

-- Diagnóstico: un diagnóstico ya guardado solo lo cambia el admin
create or replace function public.diagnose_work_order(p_wo uuid, p_diagnosis text)
returns void language plpgsql security definer set search_path = public as $$
declare w public.work_orders;
begin
  w := app.wo_assert_open(p_wo);
  if coalesce(trim(p_diagnosis), '') = '' then raise exception 'Escriba el diagnóstico' using errcode = '22023'; end if;
  if w.diagnosis is not null and coalesce(app.current_role_id(), '') <> 'admin' then
    raise exception 'El diagnóstico ya fue guardado. Para cambiarlo envíe una solicitud al administrador.' using errcode = '42501';
  end if;
  update public.work_orders set diagnosis = p_diagnosis, diagnosed_by = app.current_employee_id(), diagnosed_at = now(),
         assigned_mechanic_id = coalesce(assigned_mechanic_id, app.current_employee_id()),
         status = case when status in ('new','pending_diagnosis') then 'diagnosed' else status end
   where id = p_wo;
  perform app.timeline_add(w.vehicle_id, 'workorders', 'diagnosis', 'Diagnóstico ' || w.order_number,
    'work_order', w.id, jsonb_build_object('diagnosis', p_diagnosis));
end $$;
