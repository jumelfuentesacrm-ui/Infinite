-- =============================================================================
-- MÓDULO · Inventario de piezas
-- Depende de: core. Las existencias SOLO cambian mediante movimientos dentro
-- de transacciones (funciones inventory_*). Reservado ≠ consumido.
-- =============================================================================
insert into public.app_modules (id, name) values ('inventory', 'Inventario') on conflict (id) do nothing;

create table public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  contact     text,
  phone       text,
  email       text,
  address     text,
  notes       text,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

create table public.inventory_items (
  id                uuid primary key default gen_random_uuid(),
  sku               text not null unique,                 -- código interno
  name              text not null,
  part_number       text,                                 -- número del fabricante (si se conoce)
  manufacturer      text,
  category          text,
  description       text,
  unit              text not null default 'unidad',
  quantity_on_hand  numeric(12,2) not null default 0 check (quantity_on_hand >= 0),
  quantity_reserved numeric(12,2) not null default 0 check (quantity_reserved >= 0),
  min_quantity      numeric(12,2) not null default 0 check (min_quantity >= 0),
  location          text,
  supplier_id       uuid references public.suppliers(id),
  unit_cost         numeric(12,2),
  photo_path        text,
  notes             text,
  archived_at       timestamptz,
  created_at        timestamptz not null default now(),
  created_by        uuid,
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  check (quantity_reserved <= quantity_on_hand)
);
create index inventory_items_part_number_idx on public.inventory_items(lower(part_number));
create index inventory_items_name_idx on public.inventory_items(lower(name));
create index inventory_items_low_idx on public.inventory_items(id) where quantity_on_hand <= min_quantity;

-- Compatibilidad declarada con modelos de la flota
create table public.inventory_item_models (
  item_id  uuid not null references public.inventory_items(id),
  model_id uuid not null references public.vehicle_models(id),
  primary key (item_id, model_id)
);

create table public.inventory_movements (
  id             bigint generated always as identity primary key,
  item_id        uuid not null references public.inventory_items(id),
  movement_type  text not null check (movement_type in
                   ('initial','purchase','return','adjustment_in','adjustment_out','issue','consumption')),
  quantity       numeric(12,2) not null check (quantity <> 0),  -- positivo entra, negativo sale
  balance_after  numeric(12,2) not null,
  unit_cost      numeric(12,2),
  reference_type text,
  reference_id   uuid,
  supplier_id    uuid references public.suppliers(id),
  notes          text,
  performed_by   uuid references public.employees(id),
  performed_at   timestamptz not null default now()
);
create index inventory_movements_item_idx on public.inventory_movements(item_id, performed_at desc);
create index inventory_movements_ref_idx on public.inventory_movements(reference_type, reference_id);

create table public.inventory_reservations (
  id             uuid primary key default gen_random_uuid(),
  item_id        uuid not null references public.inventory_items(id),
  quantity       numeric(12,2) not null check (quantity > 0),
  reference_type text not null,
  reference_id   uuid not null,
  status         text not null default 'active' check (status in ('active','consumed','released')),
  created_by     uuid references public.employees(id),
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz
);
create index inventory_reservations_ref_idx on public.inventory_reservations(reference_type, reference_id) where status = 'active';

create table public.purchase_requests (
  id              uuid primary key default gen_random_uuid(),
  item_id         uuid references public.inventory_items(id),
  catalog_part_id uuid,                 -- enlace blando al catálogo OEM (si está instalado)
  description     text not null,
  part_number     text,
  quantity        numeric(12,2) not null check (quantity > 0),
  reason          text,
  reference_type  text,
  reference_id    uuid,
  supplier_id     uuid references public.suppliers(id),
  status          text not null default 'pending' check (status in ('pending','approved','ordered','received','rejected','cancelled')),
  requested_by    uuid references public.employees(id) default app.current_employee_id(),
  requested_at    timestamptz not null default now(),
  decided_by      uuid references public.employees(id),
  decided_at      timestamptz,
  notes           text
);
create index purchase_requests_status_idx on public.purchase_requests(status);

