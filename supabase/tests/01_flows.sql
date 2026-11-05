-- Pruebas de extremo a extremo con RLS real. Ejecutar sobre una BD con stub + migraciones.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create or replace function pg_temp.login(p_code text) returns void language plpgsql as $$
declare v uuid;
begin
  reset role;
  select auth_user_id into v from public.employees where employee_code = upper(p_code);
  perform set_config('request.jwt.claim.sub', v::text, false);
  execute 'set role authenticated';
end $$;

create or replace function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'ESPERABA ERROR (%): %', p_like, p_sql;
exception when others then
  if sqlerrm like 'ESPERABA ERROR%' then raise; end if;
  if sqlerrm not ilike '%' || p_like || '%' then raise exception 'Error inesperado: % (esperaba %)', sqlerrm, p_like; end if;
end $$;

-- ---------- 1. Arranque: admin + vínculo de auth ----------
select public.bootstrap_admin('ADMIN', 'Admin Principal', '4826');
select pg_temp.expect_error($$select public.bootstrap_admin('X2','Otro','4826')$$, 'Ya existen');
insert into auth.users(id) values ('00000000-0000-0000-0000-00000000000a');
select public.link_employee_auth((select id from employees where employee_code='ADMIN'), '00000000-0000-0000-0000-00000000000a');

-- PIN: correcto, incorrecto, bloqueo
do $$ begin
  assert (public.verify_employee_pin('admin', '4826')->>'ok')::boolean, 'PIN correcto debe pasar';
  assert not (public.verify_employee_pin('ADMIN', '0000')->>'ok')::boolean, 'PIN incorrecto';
  assert (public.verify_employee_pin('NOEXISTE', '4826')->>'reason') = 'invalid';
end $$;
select count(*) = 1 as no_plaintext_pin from employee_credentials where pin_hash like '$2%';

select pg_temp.login('ADMIN');
select public.create_employee('CH01', 'Carlos Chofer', 'driver', '7391', '787-555-0101', 'Operador');
select public.create_employee('CH02', 'Diana Chofer', 'driver', '7392');
select public.create_employee('MEC1', 'Mario Mecánico', 'mechanic', '5519');
select public.create_employee('SUP1', 'Sara Supervisora', 'supervisor', '8264');
select pg_temp.expect_error($$select public.create_employee('BAD', 'Pin malo', 'driver', '1111')$$, 'fácil');
reset role;
insert into auth.users(id) select gen_random_uuid() from generate_series(1,4);
update employees e set auth_user_id = u.id from (
  select id, row_number() over () rn from auth.users where id <> '00000000-0000-0000-0000-00000000000a') u,
  (select id, row_number() over (order by employee_code) rn from employees where employee_code <> 'ADMIN') x
 where x.id = e.id and x.rn = u.rn;

-- ---------- 2. Flota ----------
select pg_temp.login('ADMIN');
insert into vehicles(unit_number, model_id, vin) select 'UTV-01', id, 'VINUTV01' from vehicle_models where manufacturer='Yanmar';
insert into vehicles(unit_number, model_id, mileage) select 'ATV-24', id, 0 from vehicle_models where year=2024;
select public.assign_vehicle((select id from vehicles where unit_number='UTV-01'), (select id from employees where employee_code='CH01'));
select status = 'assigned' as assigned from vehicles where unit_number='UTV-01';

-- Chofer: solo ve su vehículo y no puede editarlo
select pg_temp.login('CH01');
do $$ begin
  assert (select count(*) from vehicles) = 1, 'chofer debe ver solo 1 vehículo';
  assert (select unit_number from public.my_vehicle()) = 'UTV-01';
end $$;
update vehicles set notes = 'hack' where unit_number = 'UTV-01';
select pg_temp.expect_error($$select public.create_employee('X9','x','admin','7777')$$, 'Permiso requerido');
select pg_temp.expect_error($$select public.record_meter_reading((select id from vehicles limit 1), 1, null)$$, 'Permiso');
reset role; select notes is null as rls_blocked_update from vehicles where unit_number='UTV-01';

