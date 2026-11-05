-- @generated por scripts/modules.mjs — edite el archivo fuente, no este.
-- =============================================================================
-- MÓDULO · Documentos y recordatorios de vencimiento
-- Depende de: core. Documentos de vehículos, empleados o de la compañía.
-- =============================================================================
insert into public.app_modules (id, name) values ('documents', 'Documentos') on conflict (id) do nothing;

insert into public.app_settings (key, value) values ('documents', '{"warn_days": [30, 7]}')
on conflict (key) do nothing;

create table public.documents (
  id           uuid primary key default gen_random_uuid(),
  owner_type   text not null check (owner_type in ('vehicle','employee','company')),
  vehicle_id   uuid references public.vehicles(id),
  employee_id  uuid references public.employees(id),
  category     text not null check (category in
                 ('registration','insurance','inspection','warranty','legal','manual','license','certification','other')),
  title        text not null,
  document_number text,
  issued_at    date,
  expires_at   date,
  storage_path text,
  file_name    text,
  mime_type    text,
  notes        text,
  replaces_id  uuid references public.documents(id),   -- renovación: conserva el historial
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  check ((owner_type = 'vehicle' and vehicle_id is not null and employee_id is null)
      or (owner_type = 'employee' and employee_id is not null and vehicle_id is null)
      or (owner_type = 'company' and vehicle_id is null and employee_id is null)),
  check (expires_at is null or issued_at is null or expires_at >= issued_at)
);
create index documents_vehicle_idx on public.documents(vehicle_id) where archived_at is null;
create index documents_employee_idx on public.documents(employee_id) where archived_at is null;
create index documents_expiry_idx on public.documents(expires_at) where archived_at is null;

create or replace function app.documents_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.replaces_id is not null then
    update public.documents set archived_at = now() where id = new.replaces_id and archived_at is null;
  end if;
  if new.vehicle_id is not null then
    perform app.timeline_add(new.vehicle_id, 'documents', 'document', 'Documento: ' || new.title, 'document', new.id,
      jsonb_build_object('category', new.category, 'expires_at', new.expires_at));
  end if;
  return new;
end $$;
create trigger documents_after_insert after insert on public.documents
  for each row execute function app.documents_after_insert();

create or replace view public.documents_expiring with (security_invoker = true) as
  select d.*, (d.expires_at - current_date) as days_left,
         case when d.expires_at < current_date then 'expired'
              when d.expires_at <= current_date + 30 then 'expiring' else 'valid' end as expiry_status,
         v.unit_number, e.full_name as employee_name
    from public.documents d
    left join public.vehicles v on v.id = d.vehicle_id
    left join public.employees e on e.id = d.employee_id
   where d.archived_at is null and d.expires_at is not null;

create or replace function app.documents_alerts()
returns void language plpgsql security definer set search_path = public as $$
declare d record; v_warn int[]; w int;
begin
  select array(select jsonb_array_elements_text(value->'warn_days')::int) into v_warn
    from public.app_settings where key = 'documents';
  v_warn := coalesce(v_warn, array[30, 7]);
  for d in select * from public.documents_expiring where days_left <= (select max(x) from unnest(v_warn) x) loop
    select min(x) into w from unnest(v_warn) x where d.days_left <= x;      -- umbral alcanzado
    perform app.notify(array['admin','supervisor'], 'documents',
      case when d.days_left < 0 then 'document_expired' else 'document_expiring' end,
      case when d.days_left < 0 then 'Documento vencido: ' else 'Documento por vencer: ' end || d.title
        || coalesce(' · ' || d.unit_number, '') || coalesce(' · ' || d.employee_name, ''),
      'Vence el ' || to_char(d.expires_at, 'DD/MM/YYYY'), '/documentos/' || d.id,
      case when d.days_left < 0 then 'critical' else 'warning' end, 'document', d.id,
      'doc:' || d.id || ':' || case when d.days_left < 0 then 'expired' else w::text end);
  end loop;
end $$;
insert into public.alert_jobs values ('documents', 'documents_alerts') on conflict do nothing;

insert into public.permissions (id, module_id, action, label, sort) values
  ('documents.view',     'documents', 'view',     'Ver documentos', 1),
  ('documents.view_own', 'documents', 'view_own', 'Ver sus documentos', 2),
  ('documents.create',   'documents', 'create',   'Subir documentos', 3),
  ('documents.edit',     'documents', 'edit',     'Editar y archivar documentos', 4)
on conflict (id) do nothing;
insert into public.role_permissions values
  ('supervisor','documents.view'), ('supervisor','documents.create'),
  ('driver','documents.view_own'), ('mechanic','documents.view_own')
on conflict do nothing;

alter table public.documents enable row level security;
create policy documents_read on public.documents for select to authenticated
  using ((select app.has_perm('documents.view'))
      or ((select app.has_perm('documents.view_own')) and
          (employee_id = (select app.current_employee_id()) or (vehicle_id is not null and app.can_see_vehicle(vehicle_id)))));
create policy documents_insert on public.documents for insert to authenticated
  with check ((select app.has_perm('documents.create')));
create policy documents_update on public.documents for update to authenticated
  using ((select app.has_perm('documents.edit'))) with check ((select app.has_perm('documents.edit')));

do $$ begin perform app.track('public.documents'); end $$;