-- -----------------------------------------------------------------------------
-- Candado: cantidades solo cambian dentro de las funciones de inventario
-- -----------------------------------------------------------------------------
create or replace function app.inventory_guard()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.inventory_tx', true), '') <> 'on' then
    if tg_op = 'INSERT' and (new.quantity_on_hand <> 0 or new.quantity_reserved <> 0) then
      raise exception 'Use inventory_create_item para registrar existencias iniciales' using errcode = '42501';
    elsif tg_op = 'UPDATE' and (new.quantity_on_hand <> old.quantity_on_hand or new.quantity_reserved <> old.quantity_reserved) then
      raise exception 'Las existencias solo cambian con movimientos de inventario' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger inventory_items_guard before insert or update on public.inventory_items
  for each row execute function app.inventory_guard();

-- Movimiento atómico (uso interno; lo llaman otros módulos también)
create or replace function app.inventory_move(p_item uuid, p_qty numeric, p_type text, p_unit_cost numeric default null,
  p_ref_type text default null, p_ref_id uuid default null, p_supplier uuid default null, p_notes text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare it public.inventory_items; v_new numeric; v_mov bigint;
begin
  if p_qty = 0 then raise exception 'La cantidad no puede ser cero' using errcode = '22023'; end if;
  select * into it from public.inventory_items where id = p_item for update;
  if it.id is null then raise exception 'Pieza no encontrada' using errcode = 'P0002'; end if;
  v_new := it.quantity_on_hand + p_qty;
  if v_new < 0 then
    raise exception 'Existencia insuficiente de % (hay %, se requieren %)', it.name, it.quantity_on_hand, abs(p_qty)
      using errcode = '23514';
  end if;
  if v_new < it.quantity_reserved and p_type not in ('consumption') then
    raise exception 'No puede dejar menos existencias (%) que las reservadas (%) para %', v_new, it.quantity_reserved, it.name
      using errcode = '23514';
  end if;
  perform set_config('app.inventory_tx', 'on', true);
  update public.inventory_items set quantity_on_hand = v_new,
         unit_cost = case when p_type = 'purchase' and p_unit_cost is not null then p_unit_cost else unit_cost end
   where id = p_item;
  perform set_config('app.inventory_tx', 'off', true);
  insert into public.inventory_movements(item_id, movement_type, quantity, balance_after, unit_cost, reference_type,
                                         reference_id, supplier_id, notes, performed_by)
  values (p_item, p_type, p_qty, v_new, coalesce(p_unit_cost, it.unit_cost), p_ref_type, p_ref_id, p_supplier, p_notes,
          app.current_employee_id())
  returning id into v_mov;

  if v_new <= it.min_quantity and it.min_quantity > 0 then
    perform app.notify(array['admin','supervisor','mechanic'], 'inventory',
      case when v_new = 0 then 'out_of_stock' else 'low_stock' end,
      case when v_new = 0 then 'Agotado: ' else 'Inventario bajo: ' end || it.name,
      'Quedan ' || v_new || ' ' || it.unit || ' (mínimo ' || it.min_quantity || ')', '/inventario/' || it.id,
      case when v_new = 0 then 'critical' else 'warning' end, 'inventory_item', it.id,
      'stock:' || it.id || ':' || case when v_new = 0 then 'zero' else 'low' end || ':' || current_date);
  end if;
  return v_mov;
end $$;

create or replace function app.inventory_reserve(p_item uuid, p_qty numeric, p_ref_type text, p_ref_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare it public.inventory_items; v_id uuid;
begin
  if p_qty <= 0 then raise exception 'Cantidad inválida' using errcode = '22023'; end if;
  select * into it from public.inventory_items where id = p_item for update;
  if it.id is null then raise exception 'Pieza no encontrada' using errcode = 'P0002'; end if;
  if it.quantity_on_hand - it.quantity_reserved < p_qty then
    raise exception 'Disponible insuficiente de % (disponible %, solicitado %)',
      it.name, it.quantity_on_hand - it.quantity_reserved, p_qty using errcode = '23514';
  end if;
  perform set_config('app.inventory_tx', 'on', true);
  update public.inventory_items set quantity_reserved = quantity_reserved + p_qty where id = p_item;
  perform set_config('app.inventory_tx', 'off', true);
  insert into public.inventory_reservations(item_id, quantity, reference_type, reference_id, created_by)
  values (p_item, p_qty, p_ref_type, p_ref_id, app.current_employee_id()) returning id into v_id;
  return v_id;
end $$;

create or replace function app.inventory_release(p_ref_type text, p_ref_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select * from public.inventory_reservations
            where reference_type = p_ref_type and reference_id = p_ref_id and status = 'active' for update loop
    perform 1 from public.inventory_items where id = r.item_id for update;
    perform set_config('app.inventory_tx', 'on', true);
    update public.inventory_items set quantity_reserved = quantity_reserved - r.quantity where id = r.item_id;
    perform set_config('app.inventory_tx', 'off', true);
    update public.inventory_reservations set status = 'released', resolved_at = now() where id = r.id;
  end loop;
end $$;

-- Consume: libera primero lo reservado para esa referencia y descuenta existencias
create or replace function app.inventory_consume(p_item uuid, p_qty numeric, p_ref_type text, p_ref_id uuid,
                                                 p_notes text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_res numeric;
begin
  if p_qty <= 0 then raise exception 'Cantidad inválida' using errcode = '22023'; end if;
  select coalesce(sum(quantity), 0) into v_res from public.inventory_reservations
   where item_id = p_item and reference_type = p_ref_type and reference_id = p_ref_id and status = 'active';
  if v_res > 0 then
    perform 1 from public.inventory_items where id = p_item for update;
    perform set_config('app.inventory_tx', 'on', true);
    update public.inventory_items set quantity_reserved = quantity_reserved - v_res where id = p_item;
    perform set_config('app.inventory_tx', 'off', true);
    update public.inventory_reservations set status = 'consumed', resolved_at = now()
     where item_id = p_item and reference_type = p_ref_type and reference_id = p_ref_id and status = 'active';
    -- Sobrante reservado se vuelve a reservar si se consumió menos de lo reservado
    if v_res > p_qty then
      perform app.inventory_reserve(p_item, v_res - p_qty, p_ref_type, p_ref_id);
    end if;
  end if;
  return app.inventory_move(p_item, -p_qty, 'consumption', null, p_ref_type, p_ref_id, null, p_notes);
end $$;

-- -----------------------------------------------------------------------------
-- API pública (con permisos)
-- -----------------------------------------------------------------------------
-- p: {sku, name, part_number, manufacturer, category, description, unit, min_quantity, location,
--     supplier_id, unit_cost, notes, initial_quantity, model_ids:[uuid]}
create or replace function public.inventory_create_item(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform app.require_perm('inventory.create');
  insert into public.inventory_items(sku, name, part_number, manufacturer, category, description, unit, min_quantity,
                                     location, supplier_id, unit_cost, notes)
  values (upper(trim(p->>'sku')), p->>'name', nullif(p->>'part_number',''), p->>'manufacturer', p->>'category',
          p->>'description', coalesce(nullif(p->>'unit',''),'unidad'), coalesce((p->>'min_quantity')::numeric,0),
          p->>'location', nullif(p->>'supplier_id','')::uuid, (p->>'unit_cost')::numeric, p->>'notes')
  returning id into v_id;
  insert into public.inventory_item_models(item_id, model_id)
  select v_id, x::uuid from jsonb_array_elements_text(coalesce(p->'model_ids','[]')) x;
  if coalesce((p->>'initial_quantity')::numeric, 0) > 0 then
    perform app.inventory_move(v_id, (p->>'initial_quantity')::numeric, 'initial', (p->>'unit_cost')::numeric,
                               null, null, nullif(p->>'supplier_id','')::uuid, 'Existencia inicial');
  end if;
  return v_id;
end $$;

create or replace function public.inventory_set_models(p_item uuid, p_models uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  perform app.require_perm('inventory.edit');
  delete from public.inventory_item_models where item_id = p_item and model_id <> all(coalesce(p_models, '{}'));
  insert into public.inventory_item_models select p_item, unnest(p_models) on conflict do nothing;
end $$;

create or replace function public.inventory_receive(p_item uuid, p_qty numeric, p_unit_cost numeric default null,
  p_supplier uuid default null, p_notes text default null, p_purchase_request uuid default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  perform app.require_perm('inventory.receive');
  if p_qty <= 0 then raise exception 'La cantidad debe ser mayor que cero' using errcode = '22023'; end if;
  v := app.inventory_move(p_item, p_qty, 'purchase', p_unit_cost, case when p_purchase_request is not null then 'purchase_request' end,
                          p_purchase_request, p_supplier, p_notes);
  if p_purchase_request is not null then
    update public.purchase_requests set status = 'received', item_id = coalesce(item_id, p_item) where id = p_purchase_request;
  end if;
  return v;
end $$;

create or replace function public.inventory_issue(p_item uuid, p_qty numeric, p_notes text)
returns bigint language plpgsql security definer set search_path = public as $$
begin
  perform app.require_perm('inventory.issue');
  if p_qty <= 0 then raise exception 'La cantidad debe ser mayor que cero' using errcode = '22023'; end if;
  return app.inventory_move(p_item, -p_qty, 'issue', null, null, null, null, p_notes);
end $$;

-- Ajuste por conteo físico: fija la existencia real
create or replace function public.inventory_count(p_item uuid, p_counted numeric, p_notes text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_cur numeric;
begin
  perform app.require_perm('inventory.adjust');
  if coalesce(trim(p_notes), '') = '' then raise exception 'Indique el motivo del ajuste' using errcode = '22023'; end if;
  select quantity_on_hand into v_cur from public.inventory_items where id = p_item for update;
  if p_counted = v_cur then return null; end if;
  return app.inventory_move(p_item, p_counted - v_cur,
    case when p_counted > v_cur then 'adjustment_in' else 'adjustment_out' end, null, null, null, null, p_notes);
end $$;

create or replace function public.request_purchase(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform app.require_perm('inventory.request');
  insert into public.purchase_requests(item_id, catalog_part_id, description, part_number, quantity, reason,
                                       reference_type, reference_id, supplier_id)
  values (nullif(p->>'item_id','')::uuid, nullif(p->>'catalog_part_id','')::uuid, p->>'description',
          nullif(p->>'part_number',''), coalesce((p->>'quantity')::numeric, 1), p->>'reason',
          p->>'reference_type', nullif(p->>'reference_id','')::uuid, nullif(p->>'supplier_id','')::uuid)
  returning id into v_id;
  perform app.notify(array['admin','supervisor'], 'inventory', 'purchase_requested',
    'Solicitud de compra: ' || (p->>'description'), coalesce(p->>'reason',''), '/inventario/compras', 'info',
    'purchase_request', v_id);
  return v_id;
end $$;

create or replace function public.set_purchase_request_status(p_id uuid, p_status text, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform app.require_perm('inventory.approve');
  if p_status not in ('approved','ordered','rejected','cancelled') then
    raise exception 'Estado inválido' using errcode = '22023';
  end if;
  update public.purchase_requests set status = p_status, notes = coalesce(p_notes, notes),
         decided_by = app.current_employee_id(), decided_at = now()
   where id = p_id;
end $$;

-- Reportes
create or replace view public.inventory_consumption with (security_invoker = true) as
  select m.item_id, i.sku, i.name, i.category, date_trunc('month', m.performed_at)::date as month,
         sum(-m.quantity) as quantity, sum(-m.quantity * coalesce(m.unit_cost, 0))::numeric(12,2) as cost
    from public.inventory_movements m join public.inventory_items i on i.id = m.item_id
   where m.movement_type in ('consumption','issue')
   group by m.item_id, i.sku, i.name, i.category, date_trunc('month', m.performed_at);

create or replace function app.inventory_alerts()
returns void language plpgsql security definer set search_path = public as $$
declare it record;
begin
  for it in select * from public.inventory_items where archived_at is null and min_quantity > 0
             and quantity_on_hand <= min_quantity loop
    perform app.notify(array['admin','supervisor'], 'inventory', 'low_stock', 'Inventario bajo: ' || it.name,
      'Quedan ' || it.quantity_on_hand || ' (mínimo ' || it.min_quantity || ')', '/inventario/' || it.id, 'warning',
      'inventory_item', it.id, 'stock_daily:' || it.id || ':' || to_char(current_date, 'IYYY-IW'));
  end loop;
end $$;
insert into public.alert_jobs values ('inventory', 'inventory_alerts') on conflict do nothing;

insert into public.permissions (id, module_id, action, label, sort) values
  ('inventory.view',    'inventory', 'view',    'Ver inventario y movimientos', 1),
  ('inventory.create',  'inventory', 'create',  'Añadir piezas', 2),
  ('inventory.edit',    'inventory', 'edit',    'Editar piezas y proveedores', 3),
  ('inventory.receive', 'inventory', 'receive', 'Registrar compras / entradas', 4),
  ('inventory.issue',   'inventory', 'issue',   'Registrar salidas manuales', 5),
  ('inventory.consume', 'inventory', 'consume', 'Reservar y consumir piezas en órdenes', 6),
  ('inventory.adjust',  'inventory', 'adjust',  'Ajustes por conteo físico', 7),
  ('inventory.request', 'inventory', 'request', 'Solicitar compras', 8),
  ('inventory.approve', 'inventory', 'approve', 'Aprobar solicitudes de compra', 9)
on conflict (id) do nothing;
insert into public.role_permissions values
  ('supervisor','inventory.view'), ('supervisor','inventory.request'), ('supervisor','inventory.approve'),
  ('mechanic','inventory.view'), ('mechanic','inventory.consume'), ('mechanic','inventory.request')
on conflict do nothing;

alter table public.suppliers              enable row level security;
alter table public.inventory_items        enable row level security;
alter table public.inventory_item_models  enable row level security;
alter table public.inventory_movements    enable row level security;
alter table public.inventory_reservations enable row level security;
alter table public.purchase_requests      enable row level security;
create policy suppliers_read on public.suppliers for select to authenticated using ((select app.has_perm('inventory.view')));
create policy suppliers_insert on public.suppliers for insert to authenticated with check ((select app.has_perm('inventory.edit')));
create policy suppliers_update on public.suppliers for update to authenticated
  using ((select app.has_perm('inventory.edit'))) with check ((select app.has_perm('inventory.edit')));
create policy items_read on public.inventory_items for select to authenticated using ((select app.has_perm('inventory.view')));
create policy items_update on public.inventory_items for update to authenticated
  using ((select app.has_perm('inventory.edit'))) with check ((select app.has_perm('inventory.edit')));
create policy item_models_read on public.inventory_item_models for select to authenticated using ((select app.has_perm('inventory.view')));
create policy movements_read on public.inventory_movements for select to authenticated using ((select app.has_perm('inventory.view')));
create policy reservations_read on public.inventory_reservations for select to authenticated using ((select app.has_perm('inventory.view')));
create policy pr_read on public.purchase_requests for select to authenticated
  using ((select app.has_perm('inventory.view')) or requested_by = (select app.current_employee_id()));
revoke insert on public.inventory_items, public.inventory_item_models, public.inventory_movements,
  public.inventory_reservations, public.purchase_requests from authenticated;
revoke update on public.inventory_movements, public.inventory_reservations, public.purchase_requests,
  public.inventory_item_models from authenticated;

do $$ begin
  perform app.track('public.suppliers');
  perform app.track('public.inventory_items');
  perform app.track('public.purchase_requests', false);
end $$;