-- ---------- 3. Inspección con falla crítica ----------
select pg_temp.login('CH01');
select public.submit_inspection(
  (select id from vehicles where unit_number='UTV-01'),
  public.inspection_template_for((select id from vehicles where unit_number='UTV-01')),
  (select jsonb_agg(jsonb_build_object('item_id', i.id, 'result', case when i.label='Frenos' then 'fail' else 'ok' end,
          'comment', case when i.label='Frenos' then 'Pedal esponjoso' end))
     from inspection_template_items i where i.template_id = public.inspection_template_for((select id from vehicles where unit_number='UTV-01'))),
  'Revisar frenos', 120.5, null, 'half') ->> 'result' as inspection_result;
select pg_temp.expect_error($$select public.submit_inspection((select id from vehicles limit 1),
  public.inspection_template_for((select id from vehicles limit 1)), '[{"item_id":"00000000-0000-0000-0000-000000000000","result":"ok"}]')$$, 'Faltan');
reset role;
do $$ begin
  assert (select status from vehicles where unit_number='UTV-01') = 'out_of_service', 'vehículo debe quedar fuera de servicio';
  assert (select engine_hours from vehicles where unit_number='UTV-01') = 120.5;
  assert (select count(*) from notifications where type='vehicle_unfit') = 3, 'notifica admin, supervisor y mecánico';
  assert (select count(*) from vehicle_timeline where event_type='inspection') = 1;
end $$;
select pg_temp.login('CH02');
do $$ begin assert (select count(*) from inspections) = 0, 'otro chofer no ve inspecciones ajenas'; end $$;
select pg_temp.login('MEC1');
do $$ begin
  assert (select count(*) from my_notifications where type='vehicle_unfit') = 1, 'mecánico recibe su notificación';
end $$;
select public.mark_notifications_read(array(select id from my_notifications));
do $$ begin assert (select bool_and(is_read) from my_notifications), 'marcadas leídas'; end $$;

-- ---------- 4. Ponches ----------
select pg_temp.login('CH01');
select pg_temp.expect_error($$select public.punch('out', 18.4, -66.1)$$, 'fuera de turno');
select pg_temp.expect_error($$select public.punch('in')$$, 'ubicación');
select public.punch('in', 18.4655, -66.1057, 10);
select pg_temp.expect_error($$select public.punch('in', 18.4, -66.1)$$, 'en turno');
reset role; update time_punches set punched_at = punched_at - interval '1 hour';
select pg_temp.login('CH01'); select public.punch('break_start', 18.4655, -66.1057);
reset role; update time_punches set punched_at = punched_at - interval '10 minutes';
select pg_temp.login('CH01');
select (public.my_punch_state()->>'state') = 'break' as on_break;
select pg_temp.expect_error($$update time_punches set punched_at = now()$$, 'permission denied');
select public.request_punch_correction((select app.current_employee_id()), null, 'out', now() - interval '5 minutes', 'Olvidé ponchar salida');
select pg_temp.login('SUP1');
select public.decide_punch_correction((select id from time_punch_corrections limit 1), true, 'OK');
select (count(*) = 3) as punches_after_correction from time_punches where employee_id = (select id from employees where employee_code='CH01');

-- Geocerca activa
reset role;
update app_settings set value = jsonb_set(value, '{geofence}', '{"enabled": true, "lat": 18.4655, "lng": -66.1057, "radius_m": 200}') where key='timeclock';
select pg_temp.login('CH02');
select pg_temp.expect_error($$select public.punch('in', 18.30, -66.00)$$, 'fuera del área');
select public.punch('in', 18.4660, -66.1050);

-- ---------- 5. Operaciones sin solapamiento ----------
select pg_temp.login('SUP1');
select public.save_operation(jsonb_build_object('title','Limpieza Zona Norte','starts_at','2026-11-10 08:00-04','ends_at','2026-11-10 12:00-04',
  'vehicle_ids', jsonb_build_array((select id from vehicles where unit_number='ATV-24')),
  'employees', jsonb_build_array(jsonb_build_object('employee_id',(select id from employees where employee_code='CH02'),'role','Operador'))));
select pg_temp.expect_error($$select public.save_operation(jsonb_build_object('title','Choque','starts_at','2026-11-10 11:00-04','ends_at','2026-11-10 14:00-04',
  'vehicle_ids', jsonb_build_array((select id from vehicles where unit_number='ATV-24'))))$$, 'ya está asignado');
select public.save_operation(jsonb_build_object('title','Tarde','starts_at','2026-11-10 12:00-04','ends_at','2026-11-10 15:00-04',
  'vehicle_ids', jsonb_build_array((select id from vehicles where unit_number='ATV-24'))));
