-- DEMO — datos de ejemplo. Se crean usando las mismas funciones del sistema,
-- como lo haría cada usuario, para que historial, costos y alertas sean coherentes.
-- Ningún número de pieza OEM ni intervalo aquí es dato del fabricante.
create schema if not exists demo;
create table demo.files (path text primary key, mime text, data bytea);

create or replace function demo.as_user(p_code text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', (select auth_user_id::text from public.employees where employee_code = p_code), false);
$$;

-- En el demo el navegador no comparte ubicación: los ponches no la exigen
update public.app_settings set value = jsonb_set(value, '{require_location}', 'false') where key = 'timeclock';
update public.app_settings set value = '{"name": "Agro Servicios del Norte (demo)", "timezone": "America/Puerto_Rico"}' where key = 'company';
update public.app_settings set value = jsonb_set(value, '{default_labor_rate}', '45') where key = 'workorders';
update public.app_settings set value = jsonb_set(value, '{deadline_time}', '"06:00"') where key = 'inspections';

-- Empleados
select public.bootstrap_admin('ADMIN', 'Marisol Rivera', '482615');
insert into auth.users(id) select gen_random_uuid() from generate_series(1, 8);
update public.employees set auth_user_id = (select id from auth.users order by id limit 1) where employee_code = 'ADMIN';
select demo.as_user('ADMIN');
select public.create_employee('SUP1', 'Javier Ortiz', 'supervisor', '82641', '787-555-0110', 'Supervisor de campo', current_date - 900);
select public.create_employee('CH01', 'Carlos Méndez', 'driver', '7391', '787-555-0121', 'Operador', current_date - 600);
select public.create_employee('CH02', 'Diana Colón', 'driver', '7392', '787-555-0122', 'Operadora', current_date - 400);
select public.create_employee('CH03', 'Luis Torres', 'driver', '7393', '787-555-0123', 'Operador', current_date - 120);
select public.create_employee('MEC1', 'Mario Santiago', 'mechanic', '5519', '787-555-0131', 'Mecánico líder', current_date - 1200);
select public.create_employee('MEC2', 'Andrés Vega', 'mechanic', '5520', '787-555-0132', 'Mecánico', current_date - 300);
update public.employees e set auth_user_id = u.id
  from (select id, row_number() over (order by id) rn from auth.users) u,
       (select id, row_number() over (order by employee_code) + 1 rn from public.employees where employee_code <> 'ADMIN') x
 where x.id = e.id and u.rn = x.rn;

-- Flota
insert into public.vehicles (unit_number, model_id, vin, acquired_at, engine_hours, mileage, current_location, warranty_expires_at)
select v.u, m.id, v.vin, current_date - v.age, v.h, v.mi, v.loc, case when v.age < 500 then current_date - v.age + 730 end
  from (values
    ('UTV-01', 'Yanmar', null::int, 'YNB-DEMO-0001', 720, 1180.0, null::numeric, 'Base principal'),
    ('UTV-02', 'Yanmar', null, 'YNB-DEMO-0002', 410, 642.5, null, 'Finca Norte'),
    ('UTV-03', 'Yanmar', null, 'YNB-DEMO-0003', 90, 96.0, null, 'Base principal'),
    ('ATV-18A', 'Can-Am', 2018, 'CAM18-DEMO-0001', 2100, 1510.0, 8450.0, 'Base principal'),
    ('ATV-18B', 'Can-Am', 2018, 'CAM18-DEMO-0002', 2100, 1388.5, 7920.0, 'Finca Sur'),
    ('ATV-24A', 'Can-Am', 2024, 'CAM24-DEMO-0001', 300, 212.0, 1305.0, 'Finca Norte'),
    ('ATV-24B', 'Can-Am', 2024, 'CAM24-DEMO-0002', 300, 184.5, 1120.0, 'Base principal')
  ) v(u, mk, yr, vin, age, h, mi, loc)
  join public.vehicle_models m on m.manufacturer = v.mk and m.year is not distinct from v.yr;

select public.assign_vehicle((select id from vehicles where unit_number = 'UTV-01'), (select id from employees where employee_code = 'CH01'));
select public.assign_vehicle((select id from vehicles where unit_number = 'ATV-24A'), (select id from employees where employee_code = 'CH02'));
select public.assign_vehicle((select id from vehicles where unit_number = 'UTV-02'), (select id from employees where employee_code = 'CH03'));

-- Intervalos de EJEMPLO (en producción se cargan desde el manual oficial)
insert into public.maintenance_intervals (model_id, maintenance_type_id, interval_hours, interval_days, source_reference)
select m.id, t.id, x.h, x.d, 'EJEMPLO DEMO — reemplazar con el manual del fabricante'
  from public.vehicle_models m cross join (values ('Cambio de aceite', 100, 180), ('Filtro de aire', 200, 365), ('Inspección de frenos', 150, 120)) x(n, h, d)
  join public.maintenance_types t on t.name = x.n;

-- Historial de mantenimientos anteriores
select demo.as_user('MEC1');
do $$
declare r record; v_id uuid;
begin
  for r in select v.id, v.engine_hours, t.id as tid, t.name from vehicles v, maintenance_types t
            where t.name in ('Cambio de aceite','Filtro de aire','Inspección de frenos') and v.unit_number <> 'ATV-18A' loop
    v_id := public.schedule_maintenance(jsonb_build_object('vehicle_id', r.id, 'maintenance_type_id', r.tid));
    perform public.complete_maintenance(v_id, jsonb_build_object(
      'performed_at', now() - interval '20 days',
      'labor_hours', 0.75, 'cost_labor', 34, 'cost_parts', case r.name when 'Cambio de aceite' then 38 when 'Filtro de aire' then 22 else 0 end,
      'notes', 'Servicio de rutina'));
    update maintenance_records set engine_hours = greatest(r.engine_hours - case r.name when 'Cambio de aceite' then 85 when 'Filtro de aire' then 60 else 30 end, 0),
           next_due_hours = greatest(r.engine_hours - case r.name when 'Cambio de aceite' then 85 when 'Filtro de aire' then 60 else 30 end, 0)
             + case r.name when 'Cambio de aceite' then 100 when 'Filtro de aire' then 200 else 150 end
     where id = v_id;
  end loop;
end $$;
select app.maintenance_refresh_vehicle(id) from vehicles;

-- Proveedores e inventario (artículos internos de ejemplo)
select demo.as_user('ADMIN');
insert into public.suppliers (name, contact, phone) values
  ('Repuestos Motoriza (demo)', 'Ana Báez', '787-555-0200'), ('Lubricantes del Caribe (demo)', 'Pedro Lugo', '787-555-0201');
select public.inventory_create_item(jsonb_build_object('sku', x.sku, 'name', x.n, 'category', x.c, 'unit', x.u, 'min_quantity', x.mn,
         'initial_quantity', x.q, 'unit_cost', x.cost, 'location', x.loc, 'supplier_id', (select id from suppliers order by name limit 1),
         'model_ids', (select jsonb_agg(id) from vehicle_models where manufacturer = any(x.mk))))
  from (values
    ('ACE-10W40', 'Aceite de motor 10W-40 (litro)', 'Lubricantes', 'litro', 12, 36, 9.50, 'Estante A1', array['Yanmar','Can-Am']),
    ('FIL-ACE-Y', 'Filtro de aceite Yanmar Bull', 'Filtros', 'unidad', 3, 5, 14.00, 'Estante A2', array['Yanmar']),
    ('FIL-ACE-C', 'Filtro de aceite Can-Am Outlander', 'Filtros', 'unidad', 3, 2, 16.50, 'Estante A2', array['Can-Am']),
    ('FIL-AIR-Y', 'Filtro de aire Yanmar Bull', 'Filtros', 'unidad', 2, 4, 28.00, 'Estante A3', array['Yanmar']),
    ('FIL-AIR-C', 'Filtro de aire Can-Am Outlander', 'Filtros', 'unidad', 2, 3, 31.00, 'Estante A3', array['Can-Am']),
    ('PAS-DEL-Y', 'Pastillas de freno delanteras Yanmar', 'Frenos', 'juego', 2, 4, 42.00, 'Estante B1', array['Yanmar']),
    ('PAS-DEL-C', 'Pastillas de freno delanteras Can-Am', 'Frenos', 'juego', 2, 1, 46.00, 'Estante B1', array['Can-Am']),
    ('LIQ-DOT4', 'Líquido de frenos DOT 4', 'Frenos', 'botella', 2, 6, 8.75, 'Estante B2', array['Yanmar','Can-Am']),
    ('BUJ-CAN', 'Bujía Can-Am Outlander', 'Encendido', 'unidad', 4, 0, 11.00, 'Estante C1', array['Can-Am']),
    ('COR-CVT-C', 'Correa CVT Can-Am Outlander', 'Transmisión', 'unidad', 1, 2, 165.00, 'Estante C3', array['Can-Am']),
    ('REF-50-50', 'Refrigerante 50/50 (galón)', 'Enfriamiento', 'galón', 2, 5, 18.00, 'Estante A4', array['Yanmar','Can-Am']),
    ('GRASA-MP', 'Grasa multipropósito (tubo)', 'Lubricantes', 'tubo', 3, 9, 6.25, 'Estante A1', array['Yanmar','Can-Am'])
  ) x(sku, n, c, u, mn, q, cost, loc, mk);

-- Operaciones
select demo.as_user('SUP1');
select public.save_operation(jsonb_build_object('title', x.t, 'location_name', x.l, 'description', x.d,
         'starts_at', date_trunc('day', now()) + make_interval(days => x.dd, hours => x.h1),
         'ends_at', date_trunc('day', now()) + make_interval(days => x.dd, hours => x.h2),
         'vehicle_ids', (select jsonb_agg(id) from vehicles where unit_number = any(x.v)),
         'employees', (select jsonb_agg(jsonb_build_object('employee_id', id)) from employees where employee_code = any(x.e))))
  from (values
    ('Riego y mantenimiento de canales', 'Finca Norte', 'Limpieza de canales del lote 4', 0, 11, 17, array['ATV-24A'], array['CH02']),
    ('Transporte de insumos', 'Base principal → Finca Sur', 'Fertilizante para lotes 7 y 8', 0, 13, 16, array['UTV-02'], array['CH03']),
    ('Inspección de cercas', 'Finca Sur', 'Recorrido perímetro sur', 1, 11, 15, array['ATV-24B'], array['CH03']),
    ('Cosecha lote 2', 'Finca Norte', null, 2, 10, 18, array['UTV-02','ATV-24A'], array['CH02','CH03']),
    ('Recogida de material', 'Base principal', null, -1, 12, 15, array['UTV-03'], array['CH01'])
  ) x(t, l, d, dd, h1, h2, v, e);
select public.set_operation_status((select id from operations where title = 'Recogida de material'), 'completed');

-- Inspecciones de hoy: una con falla crítica, una conforme
select demo.as_user('CH01');
select public.submit_inspection(v.id, public.inspection_template_for(v.id),
  (select jsonb_agg(jsonb_build_object('item_id', i.id, 'result', case when i.label = 'Frenos' then 'fail' else 'ok' end,
     'comment', case when i.label = 'Frenos' then 'El pedal se siente esponjoso y frena tarde' end))
     from inspection_template_items i where i.template_id = public.inspection_template_for(v.id)),
  'Revisar frenos antes de salir', 1182.5, null, 'half')
  from vehicles v where v.unit_number = 'UTV-01';
select demo.as_user('CH02');
select public.submit_inspection(v.id, public.inspection_template_for(v.id),
  (select jsonb_agg(jsonb_build_object('item_id', i.id, 'result', case when i.label = 'Espejos' then 'fail' else 'ok' end,
     'comment', case when i.label = 'Espejos' then 'Espejo izquierdo flojo' end))
     from inspection_template_items i where i.template_id = public.inspection_template_for(v.id)),
  null, 213.4, 1311, 'three_quarters')
  from vehicles v where v.unit_number = 'ATV-24A';
select demo.as_user('SUP1');
select public.set_operation_status((select id from operations where title = 'Riego y mantenimiento de canales'), 'in_progress');

-- Taller: orden desde la inspección, en reparación, con pieza reservada
select public.create_work_order(jsonb_build_object('vehicle_id', (select id from vehicles where unit_number = 'UTV-01'),
  'reported_problem', 'Frenos esponjosos (inspección diaria)', 'priority', 'high', 'source_type', 'inspection',
  'source_id', (select id from inspections order by completed_at limit 1),
  'assigned_mechanic_id', (select id from employees where employee_code = 'MEC1')));
select demo.as_user('MEC1');
select public.diagnose_work_order((select id from work_orders where reported_problem like 'Frenos%'), 'Pastillas delanteras al límite y aire en el circuito. Cambiar pastillas y purgar el sistema.');
select public.add_work_order_part((select id from work_orders where reported_problem like 'Frenos%'),
  jsonb_build_object('inventory_item_id', (select id from inventory_items where sku = 'PAS-DEL-Y'), 'quantity', 1));
select public.add_work_order_part((select id from work_orders where reported_problem like 'Frenos%'),
  jsonb_build_object('inventory_item_id', (select id from inventory_items where sku = 'LIQ-DOT4'), 'quantity', 1));
select public.set_work_order_status((select id from work_orders where reported_problem like 'Frenos%'), 'in_repair');
select public.add_work_order_labor((select id from work_orders where reported_problem like 'Frenos%'), 1.0, 'Desmontaje y revisión');

-- Orden completada la semana pasada (con costos en el historial)
select demo.as_user('SUP1');
select public.create_work_order(jsonb_build_object('vehicle_id', (select id from vehicles where unit_number = 'ATV-18B'),
  'reported_problem', 'Ruido en la transmisión al acelerar', 'priority', 'normal',
  'assigned_mechanic_id', (select id from employees where employee_code = 'MEC2')));
select demo.as_user('MEC2');
select public.diagnose_work_order((select id from work_orders where reported_problem like 'Ruido%'), 'Correa CVT desgastada.');
select public.add_work_order_part((select id from work_orders where reported_problem like 'Ruido%'),
  jsonb_build_object('inventory_item_id', (select id from inventory_items where sku = 'COR-CVT-C'), 'quantity', 1));
select public.set_work_order_status((select id from work_orders where reported_problem like 'Ruido%'), 'in_repair');
select public.consume_work_order_part((select id from work_order_parts where description like 'Correa%'), 1);
select public.add_work_order_labor((select id from work_orders where reported_problem like 'Ruido%'), 2.5, 'Cambio de correa CVT y prueba');
select public.complete_work_order((select id from work_orders where reported_problem like 'Ruido%'), 'Probado en ruta, sin ruido', 1390);
update work_orders set created_at = now() - interval '7 days', completed_at = now() - interval '6 days' where reported_problem like 'Ruido%';
update vehicle_timeline set occurred_at = now() - interval '6 days' where entity_id = (select id from work_orders where reported_problem like 'Ruido%');

-- Orden nueva sin asignar y ATV-18A en reparación esperando piezas
select demo.as_user('SUP1');
select public.create_work_order(jsonb_build_object('vehicle_id', (select id from vehicles where unit_number = 'ATV-18A'),
  'reported_problem', 'No enciende en frío, falla al arrancar', 'priority', 'critical'));
select public.create_work_order(jsonb_build_object('vehicle_id', (select id from vehicles where unit_number = 'ATV-24A'),
  'reported_problem', 'Espejo izquierdo flojo (inspección)', 'priority', 'low', 'source_type', 'inspection'));
select demo.as_user('MEC2');
select public.diagnose_work_order((select id from work_orders where reported_problem like 'No enciende%'), 'Bujía deteriorada. No hay existencia en inventario.');
select public.add_work_order_part((select id from work_orders where reported_problem like 'No enciende%'),
  jsonb_build_object('inventory_item_id', (select id from inventory_items where sku = 'BUJ-CAN'), 'quantity', 1, 'reserve', false, 'to_purchase', true));

-- Combustible
select demo.as_user('CH01');
insert into fuel_logs (vehicle_id, purchased_at, quantity, amount, fuel_type, station, notes)
select v.id, now() - make_interval(days => d), q, round(q * 4.15, 2), 'regular', 'Gasolinera Ruta 2', null
  from vehicles v, (values (2, 4.2), (9, 3.8), (16, 4.5)) x(d, q) where v.unit_number = 'UTV-01';
select demo.as_user('CH02');
insert into fuel_logs (vehicle_id, purchased_at, quantity, amount, fuel_type, station)
select v.id, now() - make_interval(days => d), q, round(q * 4.29, 2), 'premium', 'Estación Norte'
  from vehicles v, (values (3, 3.1), (11, 2.9)) x(d, q) where v.unit_number = 'ATV-24A';

-- Ponches de hoy
select demo.as_user('CH02'); select public.punch('in', 18.4632, -66.2654, 8);
update time_punches set punched_at = date_trunc('day', now()) + interval '10 hours 55 minutes' where employee_id = (select id from employees where employee_code = 'CH02');
select demo.as_user('CH03'); select public.punch('in', 18.4630, -66.2650, 12);
update time_punches set punched_at = date_trunc('day', now()) + interval '11 hours 5 minutes' where employee_id = (select id from employees where employee_code = 'CH03');
select demo.as_user('MEC1'); select public.punch('in', 18.4630, -66.2650, 10);
update time_punches set punched_at = date_trunc('day', now()) + interval '11 hours' where employee_id = (select id from employees where employee_code = 'MEC1');

-- Incidente leve abierto
select demo.as_user('CH03');
select public.report_incident(jsonb_build_object('incident_type', 'property_damage', 'severity', 'minor',
  'vehicle_id', (select id from vehicles where unit_number = 'UTV-02'), 'occurred_at', now() - interval '1 day',
  'location_text', 'Portón de entrada, Finca Norte', 'description', 'Rocé el poste del portón al entrar. Daño menor en el guardafangos derecho.',
  'vehicle_operable', true));

-- Documentos
select demo.as_user('ADMIN');
insert into documents (owner_type, vehicle_id, category, title, document_number, issued_at, expires_at)
select 'vehicle', v.id, x.c, x.t, x.n, current_date - 340, current_date + x.e
  from vehicles v, (values ('insurance', 'Póliza de seguro', 'POL-DEMO', 12), ('registration', 'Registro', 'REG-DEMO', 200)) x(c, t, n, e)
 where v.unit_number in ('UTV-01', 'ATV-24A', 'ATV-18A');
insert into documents (owner_type, employee_id, category, title, issued_at, expires_at)
select 'employee', id, 'license', 'Licencia de conducir', current_date - 1000, current_date + 25 from employees where employee_code = 'CH01';

-- GPS: últimas posiciones (zona de ejemplo)
insert into gps_positions (vehicle_id, recorded_at, lat, lng, speed_kmh, source)
select v.id, now() - make_interval(mins => (row_number() over ())::int), 18.43 + random() * 0.05, -66.30 + random() * 0.08,
       case when v.status = 'in_operation' then 14 else 0 end, 'tracker'
  from vehicles v;
insert into gps_positions (vehicle_id, recorded_at, lat, lng, speed_kmh, source)
select v.id, now() - make_interval(mins => g * 6), 18.445 + g * 0.0012, -66.27 + sin(g / 3.0) * 0.004, 12 + g % 5, 'tracker'
  from vehicles v, generate_series(1, 30) g where v.unit_number = 'ATV-24A';

select public.run_alerts();
select set_config('request.jwt.claim.sub', '', false);
