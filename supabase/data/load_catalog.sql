-- Carga el catálogo de piezas de desgaste (carabali_catalog.json) en la base.
-- Uso: obtener el JSON (p. ej. con pg_net desde GitHub) y ejecutar con :data = el jsonb.
-- Se puede volver a aplicar: actualiza lo existente y no duplica.
create or replace function pg_temp.load_catalog(p jsonb)
returns jsonb language plpgsql as $$
declare
  m jsonb; r jsonb; v_model uuid; v_part uuid; v_diag uuid; v_ref text; n int := 0;
begin
  -- Nombres de modelo con su motor (los números de parte dependen de eso)
  update public.vehicle_models set model = 'Outlander 650' where manufacturer = 'Can-Am' and model = 'Outlander' and year = 2018;
  update public.vehicle_models set model = 'Outlander 500' where manufacturer = 'Can-Am' and model = 'Outlander' and year = 2024;
  update public.vehicle_models set model = 'Bull YU700G 4x4 EPS' where manufacturer = 'Yanmar' and model = 'Bull UTV';

  for r in select * from jsonb_array_elements(p->'parts') loop
    select * into m from jsonb_array_elements(p->'models') x where x->>'key' = r->>'m';
    select id into v_model from public.vehicle_models
     where manufacturer = m->>'manufacturer' and model = m->>'model' and year is not distinct from (m->>'year')::int;
    if v_model is null then raise exception 'Modelo no encontrado: %', m; end if;

    v_ref := left(regexp_replace(lower((r->>'m') || ' ' || (r->>'diagram')), '[^a-z0-9]+', '-', 'g'), 120);
    insert into public.catalog_diagrams(model_id, system, subcategory, title, reference_code)
    values (v_model, r->>'system', r->>'sub', r->>'diagram', v_ref)
    on conflict (manual_id, reference_code, page_number) do update set title = excluded.title
    returning id into v_diag;

    insert into public.catalog_parts(manufacturer, oem_number, name, system, category, subcategory, notes)
    values (r->>'mfr', r->>'oem', r->>'name', r->>'system', r->>'cat', r->>'sub', r->>'note')
    on conflict (manufacturer, oem_number) do update set name = excluded.name, system = excluded.system,
      category = excluded.category, subcategory = excluded.subcategory,
      notes = case when catalog_parts.notes is null or catalog_parts.notes = excluded.notes then excluded.notes
                   when position(excluded.notes in catalog_parts.notes) > 0 then catalog_parts.notes
                   else catalog_parts.notes || ' ' || excluded.notes end,
      updated_at = now()
    returning id into v_part;

    insert into public.catalog_fitments(part_id, model_id, diagram_id, qty_per_unit)
    values (v_part, v_model, v_diag, (r->>'qty')::numeric)
    on conflict do nothing;
    n := n + 1;
  end loop;
  return jsonb_build_object('rows', n, 'parts', (select count(*) from public.catalog_parts),
                            'fitments', (select count(*) from public.catalog_fitments));
end $$;
