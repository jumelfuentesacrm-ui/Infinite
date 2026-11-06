-- =============================================================================
-- INVENTARIO · Uso y desgaste de piezas (solo administración)
-- Cuenta las piezas GASTADAS: salidas por órdenes de trabajo, mantenimientos y
-- salidas manuales. Las compras y entradas no cuentan.
-- =============================================================================
insert into public.permissions (id, module_id, action, label, sort) values
  ('inventory.usage_report', 'inventory', 'usage_report', 'Ver reporte de uso y desgaste de piezas', 9)
on conflict (id) do nothing;   -- sin rol asignado: solo el administrador (tiene todos)

-- Las piezas de inventario usadas en un mantenimiento se descuentan del inventario
-- (antes solo se anotaban). Así cuentan en el reporte de desgaste.
do $$ begin
  if to_regclass('public.maintenance_record_parts') is not null then
    execute $f$
      create or replace function app.maintenance_part_consume()
      returns trigger language plpgsql security definer set search_path = public as $b$
      begin
        if new.inventory_item_id is not null then
          perform app.inventory_consume(new.inventory_item_id, new.quantity, 'maintenance_record_part', new.id,
                                        'Mantenimiento: ' || new.description);
        end if;
        return new;
      end $b$;
    $f$;
    execute 'create or replace trigger zz_inventory_consume after insert on public.maintenance_record_parts
             for each row execute function app.maintenance_part_consume()';
  end if;
end $$;

-- ¿A qué vehículo fue la pieza? (según de dónde salió)
create or replace function app.movement_vehicle(p_type text, p_id uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  if p_id is null then return null; end if;
  if p_type = 'work_order_part' and to_regclass('public.work_order_parts') is not null then
    execute 'select w.vehicle_id from public.work_order_parts p join public.work_orders w on w.id = p.work_order_id where p.id = $1'
      into v using p_id;
  elsif p_type = 'maintenance_record_part' and to_regclass('public.maintenance_record_parts') is not null then
    execute 'select r.vehicle_id from public.maintenance_record_parts p join public.maintenance_records r on r.id = p.record_id where p.id = $1'
      into v using p_id;
  end if;
  return v;
end $$;

-- Reporte: piezas gastadas en el periodo, de mayor a menor número de usos, con el acumulado del año (YTD).
-- Un "uso" es una salida (cada vez que la pieza se instaló o se sacó para usarse).
create or replace function public.parts_usage_report(p_from date, p_to date)
returns table (item_id uuid, sku text, name text, part_number text, category text, unit text,
               uses int, quantity numeric, vehicles int,
               uses_ytd int, quantity_ytd numeric, vehicles_ytd int, last_used timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text := coalesce((select value->>'timezone' from public.app_settings where key = 'company'), 'America/Puerto_Rico');
  v_from timestamptz; v_to timestamptz; v_year timestamptz;
begin
  perform app.require_perm('inventory.usage_report');
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Periodo inválido' using errcode = '22023';
  end if;
  v_from := p_from::timestamp at time zone v_tz;
  v_to   := (p_to + 1)::timestamp at time zone v_tz;
  v_year := date_trunc('year', p_to)::timestamp at time zone v_tz;   -- YTD del año del periodo, hasta el fin del periodo

  return query
  with mv as (
    select m.item_id, m.performed_at, m.movement_type,
           -m.quantity as qty,
           app.movement_vehicle(m.reference_type, m.reference_id) as vehicle_id
      from public.inventory_movements m
     where m.movement_type in ('consumption', 'issue')
       and m.performed_at >= least(v_from, v_year) and m.performed_at < v_to
  ), agg as (
    select mv.item_id,
           count(*) filter (where mv.performed_at >= v_from)::int as uses,
           coalesce(sum(mv.qty) filter (where mv.performed_at >= v_from), 0) as quantity,
           count(distinct mv.vehicle_id) filter (where mv.performed_at >= v_from)::int as vehicles,
           count(*) filter (where mv.performed_at >= v_year)::int as uses_ytd,
           coalesce(sum(mv.qty) filter (where mv.performed_at >= v_year), 0) as quantity_ytd,
           count(distinct mv.vehicle_id) filter (where mv.performed_at >= v_year)::int as vehicles_ytd,
           max(mv.performed_at) as last_used
      from mv group by mv.item_id
  )
  select i.id, i.sku, i.name, i.part_number, i.category, i.unit,
         a.uses, a.quantity, a.vehicles, a.uses_ytd, a.quantity_ytd, a.vehicles_ytd, a.last_used
    from agg a join public.inventory_items i on i.id = a.item_id
   where a.uses_ytd > 0 or a.uses > 0
   order by a.uses desc, a.quantity desc, a.uses_ytd desc, i.name;
end $$;
revoke execute on function app.movement_vehicle(text, uuid) from public, anon, authenticated;
