-- =============================================================================
-- INVENTARIO · Costos solo para quien tenga inventory.view_costs (admin)
-- Los demás ven las cantidades, nunca el precio ni el valor en existencia.
-- La columna unit_cost deja de ser legible por la API; el admin la obtiene por RPC.
-- =============================================================================
insert into public.permissions (id, module_id, action, label, sort) values
  ('inventory.view_costs', 'inventory', 'view_costs', 'Ver precios y valor del inventario', 10)
on conflict (id) do nothing;

-- Mecánicos: pueden añadir piezas y registrar entradas (no editar lo ya guardado)
insert into public.role_permissions values
  ('mechanic','inventory.create'), ('mechanic','inventory.receive')
on conflict do nothing;

-- Lectura por columnas: todas menos unit_cost
do $$
declare t text; cols text;
begin
  foreach t in array array['inventory_items', 'inventory_movements'] loop
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
      from information_schema.columns
     where table_schema = 'public' and table_name = t and column_name <> 'unit_cost';
    execute format('revoke select on public.%I from anon, authenticated', t);
    execute format('grant select (%s) on public.%I to authenticated', cols, t);
  end loop;
end $$;

-- Precios actuales por pieza (solo con permiso)
create or replace function public.inventory_item_costs(p_item uuid default null)
returns table (id uuid, unit_cost numeric)
language sql stable security definer set search_path = public as $$
  select i.id, i.unit_cost from public.inventory_items i
   where app.has_perm('inventory.view_costs') and (p_item is null or i.id = p_item);
$$;

create or replace function public.inventory_movement_costs(p_item uuid)
returns table (id bigint, unit_cost numeric)
language sql stable security definer set search_path = public as $$
  select m.id, m.unit_cost from public.inventory_movements m
   where app.has_perm('inventory.view_costs') and m.item_id = p_item;
$$;

-- Consumo mensual: el costo solo sale con permiso
create or replace view public.inventory_consumption as
  select m.item_id, i.sku, i.name, i.category, date_trunc('month', m.performed_at)::date as month,
         sum(-m.quantity) as quantity,
         (case when app.has_perm('inventory.view_costs')
              then sum(-m.quantity * coalesce(m.unit_cost, 0)) end)::numeric(12,2) as cost
    from public.inventory_movements m join public.inventory_items i on i.id = m.item_id
   where m.movement_type in ('consumption','issue') and app.has_perm('inventory.view')
   group by m.item_id, i.sku, i.name, i.category, date_trunc('month', m.performed_at);
-- La vista lee unit_cost con los privilegios del dueño y filtra con has_perm
alter view public.inventory_consumption set (security_invoker = false);
revoke all on public.inventory_consumption from anon;
grant select on public.inventory_consumption to authenticated;
