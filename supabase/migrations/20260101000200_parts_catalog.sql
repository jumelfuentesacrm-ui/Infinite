-- @generated por scripts/modules.mjs — edite el archivo fuente, no este.
-- =============================================================================
-- MÓDULO · Catálogo OEM de piezas, manuales y diagramas
-- Depende de: core, inventory. Sin datos precargados: la información OEM se
-- importa SOLO desde manuales/catálogos oficiales (CSV, Excel, JSON).
-- Cada fila conserva su fuente (manual + página) para trazabilidad.
-- =============================================================================
insert into public.app_modules (id, name) values ('parts_catalog', 'Catálogo OEM') on conflict (id) do nothing;

create table public.manuals (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  manufacturer text not null,
  manual_type  text not null check (manual_type in ('service','repair','parts','owner','wiring','other')),
  model_id     uuid references public.vehicle_models(id),
  year_from    int,
  year_to      int,
  language     text default 'es',
  storage_path text,                -- PDF en Storage (bucket files, carpeta parts_catalog/)
  page_count   int,
  notes        text,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  updated_at   timestamptz not null default now(),
  updated_by   uuid
);

create table public.catalog_diagrams (
  id             uuid primary key default gen_random_uuid(),
  manual_id      uuid references public.manuals(id),
  model_id       uuid references public.vehicle_models(id),
  system         text not null,           -- ej. Motor, Transmisión, Frenos
  category       text,
  subcategory    text,
  title          text not null,
  reference_code text,                    -- código/figura del catálogo
  page_number    int,
  image_path     text,                    -- imagen del diagrama en Storage
  created_at     timestamptz not null default now(),
  unique nulls not distinct (manual_id, reference_code, page_number)
);
create index catalog_diagrams_model_idx on public.catalog_diagrams(model_id, system);

create table public.catalog_parts (
  id               uuid primary key default gen_random_uuid(),
  manufacturer     text not null,
  oem_number       text not null,
  name             text not null,
  description      text,
  system           text,
  category         text,
  subcategory      text,
  source_manual_id uuid references public.manuals(id),
  source_page      int,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (manufacturer, oem_number)
);
create index catalog_parts_search_idx on public.catalog_parts using gin
  (to_tsvector('simple', coalesce(oem_number,'') || ' ' || coalesce(name,'') || ' ' || coalesce(description,'')));
create index catalog_parts_oem_idx on public.catalog_parts(lower(oem_number));

-- Aplicación de la pieza a un modelo (compatibilidad documentada)
create table public.catalog_fitments (
  id           uuid primary key default gen_random_uuid(),
  part_id      uuid not null references public.catalog_parts(id),
  model_id     uuid not null references public.vehicle_models(id),
  diagram_id   uuid references public.catalog_diagrams(id),
  callout      text,                 -- número de referencia dentro del diagrama
  qty_per_unit numeric(10,2),
  notes        text,
  unique nulls not distinct (part_id, model_id, diagram_id, callout)
);
create index catalog_fitments_model_idx on public.catalog_fitments(model_id);
create index catalog_fitments_diagram_idx on public.catalog_fitments(diagram_id);

create table public.catalog_supersessions (
  id               uuid primary key default gen_random_uuid(),
  part_id          uuid not null references public.catalog_parts(id),
  related_oem      text not null,
  relation         text not null check (relation in ('supersedes','superseded_by','alternative')),
  source_manual_id uuid references public.manuals(id),
  source_page      int,
  unique (part_id, related_oem, relation)
);

-- Vínculo OEM ↔ artículo interno de inventario (identificadores distintos)
create table public.catalog_inventory_links (
  catalog_part_id   uuid not null references public.catalog_parts(id),
  inventory_item_id uuid not null references public.inventory_items(id),
  linked_by         uuid references public.employees(id) default app.current_employee_id(),
  linked_at         timestamptz not null default now(),
  primary key (catalog_part_id, inventory_item_id)
);
create index catalog_inventory_links_item_idx on public.catalog_inventory_links(inventory_item_id);

