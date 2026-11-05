-- @generated por scripts/modules.mjs — edite el archivo fuente, no este.
-- =============================================================================
-- MÓDULO · Taller mecánico y órdenes de trabajo
-- Depende de: core. Integración BLANDA con Inventario: si el módulo de
-- inventario está instalado y activo, las piezas se reservan/consumen allí
-- dentro de la misma transacción; si no, se registran como texto con costo.
-- =============================================================================
insert into public.app_modules (id, name) values ('workorders', 'Taller') on conflict (id) do nothing;

insert into public.app_settings (key, value) values
  ('workorders', '{"default_labor_rate": null, "overdue_days": {"critical": 1, "high": 3, "normal": 7, "low": 14}}')
on conflict (key) do nothing;

create sequence public.work_order_number_seq;

create table public.work_orders (
  id                  uuid primary key default gen_random_uuid(),
  order_number        text not null unique default ('OT-' || lpad(nextval('public.work_order_number_seq')::text, 5, '0')),
  vehicle_id          uuid not null references public.vehicles(id),
  reported_problem    text not null check (length(trim(reported_problem)) > 2),
  description         text,
  diagnosis           text,
  priority            text not null default 'normal' check (priority in ('low','normal','high','critical')),
  status              text not null default 'new' check (status in
                        ('new','pending_diagnosis','diagnosed','waiting_parts','in_repair','pending_test','completed','closed','cancelled')),
  assigned_mechanic_id uuid references public.employees(id),
  source_type         text check (source_type in ('manual','inspection','incident','maintenance','driver_report')),
  source_id           uuid,
  due_at              timestamptz,
  observations        text,
  engine_hours_in     numeric(10,1),
  engine_hours_out    numeric(10,1),
  vehicle_status_before text,
  labor_hours_total   numeric(8,2) not null default 0,
  labor_cost_total    numeric(12,2) not null default 0,
  parts_cost_total    numeric(12,2) not null default 0,
  opened_by           uuid references public.employees(id),
  diagnosed_by        uuid references public.employees(id),
  diagnosed_at        timestamptz,
  started_at          timestamptz,
  completed_at        timestamptz,
  closed_at           timestamptz,
  closed_by           uuid references public.employees(id),
  created_at          timestamptz not null default now(),
  created_by          uuid,
  updated_at          timestamptz not null default now(),
  updated_by          uuid
);
create index work_orders_vehicle_idx on public.work_orders(vehicle_id, created_at desc);
create index work_orders_status_idx on public.work_orders(status) where status not in ('closed','cancelled');
create index work_orders_mechanic_idx on public.work_orders(assigned_mechanic_id) where status not in ('closed','cancelled');

create table public.work_order_status_history (
  id            bigint generated always as identity primary key,
  work_order_id uuid not null references public.work_orders(id),
  from_status   text,
  to_status     text not null,
  notes         text,
  changed_by    uuid references public.employees(id),
  changed_at    timestamptz not null default now()
);

create table public.work_order_labor (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id),
  mechanic_id   uuid not null references public.employees(id),
  work_date     date not null default current_date,
  hours         numeric(6,2) not null check (hours > 0 and hours <= 24),
  rate          numeric(10,2),
  description   text,
  created_at    timestamptz not null default now()
);
create index work_order_labor_wo_idx on public.work_order_labor(work_order_id);

-- Piezas: necesarias → reservadas → consumidas (o devueltas / por comprar)
create table public.work_order_parts (
  id                uuid primary key default gen_random_uuid(),
  work_order_id     uuid not null references public.work_orders(id),
  description       text not null,
  part_number       text,
  quantity          numeric(10,2) not null check (quantity > 0),
  quantity_used     numeric(10,2) not null default 0 check (quantity_used >= 0),
  unit_cost         numeric(12,2),
  status            text not null default 'needed' check (status in ('needed','reserved','consumed','to_purchase','cancelled')),
  inventory_item_id uuid,          -- enlace blando a inventory_items
  catalog_part_id   uuid,          -- enlace blando a catalog_parts
  added_by          uuid references public.employees(id),
  created_at        timestamptz not null default now()
);
create index work_order_parts_wo_idx on public.work_order_parts(work_order_id);

-- Historial de estados
create or replace function app.work_orders_status_log()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.work_order_status_history(work_order_id, from_status, to_status, changed_by)
    values (new.id, case when tg_op = 'UPDATE' then old.status end, new.status, app.current_employee_id());
  end if;
  return new;