select pg_temp.login('CH02');
do $$ begin assert (select count(*) from operations) = 1, 'chofer ve solo su asignación'; end $$;

-- ---------- 6. Inventario + taller ----------
select pg_temp.login('ADMIN');
select public.inventory_create_item(jsonb_build_object('sku','BRK-PAD-01','name','Pastillas de freno delanteras','category','Frenos',
  'min_quantity',2,'unit_cost',35,'initial_quantity',5,'location','Estante A2',
  'model_ids', jsonb_build_array((select id from vehicle_models where manufacturer='Yanmar'))));
select pg_temp.expect_error($$update inventory_items set quantity_on_hand = 99$$, 'solo cambian');

select pg_temp.login('SUP1');
select public.create_work_order(jsonb_build_object('vehicle_id',(select id from vehicles where unit_number='UTV-01'),
  'reported_problem','Frenos esponjosos (inspección)','priority','high','source_type','inspection',
  'assigned_mechanic_id',(select id from employees where employee_code='MEC1')))->>'order_number' as wo;

select pg_temp.login('MEC1');
select pg_temp.expect_error($$select public.complete_work_order((select id from work_orders limit 1))$$, 'diagnóstico');
select public.diagnose_work_order((select id from work_orders limit 1), 'Pastillas gastadas, cambiar ambas');
select public.add_work_order_part((select id from work_orders limit 1),
  jsonb_build_object('inventory_item_id',(select id from inventory_items where sku='BRK-PAD-01'),'quantity',3))->>'status' as part_status;
do $$ begin
  assert (select quantity_reserved from inventory_items where sku='BRK-PAD-01') = 3, 'reservadas 3';
  assert (select quantity_on_hand from inventory_items where sku='BRK-PAD-01') = 5, 'reservar no descuenta';
end $$;
select pg_temp.expect_error($$select public.add_work_order_part((select id from work_orders limit 1),
  jsonb_build_object('inventory_item_id',(select id from inventory_items where sku='BRK-PAD-01'),'quantity',3))$$, 'insuficiente');
select public.add_work_order_part((select id from work_orders limit 1),
  jsonb_build_object('description','Líquido de frenos DOT4','quantity',1,'to_purchase',true))->>'status' as to_purchase;
select public.set_work_order_status((select id from work_orders limit 1), 'in_repair');
select public.consume_work_order_part((select id from work_order_parts where description like 'Pastillas%'), 2);
do $$ begin
  assert (select quantity_on_hand from inventory_items where sku='BRK-PAD-01') = 3, 'consumidas 2 → quedan 3';
  assert (select quantity_reserved from inventory_items where sku='BRK-PAD-01') = 0, 'sobrante reservado liberado';
end $$;
select public.add_work_order_labor((select id from work_orders limit 1), 1.5, 'Cambio de pastillas', null, null, 40);
select pg_temp.expect_error($$select public.complete_work_order((select id from work_orders limit 1))$$, 'pendientes');
select public.cancel_work_order_part((select id from work_order_parts where status='to_purchase'));
select public.complete_work_order((select id from work_orders limit 1), 'Probado OK', 121);
reset role;
do $$ begin
  assert (select status from work_orders limit 1) = 'completed';
  assert (select parts_cost_total from work_orders limit 1) = 70, 'piezas 2 x 35';
  assert (select labor_cost_total from work_orders limit 1) = 60, 'mano de obra 1.5 x 40';
  assert (select status from vehicles where unit_number='UTV-01') = 'assigned', 'vuelve a servicio (asignado)';
  assert (select cost from vehicle_timeline where event_type='repair') = 130;
  assert (select count(*) from inventory_movements where movement_type='consumption') = 1;
  assert (select count(*) from purchase_requests) = 1;
  assert (select count(*) from notifications where type='low_stock') = 0, 'quedan 3 > mínimo 2: sin alerta';
end $$;

-- ---------- 7. Mantenimiento por horas ----------
select pg_temp.login('ADMIN');
insert into maintenance_intervals(model_id, maintenance_type_id, interval_hours, interval_days, source_reference)
select (select id from vehicle_models where manufacturer='Yanmar'), (select id from maintenance_types where name='Cambio de aceite'),
       100, 180, 'Manual de servicio (pendiente de cargar)';
