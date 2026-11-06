-- @generated por scripts/modules.mjs — edite el archivo fuente, no este.
-- =============================================================================
-- INSPECCIONES · Pulgar arriba / pulgar abajo / nota 1–10
--  ok      👍 conforme
--  fail    👎 no conforme (los detalles son obligatorios)
--  rating  nota del 1 al 10 (reemplaza "no aplica"); 4 o menos = observación
-- Plantilla base: Seguridad solo lleva Frenos; sin "Nivel de combustible".
-- =============================================================================
alter table public.inspection_results add column if not exists score int check (score between 1 and 10);

do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.inspection_results'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) like '%result%' and pg_get_constraintdef(oid) not like '%score%';
  if c is not null then execute format('alter table public.inspection_results drop constraint %I', c); end if;
  -- 'na' queda solo para el historial anterior
  alter table public.inspection_results add constraint inspection_results_result_check
    check (result in ('ok', 'fail', 'rating', 'na'));
  alter table public.inspection_results drop constraint if exists inspection_results_score_result_check;
  alter table public.inspection_results add constraint inspection_results_score_result_check
    check ((result = 'rating') = (score is not null));
end $$;

-- Los puntos se archivan (no se borran): el historial conserva su copia
update public.inspection_template_items i set archived_at = now()
  from public.inspection_templates t
 where t.id = i.template_id and t.name = 'Inspección diaria estándar' and i.archived_at is null
   and i.label in ('Luces', 'Bocina', 'Espejos', 'Cinturones de seguridad', 'Nivel de combustible');

-- p_results: [{"item_id": uuid, "result": "ok|fail|rating", "comment": text, "score": 1-10}]
create or replace function public.submit_inspection(
  p_vehicle uuid, p_template uuid, p_results jsonb, p_notes text default null,
  p_engine_hours numeric default null, p_mileage numeric default null, p_fuel_level text default null,
  p_mark_unfit boolean default false, p_lat double precision default null, p_lng double precision default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := app.current_employee_id();
  v_id uuid; v_fail int; v_crit int; v_result text; v_unit text; v_map jsonb := '{}';
  r jsonb; v_item public.inspection_template_items; v_rid uuid; v_res text; v_score int; v_comment text;
begin
  perform app.require_perm('inspections.perform');
  if not app.can_see_vehicle(p_vehicle) then
    raise exception 'No tiene acceso a este vehículo' using errcode = '42501';
  end if;
  if jsonb_typeof(p_results) <> 'array' or jsonb_array_length(p_results) = 0 then
    raise exception 'La inspección no tiene resultados' using errcode = '22023';
  end if;
  if exists (select 1 from public.inspection_template_items i
              where i.template_id = p_template and i.archived_at is null
                and not exists (select 1 from jsonb_array_elements(p_results) x
                                 where (x->>'item_id')::uuid = i.id)) then
    raise exception 'Faltan puntos por evaluar' using errcode = '22023';
  end if;

  insert into public.inspections(vehicle_id, employee_id, template_id, result, engine_hours, mileage,
                                 fuel_level, notes, marked_unfit, lat, lng)
  values (p_vehicle, v_emp, p_template, 'pass', p_engine_hours, p_mileage, p_fuel_level, p_notes,
          coalesce(p_mark_unfit,false), p_lat, p_lng)
  returning id into v_id;

  for r in select * from jsonb_array_elements(p_results) loop
    select * into v_item from public.inspection_template_items
     where id = (r->>'item_id')::uuid and template_id = p_template and archived_at is null;
    if v_item.id is null then raise exception 'Punto de inspección inválido' using errcode = '22023'; end if;
    v_res := r->>'result';
    v_comment := nullif(trim(coalesce(r->>'comment', '')), '');
    v_score := case when v_res = 'rating' and coalesce(r->>'score', '') ~ '^[0-9]{1,2}$' then (r->>'score')::int end;
    if v_res not in ('ok', 'fail', 'rating') then
      raise exception 'Resultado inválido en "%"', v_item.label using errcode = '22023';
    end if;
    if v_res = 'fail' and v_comment is null then
      raise exception 'Describa el problema en "%"', v_item.label using errcode = '22023';
    end if;
    if v_res = 'rating' and (v_score is null or v_score not between 1 and 10) then
      raise exception 'Ponga una nota del 1 al 10 en "%"', v_item.label using errcode = '22023';
    end if;
    insert into public.inspection_results(inspection_id, item_id, label, category, is_critical, result, score, comment)
    values (v_id, v_item.id, v_item.label, v_item.category, v_item.is_critical, v_res, v_score, v_comment)
    returning id into v_rid;
    v_map := v_map || jsonb_build_object(v_item.id::text, v_rid);
  end loop;

  -- Nota baja (4 o menos) cuenta como observación: avisa al supervisor
  select count(*) filter (where result = 'fail' or (result = 'rating' and score <= 4)),
         count(*) filter (where result = 'fail' and is_critical)
    into v_fail, v_crit from public.inspection_results where inspection_id = v_id;
  v_result := case when v_crit > 0 or p_mark_unfit then 'fail' when v_fail > 0 then 'pass_with_issues' else 'pass' end;
  update public.inspections set result = v_result, marked_unfit = (v_crit > 0 or coalesce(p_mark_unfit,false))
   where id = v_id;

  perform app.record_meter(p_vehicle, p_engine_hours, p_mileage, 'inspection', v_id);
  update public.vehicles set last_inspection_at = now() where id = p_vehicle;
  select unit_number into v_unit from public.vehicles where id = p_vehicle;

  perform app.timeline_add(p_vehicle, 'inspections', 'inspection',
    'Inspección ' || case v_result when 'pass' then 'conforme' when 'fail' then 'NO APTO' else 'con observaciones' end,
    'inspection', v_id, jsonb_build_object('fails', v_fail, 'critical', v_crit));

  if v_result = 'fail' then
    update public.vehicles set status = 'out_of_service', status_reason = 'Inspección: no apto para operar'
     where id = p_vehicle;
    perform app.notify(array['admin','supervisor','mechanic'], 'inspections', 'vehicle_unfit',
      'Vehículo ' || v_unit || ' NO APTO para operar',
      v_crit || ' punto(s) crítico(s) no conforme(s) en la inspección.', '/inspecciones/' || v_id,
      'critical', 'inspection', v_id);
  elsif v_result = 'pass_with_issues' then
    perform app.notify(array['admin','supervisor'], 'inspections', 'vehicle_issues',
      'Vehículo ' || v_unit || ' con observaciones', v_fail || ' punto(s) con pulgar abajo o nota baja.',
      '/inspecciones/' || v_id, 'warning', 'inspection', v_id);
  end if;

  return jsonb_build_object('id', v_id, 'result', v_result, 'results', v_map);
end $$;