end $$;
create trigger work_orders_status_log after insert or update of status on public.work_orders
  for each row execute function app.work_orders_status_log();

-- Totales siempre calculados desde mano de obra y piezas
create or replace function app.work_order_recalc(p_wo uuid)
returns void language sql security definer set search_path = public as $$
  update public.work_orders w set
    labor_hours_total = coalesce((select sum(hours) from public.work_order_labor where work_order_id = p_wo), 0),
    labor_cost_total  = coalesce((select sum(hours * coalesce(rate, 0)) from public.work_order_labor where work_order_id = p_wo), 0),
    parts_cost_total  = coalesce((select sum(quantity_used * coalesce(unit_cost, 0)) from public.work_order_parts
                                   where work_order_id = p_wo and status = 'consumed'), 0)
  where w.id = p_wo;
$$;

create or replace function app.wo_can_work(p_wo uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select app.has_perm('workorders.edit')
      or (app.has_perm('workorders.work') and exists (select 1 from public.work_orders
            where id = p_wo and (assigned_mechanic_id = app.current_employee_id() or assigned_mechanic_id is null)));
$$;

create or replace function app.wo_assert_open(p_wo uuid)
returns public.work_orders language plpgsql security definer set search_path = public as $$
declare w public.work_orders;
begin
  select * into w from public.work_orders where id = p_wo for update;
  if w.id is null then raise exception 'Orden no encontrada' using errcode = 'P0002'; end if;
  if w.status in ('completed','closed','cancelled') then
    raise exception 'La orden % está %', w.order_number,
      case w.status when 'completed' then 'completada' when 'closed' then 'cerrada' else 'cancelada' end using errcode = '22023';
  end if;
  if not app.wo_can_work(p_wo) then raise exception 'No puede modificar esta orden' using errcode = '42501'; end if;
  return w;
end $$;

-- Crear orden
-- p: {vehicle_id, reported_problem, description, priority, assigned_mechanic_id, source_type, source_id, due_at,
--     observations, take_out_of_service:boolean}
create or replace function public.create_work_order(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_num text; v public.vehicles; v_days int; v_cfg jsonb; v_prio text := coalesce(p->>'priority','normal');
begin
  if not (app.has_perm('workorders.create') or
          (app.has_perm('workorders.report') and coalesce(p->>'source_type','driver_report') = 'driver_report')) then
    raise exception 'Permiso requerido: workorders.create' using errcode = '42501';
  end if;
  select * into v from public.vehicles where id = (p->>'vehicle_id')::uuid;
  if v.id is null or not app.can_see_vehicle(v.id) then raise exception 'Vehículo no válido' using errcode = '42501'; end if;
  select value into v_cfg from public.app_settings where key = 'workorders';
  v_days := coalesce((v_cfg->'overdue_days'->>v_prio)::int, 7);

  insert into public.work_orders(vehicle_id, reported_problem, description, priority, status, assigned_mechanic_id,
                                 source_type, source_id, due_at, observations, opened_by, engine_hours_in, vehicle_status_before)
  values (v.id, p->>'reported_problem', p->>'description', v_prio,
          case when nullif(p->>'assigned_mechanic_id','') is not null then 'pending_diagnosis' else 'new' end,
          nullif(p->>'assigned_mechanic_id','')::uuid, coalesce(p->>'source_type','manual'), nullif(p->>'source_id','')::uuid,
          coalesce((p->>'due_at')::timestamptz, now() + make_interval(days => v_days)), p->>'observations',
          app.current_employee_id(), v.engine_hours, v.status)
  returning id, order_number into v_id, v_num;

  if coalesce((p->>'take_out_of_service')::boolean, false) or v_prio = 'critical' then
    update public.vehicles set status = 'repair', status_reason = 'Orden ' || v_num where id = v.id and status <> 'retired';
  end if;
  perform app.timeline_add(v.id, 'workorders', 'work_order_opened', 'Orden ' || v_num || ' abierta: ' || (p->>'reported_problem'),
    'work_order', v_id, jsonb_build_object('priority', v_prio, 'source', coalesce(p->>'source_type','manual')));

  perform app.notify(array['admin','supervisor'], 'workorders', 'work_order_new',
    'Nueva orden ' || v_num || ' · ' || v.unit_number, p->>'reported_problem', '/taller/' || v_id,
    case when v_prio in ('high','critical') then 'warning' else 'info' end, 'work_order', v_id);
  if nullif(p->>'assigned_mechanic_id','') is not null then
    perform app.notify_employee((p->>'assigned_mechanic_id')::uuid, 'workorders', 'work_order_assigned',
      'Orden asignada: ' || v_num || ' · ' || v.unit_number, p->>'reported_problem', '/taller/' || v_id,
      case when v_prio in ('high','critical') then 'warning' else 'info' end, 'work_order', v_id);
  else
    perform app.notify(array['mechanic'], 'workorders', 'work_order_new', 'Orden sin asignar: ' || v_num || ' · ' || v.unit_number,
      p->>'reported_problem', '/taller/' || v_id, 'info', 'work_order', v_id);
  end if;
  return jsonb_build_object('id', v_id, 'order_number', v_num);
end $$;

create or replace function public.assign_work_order(p_wo uuid, p_mechanic uuid)
returns void language plpgsql security definer set search_path = public as $$
declare w public.work_orders;
begin
  perform app.require_perm('workorders.edit');
  update public.work_orders set assigned_mechanic_id = p_mechanic,
         status = case when status = 'new' then 'pending_diagnosis' else status end
   where id = p_wo and status not in ('closed','cancelled') returning * into w;
  if w.id is null then raise exception 'Orden no encontrada o cerrada' using errcode = 'P0002'; end if;
  perform app.notify_employee(p_mechanic, 'workorders', 'work_order_assigned', 'Orden asignada: ' || w.order_number,
    w.reported_problem, '/taller/' || w.id, 'info', 'work_order', w.id);
end $$;

create or replace function public.diagnose_work_order(p_wo uuid, p_diagnosis text)
returns void language plpgsql security definer set search_path = public as $$
declare w public.work_orders;
begin
  w := app.wo_assert_open(p_wo);
  if coalesce(trim(p_diagnosis), '') = '' then raise exception 'Escriba el diagnóstico' using errcode = '22023'; end if;
  update public.work_orders set diagnosis = p_diagnosis, diagnosed_by = app.current_employee_id(), diagnosed_at = now(),
         assigned_mechanic_id = coalesce(assigned_mechanic_id, app.current_employee_id()),
         status = case when status in ('new','pending_diagnosis') then 'diagnosed' else status end
   where id = p_wo;
  perform app.timeline_add(w.vehicle_id, 'workorders', 'diagnosis', 'Diagnóstico ' || w.order_number,
    'work_order', w.id, jsonb_build_object('diagnosis', p_diagnosis));
end $$;

create or replace function public.set_work_order_status(p_wo uuid, p_status text, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
declare w public.work_orders;
begin
  if p_status in ('completed','closed') then
    raise exception 'Use complete_work_order / close_work_order' using errcode = '22023';
  end if;
  if p_status = 'cancelled' then perform app.require_perm('workorders.edit'); end if;
  w := app.wo_assert_open(p_wo);
  update public.work_orders set status = p_status,
         started_at = case when p_status = 'in_repair' then coalesce(started_at, now()) else started_at end,
         assigned_mechanic_id = coalesce(assigned_mechanic_id, app.current_employee_id())
   where id = p_wo;
  if p_notes is not null then
    update public.work_order_status_history set notes = p_notes
     where id = (select max(id) from public.work_order_status_history where work_order_id = p_wo);
  end if;
  if p_status = 'in_repair' then
    update public.vehicles set status = 'repair', status_reason = 'Orden ' || w.order_number
     where id = w.vehicle_id and status not in ('retired');
  elsif p_status = 'cancelled' then
    if to_regprocedure('app.inventory_release(text,uuid)') is not null then
      perform app.inventory_release('work_order_part', id) from public.work_order_parts where work_order_id = p_wo;
    end if;
    update public.work_order_parts set status = 'cancelled' where work_order_id = p_wo and status in ('needed','reserved','to_purchase');
  end if;
end $$;

-- Mano de obra
create or replace function public.add_work_order_labor(p_wo uuid, p_hours numeric, p_description text default null,
  p_mechanic uuid default null, p_date date default null, p_rate numeric default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_mech uuid := coalesce(p_mechanic, app.current_employee_id()); v_rate numeric;
begin
  perform app.wo_assert_open(p_wo);
  if v_mech <> app.current_employee_id() then perform app.require_perm('workorders.edit'); end if;
  v_rate := coalesce(p_rate, (select (value->>'default_labor_rate')::numeric from public.app_settings where key = 'workorders'));
  insert into public.work_order_labor(work_order_id, mechanic_id, work_date, hours, rate, description)
  values (p_wo, v_mech, coalesce(p_date, current_date), p_hours, v_rate, p_description) returning id into v_id;
  perform app.work_order_recalc(p_wo);
  return v_id;
end $$;

-- Piezas: añadir (reserva si hay inventario y existencia; si no, queda como necesaria / por comprar)
-- p: {description, part_number, quantity, unit_cost, inventory_item_id, catalog_part_id, reserve:boolean, to_purchase:boolean}
create or replace function public.add_work_order_part(p_wo uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  w public.work_orders; v_id uuid; v_item uuid := nullif(p->>'inventory_item_id','')::uuid;
  v_qty numeric := coalesce((p->>'quantity')::numeric, 1); v_status text := 'needed';
  v_desc text := p->>'description'; v_pn text := nullif(p->>'part_number',''); v_cost numeric := (p->>'unit_cost')::numeric;
  v_inv boolean := app.module_enabled('inventory') and to_regprocedure('app.inventory_reserve(uuid,numeric,text,uuid)') is not null;
  v_pr uuid;
begin
  w := app.wo_assert_open(p_wo);
  if v_item is not null and v_inv then
    execute 'select name, coalesce($2, part_number), unit_cost from public.inventory_items where id = $1'
      into v_desc, v_pn, v_cost using v_item, v_pn;
    v_desc := coalesce(nullif(p->>'description',''), v_desc);
  end if;
  if coalesce(trim(v_desc),'') = '' then raise exception 'Describa la pieza' using errcode = '22023'; end if;

  insert into public.work_order_parts(work_order_id, description, part_number, quantity, unit_cost, status,
                                      inventory_item_id, catalog_part_id, added_by)
  values (p_wo, v_desc, v_pn, v_qty, v_cost, 'needed', v_item, nullif(p->>'catalog_part_id','')::uuid, app.current_employee_id())
  returning id into v_id;

  if v_item is not null and v_inv and coalesce((p->>'reserve')::boolean, true) then
    execute 'select app.inventory_reserve($1, $2, $3, $4)' using v_item, v_qty, 'work_order_part', v_id;
    v_status := 'reserved';
  elsif coalesce((p->>'to_purchase')::boolean, false) then
    v_status := 'to_purchase';
    if v_inv then
      execute 'select public.request_purchase($1)' into v_pr using jsonb_build_object(
        'item_id', v_item, 'catalog_part_id', p->>'catalog_part_id', 'description', v_desc, 'part_number', v_pn,
        'quantity', v_qty, 'reason', 'Orden ' || w.order_number, 'reference_type', 'work_order_part', 'reference_id', v_id);
    end if;
  end if;
  update public.work_order_parts set status = v_status where id = v_id;
  if v_status = 'to_purchase' and w.status in ('new','pending_diagnosis','diagnosed') then
    update public.work_orders set status = 'waiting_parts' where id = p_wo;
  end if;
  return jsonb_build_object('id', v_id, 'status', v_status, 'purchase_request_id', v_pr);
end $$;

-- Confirmar uso: descuenta de inventario en la misma transacción
create or replace function public.consume_work_order_part(p_part uuid, p_qty numeric default null)
returns void language plpgsql security definer set search_path = public as $$
declare pt public.work_order_parts; w public.work_orders; v_qty numeric;
begin
  select * into pt from public.work_order_parts where id = p_part for update;
  if pt.id is null then raise exception 'Pieza no encontrada' using errcode = 'P0002'; end if;
  w := app.wo_assert_open(pt.work_order_id);
  if pt.status in ('consumed','cancelled') then raise exception 'Esta pieza ya fue %',
    case pt.status when 'consumed' then 'consumida' else 'cancelada' end using errcode = '22023'; end if;
  v_qty := coalesce(p_qty, pt.quantity);
  if v_qty <= 0 then raise exception 'Cantidad inválida' using errcode = '22023'; end if;
  if pt.inventory_item_id is not null then
    if not app.module_enabled('inventory') or to_regprocedure('app.inventory_consume(uuid,numeric,text,uuid,text)') is null then
      raise exception 'El módulo de inventario no está activo' using errcode = '55000';
    end if;
    if not (app.has_perm('inventory.consume') or app.has_perm('workorders.edit')) then
      raise exception 'Permiso requerido: inventory.consume' using errcode = '42501';
    end if;
    execute 'select app.inventory_consume($1, $2, $3, $4, $5)'
      using pt.inventory_item_id, v_qty, 'work_order_part', pt.id, 'Orden ' || w.order_number;
    -- Si se usó menos de lo reservado, liberar el sobrante
    execute 'select app.inventory_release($1, $2)' using 'work_order_part', pt.id;
  end if;
  update public.work_order_parts set quantity_used = v_qty, status = 'consumed' where id = p_part;
  perform app.work_order_recalc(pt.work_order_id);
end $$;

create or replace function public.cancel_work_order_part(p_part uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pt public.work_order_parts;
begin
  select * into pt from public.work_order_parts where id = p_part for update;
  if pt.id is null then raise exception 'Pieza no encontrada' using errcode = 'P0002'; end if;
  perform app.wo_assert_open(pt.work_order_id);
  if pt.status = 'consumed' then raise exception 'No se puede cancelar una pieza ya consumida' using errcode = '22023'; end if;
  if to_regprocedure('app.inventory_release(text,uuid)') is not null then
    execute 'select app.inventory_release($1, $2)' using 'work_order_part', pt.id;
  end if;
  update public.work_order_parts set status = 'cancelled' where id = p_part;
end $$;

-- Completar: valida, libera reservas sin usar, actualiza historial y vehículo
create or replace function public.complete_work_order(p_wo uuid, p_notes text default null, p_engine_hours numeric default null,
                                                      p_return_to_service boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare w public.work_orders; v_parts jsonb;
begin
  w := app.wo_assert_open(p_wo);
  if w.diagnosis is null then raise exception 'Registre el diagnóstico antes de completar' using errcode = '22023'; end if;
  if exists (select 1 from public.work_order_parts where work_order_id = p_wo and status in ('reserved','needed','to_purchase')) then
    raise exception 'Hay piezas pendientes: confirme su uso o cancélelas' using errcode = '22023';
  end if;
  perform app.record_meter(w.vehicle_id, p_engine_hours, null, 'workorder', w.id);
  perform app.work_order_recalc(p_wo);
  update public.work_orders set status = 'completed', completed_at = now(), engine_hours_out = p_engine_hours,
         observations = concat_ws(E'\n', observations, p_notes)
   where id = p_wo returning * into w;

  if p_return_to_service then
    update public.vehicles v set status = case when exists (select 1 from public.vehicle_assignments a
                                                             where a.vehicle_id = v.id and a.ended_at is null)
                                            then 'assigned' else 'available' end, status_reason = null
     where v.id = w.vehicle_id and v.status in ('repair','out_of_service','maintenance')
       and not exists (select 1 from public.work_orders o where o.vehicle_id = w.vehicle_id and o.id <> w.id
                         and o.status in ('in_repair','waiting_parts','pending_test') and o.priority = 'critical');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('description', description, 'part_number', part_number,
           'quantity', quantity_used, 'unit_cost', unit_cost)), '[]')
    into v_parts from public.work_order_parts where work_order_id = p_wo and status = 'consumed';
  perform app.timeline_add(w.vehicle_id, 'workorders', 'repair', 'Reparación completada · ' || w.order_number,
    'work_order', w.id,
    jsonb_build_object('diagnosis', w.diagnosis, 'parts', v_parts,
      'mechanics', (select jsonb_agg(distinct e.full_name) from public.work_order_labor l
                      join public.employees e on e.id = l.mechanic_id where l.work_order_id = p_wo)),
    w.labor_cost_total + w.parts_cost_total, w.labor_hours_total, now(), w.assigned_mechanic_id);
  perform app.notify(array['admin','supervisor'], 'workorders', 'work_order_completed',
    'Orden ' || w.order_number || ' completada', w.diagnosis, '/taller/' || w.id, 'info', 'work_order', w.id);
end $$;

create or replace function public.close_work_order(p_wo uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform app.require_perm('workorders.approve');
  update public.work_orders set status = 'closed', closed_at = now(), closed_by = app.current_employee_id()
   where id = p_wo and status = 'completed';
  if not found then raise exception 'Solo se pueden cerrar órdenes completadas' using errcode = '22023'; end if;
end $$;

create or replace function app.workorders_alerts()
returns void language plpgsql security definer set search_path = public as $$
declare w record;
begin
  for w in select o.*, v.unit_number from public.work_orders o join public.vehicles v on v.id = o.vehicle_id
            where o.status not in ('completed','closed','cancelled') and o.due_at < now() loop
    perform app.notify(array['admin','supervisor'], 'workorders', 'work_order_overdue',
      'Orden atrasada: ' || w.order_number || ' · ' || w.unit_number, w.reported_problem, '/taller/' || w.id,
      'warning', 'work_order', w.id, 'wo_overdue:' || w.id || ':' || current_date);
    if w.assigned_mechanic_id is not null then
      perform app.notify_employee(w.assigned_mechanic_id, 'workorders', 'work_order_overdue',
        'Orden atrasada: ' || w.order_number, w.reported_problem, '/taller/' || w.id, 'warning', 'work_order', w.id,
        'wo_overdue_m:' || w.id || ':' || current_date);
    end if;
  end loop;
end $$;
insert into public.alert_jobs values ('workorders', 'workorders_alerts') on conflict do nothing;

insert into public.permissions (id, module_id, action, label, sort) values
  ('workorders.view',    'workorders', 'view',    'Ver órdenes de trabajo', 1),
  ('workorders.report',  'workorders', 'report',  'Reportar problemas mecánicos', 2),
  ('workorders.create',  'workorders', 'create',  'Crear órdenes de trabajo', 3),
  ('workorders.work',    'workorders', 'work',    'Diagnosticar, reparar y registrar horas (asignadas)', 4),
  ('workorders.edit',    'workorders', 'edit',    'Editar, asignar y cancelar cualquier orden', 5),
  ('workorders.approve', 'workorders', 'approve', 'Cerrar órdenes completadas', 6)
on conflict (id) do nothing;
insert into public.role_permissions values
  ('supervisor','workorders.view'), ('supervisor','workorders.report'), ('supervisor','workorders.create'),
  ('supervisor','workorders.edit'), ('supervisor','workorders.approve'),
  ('driver','workorders.report'),
  ('mechanic','workorders.view'), ('mechanic','workorders.report'), ('mechanic','workorders.work')
on conflict do nothing;

alter table public.work_orders               enable row level security;
alter table public.work_order_status_history enable row level security;
alter table public.work_order_labor          enable row level security;
alter table public.work_order_parts          enable row level security;
create policy wo_read on public.work_orders for select to authenticated
  using ((select app.has_perm('workorders.view')) or opened_by = (select app.current_employee_id()));
create policy wo_update on public.work_orders for update to authenticated
  using (app.wo_can_work(id)) with check (app.wo_can_work(id));
create policy wo_hist_read on public.work_order_status_history for select to authenticated
  using (exists (select 1 from public.work_orders w where w.id = work_order_id));
create policy wo_labor_read on public.work_order_labor for select to authenticated
  using (exists (select 1 from public.work_orders w where w.id = work_order_id));
create policy wo_parts_read on public.work_order_parts for select to authenticated
  using (exists (select 1 from public.work_orders w where w.id = work_order_id));
revoke insert on public.work_orders, public.work_order_status_history, public.work_order_labor, public.work_order_parts from authenticated;
revoke update on public.work_orders, public.work_order_status_history, public.work_order_labor, public.work_order_parts from authenticated;
grant update (description, observations, priority, due_at) on public.work_orders to authenticated;

do $$ begin
  perform app.track('public.work_orders');
  perform app.track('public.work_order_labor', false);
  perform app.track('public.work_order_parts', false);
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.work_orders;
  end if;
end $$;

-- Reportes del taller
create or replace view public.workorders_mechanic_activity with (security_invoker = true) as
  select l.mechanic_id, e.full_name as mechanic_name, date_trunc('month', l.work_date)::date as month,
         count(distinct l.work_order_id) as orders, sum(l.hours) as hours,
         sum(l.hours * coalesce(l.rate,0))::numeric(12,2) as labor_cost
    from public.work_order_labor l join public.employees e on e.id = l.mechanic_id
   group by l.mechanic_id, e.full_name, date_trunc('month', l.work_date);

create or replace view public.workorders_by_vehicle with (security_invoker = true) as
  select w.vehicle_id, v.unit_number, count(*) as orders,
         count(*) filter (where w.status in ('completed','closed')) as completed,
         count(*) filter (where w.status not in ('completed','closed','cancelled')) as open,
         sum(w.labor_hours_total) as labor_hours, sum(w.labor_cost_total + w.parts_cost_total)::numeric(12,2) as total_cost,
         max(w.created_at) as last_order_at
    from public.work_orders w join public.vehicles v on v.id = w.vehicle_id
   group by w.vehicle_id, v.unit_number;