reset role;
do $$ begin
  assert (select due_status from maintenance_due where unit_number='UTV-01') = 'overdue', '121 h ≥ 100 h → vencido';
end $$;
select public.run_alerts();
do $$ begin assert (select count(*) from notifications where type='maintenance_overdue') = 3; end $$;
select public.run_alerts();
do $$ begin assert (select count(*) from notifications where type='maintenance_overdue') = 3, 'sin duplicados'; end $$;
select pg_temp.login('MEC1');
select public.schedule_maintenance(jsonb_build_object('vehicle_id',(select id from vehicles where unit_number='UTV-01'),
  'maintenance_type_id',(select id from maintenance_types where name='Cambio de aceite')));
select public.start_maintenance((select id from maintenance_records limit 1));
select public.complete_maintenance((select id from maintenance_records limit 1), '{"engine_hours":122,"labor_hours":0.5,"cost_parts":25}');
reset role;
do $$ begin
  assert (select next_due_hours from maintenance_records limit 1) = 222;
  assert (select due_status from maintenance_due where unit_number='UTV-01') = 'ok';
  assert (select next_maintenance_hours from vehicles where unit_number='UTV-01') = 222;
  assert (select status from vehicles where unit_number='UTV-01') = 'assigned';
end $$;

-- ---------- 8. Catálogo OEM (datos de prueba marcados, no reales) ----------
select pg_temp.login('ADMIN');
select public.catalog_import_rows(public.catalog_start_import('csv','prueba.csv',null), null, jsonb_build_array(
  jsonb_build_object('manufacturer','TEST','oem_number','TEST-0001','name','Pieza de prueba','system','Frenos',
     'model_manufacturer','Yanmar','model','Bull UTV','diagram_title','Diagrama prueba','diagram_ref','F1','page','1','callout','3'),
  jsonb_build_object('manufacturer','TEST','oem_number','','name','sin número'))) ->> 'ok' as imported;
select public.catalog_link_inventory((select id from catalog_parts where oem_number='TEST-0001'), (select id from inventory_items where sku='BRK-PAD-01'));
select oem_number, available, location from public.catalog_search((select id from vehicle_models where manufacturer='Yanmar'), 'test');

-- ---------- 9. Incidente ----------
select pg_temp.login('CH01');
select public.report_incident('{"incident_type":"collision","severity":"moderate","description":"Golpe con poste al retroceder","vehicle_operable":false,
  "people":[{"full_name":"Testigo Uno","role":"witness"}]}')->>'incident_number' as incident;
reset role;
do $$ begin
  assert (select status from vehicles where unit_number='UTV-01') = 'out_of_service';
  assert (select count(*) from incident_people) = 1;
end $$;

-- ---------- 10. Desactivar módulo: deja de operar, datos intactos ----------
select pg_temp.login('ADMIN');
select public.set_module_state('fuel', false);
select pg_temp.login('CH01');
select pg_temp.expect_error($$insert into fuel_logs(vehicle_id, quantity, amount) select id, 5, 20 from vehicles$$, 'row-level security');
select pg_temp.login('ADMIN');
select public.set_module_state('fuel', true);
select pg_temp.login('CH01');
insert into fuel_logs(vehicle_id, quantity, amount, engine_hours) select id, 5, 20, 123 from vehicles;
select pg_temp.login('ADMIN');
select public.set_module_state('fuel', true, now() - interval '1 day');   -- prueba vencida
select pg_temp.login('CH01');
select pg_temp.expect_error($$insert into fuel_logs(vehicle_id, quantity, amount) select id, 5, 20 from vehicles$$, 'row-level security');
do $$ begin assert (select count(*) from fuel_logs) = 1, 'datos se conservan y se pueden leer'; end $$;

-- ---------- 11. Auditoría ----------
reset role;
do $$ begin
  assert (select count(*) from audit_log where table_name='vehicles' and action='UPDATE') > 0;
  assert not exists (select 1 from audit_log where new_data ? 'pin_hash'), 'el PIN nunca entra a auditoría';
end $$;
select pg_temp.login('CH01');
select pg_temp.expect_error($$delete from vehicles$$, 'permission denied');
do $$ begin assert (select count(*) from audit_log) = 0, 'chofer no lee auditoría'; end $$;

reset role;
select 'TODAS LAS PRUEBAS PASARON' as resultado;