create table public.catalog_import_batches (
  id           uuid primary key default gen_random_uuid(),
  source_type  text not null check (source_type in ('csv','xlsx','json')),
  file_name    text not null,
  manual_id    uuid references public.manuals(id),
  rows_total   int not null default 0,
  rows_ok      int not null default 0,
  rows_error   int not null default 0,
  errors       jsonb not null default '[]',
  created_by   uuid references public.employees(id) default app.current_employee_id(),
  created_at   timestamptz not null default now()
);

-- Importación por lotes desde filas estructuradas (la interfaz lee CSV/Excel y envía bloques)
-- fila: {manufacturer, oem_number, name, description, system, category, subcategory,
--        model_id | (model_manufacturer, model, year), diagram_title, diagram_ref, page, callout, qty,
--        supersedes, alternatives}
create or replace function public.catalog_import_rows(p_batch uuid, p_manual uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_part uuid; v_model uuid; v_diag uuid; v_ok int := 0; v_err int := 0; v_errors jsonb := '[]';
  v_i int := 0; v_alt text;
begin
  perform app.require_perm('parts_catalog.import');
  for r in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    begin
      if coalesce(trim(r->>'oem_number'),'') = '' or coalesce(trim(r->>'name'),'') = '' or coalesce(trim(r->>'manufacturer'),'') = '' then
        raise exception 'Faltan fabricante, número OEM o nombre';
      end if;
      insert into public.catalog_parts(manufacturer, oem_number, name, description, system, category, subcategory,
                                       source_manual_id, source_page)
      values (trim(r->>'manufacturer'), upper(trim(r->>'oem_number')), trim(r->>'name'), r->>'description', r->>'system',
              r->>'category', r->>'subcategory', p_manual, nullif(r->>'page','')::int)
      on conflict (manufacturer, oem_number) do update set
        name = excluded.name, description = coalesce(excluded.description, catalog_parts.description),
        system = coalesce(excluded.system, catalog_parts.system), category = coalesce(excluded.category, catalog_parts.category),
        subcategory = coalesce(excluded.subcategory, catalog_parts.subcategory),
        source_manual_id = coalesce(excluded.source_manual_id, catalog_parts.source_manual_id),
        source_page = coalesce(excluded.source_page, catalog_parts.source_page), updated_at = now()
      returning id into v_part;

      v_model := nullif(r->>'model_id','')::uuid;
      if v_model is null and coalesce(r->>'model','') <> '' then
        select id into v_model from public.vehicle_models
         where lower(manufacturer) = lower(coalesce(r->>'model_manufacturer', r->>'manufacturer'))
           and lower(model) = lower(r->>'model')
           and year is not distinct from nullif(r->>'year','')::int;
        if v_model is null then raise exception 'Modelo no registrado: % % %', r->>'model_manufacturer', r->>'model', r->>'year'; end if;
      end if;

      v_diag := null;
      if coalesce(r->>'diagram_title','') <> '' then
        insert into public.catalog_diagrams(manual_id, model_id, system, category, subcategory, title, reference_code, page_number)
        values (p_manual, v_model, coalesce(r->>'system','General'), r->>'category', r->>'subcategory', r->>'diagram_title',
                nullif(r->>'diagram_ref',''), nullif(r->>'page','')::int)
        on conflict (manual_id, reference_code, page_number) do update set title = excluded.title
        returning id into v_diag;
      end if;

      if v_model is not null then
        insert into public.catalog_fitments(part_id, model_id, diagram_id, callout, qty_per_unit)
        values (v_part, v_model, v_diag, nullif(r->>'callout',''), nullif(r->>'qty','')::numeric)
        on conflict do nothing;
      end if;

      if coalesce(r->>'supersedes','') <> '' then
        for v_alt in select trim(x) from unnest(string_to_array(r->>'supersedes', '|')) x where trim(x) <> '' loop
          insert into public.catalog_supersessions(part_id, related_oem, relation, source_manual_id, source_page)
          values (v_part, upper(v_alt), 'supersedes', p_manual, nullif(r->>'page','')::int) on conflict do nothing;
        end loop;
      end if;
      if coalesce(r->>'alternatives','') <> '' then
        for v_alt in select trim(x) from unnest(string_to_array(r->>'alternatives', '|')) x where trim(x) <> '' loop
          insert into public.catalog_supersessions(part_id, related_oem, relation, source_manual_id, source_page)
          values (v_part, upper(v_alt), 'alternative', p_manual, nullif(r->>'page','')::int) on conflict do nothing;
        end loop;
      end if;
      v_ok := v_ok + 1;
    exception when others then
      v_err := v_err + 1;
      v_errors := v_errors || jsonb_build_object('row', v_i, 'oem', r->>'oem_number', 'error', sqlerrm);
    end;
  end loop;
  update public.catalog_import_batches set rows_total = rows_total + v_i, rows_ok = rows_ok + v_ok,
         rows_error = rows_error + v_err, errors = errors || v_errors
   where id = p_batch;
  return jsonb_build_object('ok', v_ok, 'errors', v_errors);
end $$;

create or replace function public.catalog_start_import(p_source text, p_file text, p_manual uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform app.require_perm('parts_catalog.import');
  insert into public.catalog_import_batches(source_type, file_name, manual_id) values (p_source, p_file, p_manual)
  returning id into v_id;
  return v_id;
end $$;

-- Búsqueda por modelo (y opcionalmente texto/sistema) con disponibilidad en inventario
create or replace function public.catalog_search(p_model uuid default null, p_query text default null,
  p_system text default null, p_diagram uuid default null, p_limit int default 100)
returns table (part_id uuid, manufacturer text, oem_number text, name text, description text, system text,
               category text, subcategory text, callout text, diagram_id uuid, diagram_title text, page_number int,
               source_page int, manual_title text, inventory_item_id uuid, inventory_sku text, on_hand numeric,
               available numeric, location text)
language sql stable security definer set search_path = public as $$
  select p.id, p.manufacturer, p.oem_number, p.name, p.description, p.system, p.category, p.subcategory,
         f.callout, d.id, d.title, d.page_number, p.source_page, mn.title,
         i.id, i.sku, i.quantity_on_hand, i.quantity_on_hand - i.quantity_reserved, i.location
    from public.catalog_parts p
    left join public.catalog_fitments f on f.part_id = p.id and (p_model is null or f.model_id = p_model)
    left join public.catalog_diagrams d on d.id = f.diagram_id
    left join public.manuals mn on mn.id = p.source_manual_id
    left join lateral (select ii.* from public.catalog_inventory_links l
                         join public.inventory_items ii on ii.id = l.inventory_item_id and ii.archived_at is null
                        where l.catalog_part_id = p.id
                        order by ii.quantity_on_hand - ii.quantity_reserved desc limit 1) i on true
   where app.has_perm('parts_catalog.view')
     and (p_model is null or f.model_id = p_model)
     and (p_diagram is null or f.diagram_id = p_diagram)
     and (p_system is null or p.system = p_system)
     and (p_query is null or p_query = '' or p.oem_number ilike '%' || p_query || '%' or p.name ilike '%' || p_query || '%'
          or exists (select 1 from public.catalog_supersessions s where s.part_id = p.id and s.related_oem ilike '%' || p_query || '%'))
   order by p.system nulls last, d.title nulls last, f.callout nulls last, p.name
   limit least(coalesce(p_limit, 100), 500);
$$;

create or replace function public.catalog_link_inventory(p_part uuid, p_item uuid, p_link boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform app.require_perm('parts_catalog.link');
  if p_link then
    insert into public.catalog_inventory_links(catalog_part_id, inventory_item_id) values (p_part, p_item) on conflict do nothing;
  else
    delete from public.catalog_inventory_links where catalog_part_id = p_part and inventory_item_id = p_item;
  end if;
end $$;

-- Crea un artículo de inventario a partir de una pieza OEM y los vincula
create or replace function public.catalog_create_inventory_item(p_part uuid, p_sku text, p_location text default null,
  p_min numeric default 0)
returns uuid language plpgsql security definer set search_path = public as $$
declare cp public.catalog_parts; v_item uuid;
begin
  perform app.require_perm('parts_catalog.link');
  select * into cp from public.catalog_parts where id = p_part;
  if cp.id is null then raise exception 'Pieza OEM no encontrada' using errcode = 'P0002'; end if;
  v_item := public.inventory_create_item(jsonb_build_object('sku', p_sku, 'name', cp.name, 'part_number', cp.oem_number,
    'manufacturer', cp.manufacturer, 'category', coalesce(cp.category, cp.system), 'description', cp.description,
    'location', p_location, 'min_quantity', p_min,
    'model_ids', (select coalesce(jsonb_agg(distinct model_id), '[]') from public.catalog_fitments where part_id = p_part)));
  insert into public.catalog_inventory_links(catalog_part_id, inventory_item_id) values (p_part, v_item);
  return v_item;
end $$;

-- Sugerencias automáticas: artículos de inventario cuyo número de pieza coincide con el OEM
create or replace view public.catalog_link_suggestions with (security_invoker = true) as
  select p.id as catalog_part_id, p.oem_number, p.name as catalog_name, i.id as inventory_item_id, i.sku, i.name as item_name
    from public.catalog_parts p
    join public.inventory_items i on lower(replace(i.part_number,'-','')) = lower(replace(p.oem_number,'-',''))
   where not exists (select 1 from public.catalog_inventory_links l where l.catalog_part_id = p.id and l.inventory_item_id = i.id);

insert into public.permissions (id, module_id, action, label, sort) values
  ('parts_catalog.view',   'parts_catalog', 'view',   'Consultar catálogo, manuales y diagramas', 1),
  ('parts_catalog.link',   'parts_catalog', 'link',   'Vincular piezas OEM con inventario', 2),
  ('parts_catalog.import', 'parts_catalog', 'import', 'Importar catálogos y subir manuales', 3)
on conflict (id) do nothing;
insert into public.role_permissions values
  ('supervisor','parts_catalog.view'), ('mechanic','parts_catalog.view'), ('mechanic','parts_catalog.link')
on conflict do nothing;

alter table public.manuals                 enable row level security;
alter table public.catalog_diagrams        enable row level security;
alter table public.catalog_parts           enable row level security;
alter table public.catalog_fitments        enable row level security;
alter table public.catalog_supersessions   enable row level security;
alter table public.catalog_inventory_links enable row level security;
alter table public.catalog_import_batches  enable row level security;
create policy manuals_read on public.manuals for select to authenticated using ((select app.has_perm('parts_catalog.view')));
create policy manuals_insert on public.manuals for insert to authenticated with check ((select app.has_perm('parts_catalog.import')));
create policy manuals_update on public.manuals for update to authenticated
  using ((select app.has_perm('parts_catalog.import'))) with check ((select app.has_perm('parts_catalog.import')));
create policy diagrams_read on public.catalog_diagrams for select to authenticated using ((select app.has_perm('parts_catalog.view')));
create policy diagrams_insert on public.catalog_diagrams for insert to authenticated with check ((select app.has_perm('parts_catalog.import')));
create policy diagrams_update on public.catalog_diagrams for update to authenticated
  using ((select app.has_perm('parts_catalog.import'))) with check ((select app.has_perm('parts_catalog.import')));
create policy cparts_read on public.catalog_parts for select to authenticated using ((select app.has_perm('parts_catalog.view')));
create policy cparts_update on public.catalog_parts for update to authenticated
  using ((select app.has_perm('parts_catalog.import'))) with check ((select app.has_perm('parts_catalog.import')));
create policy fitments_read on public.catalog_fitments for select to authenticated using ((select app.has_perm('parts_catalog.view')));
create policy supers_read on public.catalog_supersessions for select to authenticated using ((select app.has_perm('parts_catalog.view')));
create policy links_read on public.catalog_inventory_links for select to authenticated using ((select app.has_perm('parts_catalog.view')));
create policy batches_read on public.catalog_import_batches for select to authenticated using ((select app.has_perm('parts_catalog.import')));
revoke insert on public.catalog_parts, public.catalog_fitments, public.catalog_supersessions,
  public.catalog_inventory_links, public.catalog_import_batches from authenticated;
revoke update on public.catalog_fitments, public.catalog_supersessions, public.catalog_inventory_links,
  public.catalog_import_batches from authenticated;

do $$ begin
  perform app.track('public.manuals');
  perform app.track('public.catalog_parts', false);
  perform app.track('public.catalog_inventory_links', false);
end $$;
