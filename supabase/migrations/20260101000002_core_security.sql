-- @generated por scripts/modules.mjs — edite el archivo fuente, no este.
-- =============================================================================
-- CORE · Seguridad: RLS, privilegios, Storage y Realtime
-- Regla: lo que la interfaz oculta, el servidor también lo bloquea.
-- =============================================================================

-- Ver un vehículo: permiso general o es su vehículo asignado.
create or replace function app.can_see_vehicle(p_vehicle uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select app.has_perm('fleet.view')
      or (app.has_perm('fleet.view_own') and exists (
            select 1 from public.vehicle_assignments a
             where a.vehicle_id = p_vehicle and a.ended_at is null
               and a.employee_id = app.current_employee_id()));
$$;

-- Bloquea cambios privilegiados hechos por UPDATE directo.
create or replace function app.guard_employee_update()
returns trigger language plpgsql as $$
begin
  if new.role_id is distinct from old.role_id and not app.has_perm('employees.manage') then
    raise exception 'Cambiar el rol requiere permiso employees.manage' using errcode = '42501';
  end if;
  if new.auth_user_id is distinct from old.auth_user_id and current_user not in ('postgres','service_role') then
    raise exception 'Campo protegido' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and new.id = app.current_employee_id() then
    raise exception 'No puede cambiar el estado de su propia cuenta' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger employees_guard before update on public.employees
  for each row execute function app.guard_employee_update();

create or replace function app.guard_vehicle_update()
returns trigger language plpgsql as $$
begin
  if new.archived_at is distinct from old.archived_at and not app.has_perm('fleet.delete') then
    raise exception 'Archivar vehículos requiere permiso fleet.delete' using errcode = '42501';
  end if;
  if (new.engine_hours < old.engine_hours or new.mileage < old.mileage) then
    raise exception 'Horas o millaje no pueden retroceder' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger vehicles_guard before update on public.vehicles
  for each row execute function app.guard_vehicle_update();

-- -----------------------------------------------------------------------------
-- Activar RLS en todo el núcleo
-- -----------------------------------------------------------------------------
alter table public.app_modules                   enable row level security;
alter table public.app_settings                  enable row level security;
alter table public.roles                         enable row level security;
alter table public.permissions                   enable row level security;
alter table public.role_permissions              enable row level security;
alter table public.employees                     enable row level security;
alter table public.employee_credentials          enable row level security;
alter table public.employee_permission_overrides enable row level security;
alter table public.vehicle_models                enable row level security;
alter table public.vehicles                      enable row level security;
alter table public.vehicle_status_history        enable row level security;
alter table public.vehicle_meter_readings        enable row level security;
alter table public.vehicle_assignments           enable row level security;
alter table public.vehicle_timeline              enable row level security;
alter table public.attachments                   enable row level security;
alter table public.notifications                 enable row level security;
alter table public.notification_reads            enable row level security;
alter table public.audit_log                     enable row level security;
alter table public.alert_jobs                    enable row level security;

-- Catálogos de solo lectura para cualquier empleado activo
create policy app_modules_read on public.app_modules for select to authenticated
  using ((select app.current_employee_id()) is not null);
create policy app_settings_read on public.app_settings for select to authenticated
  using ((select app.current_employee_id()) is not null);
create policy app_settings_write on public.app_settings for update to authenticated
  using ((select app.has_perm('settings.manage'))) with check ((select app.has_perm('settings.manage')));
create policy app_settings_insert on public.app_settings for insert to authenticated
  with check ((select app.has_perm('settings.manage')));
create policy roles_read on public.roles for select to authenticated
  using ((select app.current_employee_id()) is not null);
create policy roles_write on public.roles for insert to authenticated
  with check ((select app.has_perm('settings.manage')) and not is_system);
create policy roles_update on public.roles for update to authenticated
  using ((select app.has_perm('settings.manage'))) with check ((select app.has_perm('settings.manage')));
create policy permissions_read on public.permissions for select to authenticated
  using ((select app.current_employee_id()) is not null);
create policy role_permissions_read on public.role_permissions for select to authenticated
  using ((select app.current_employee_id()) is not null);

-- Empleados: cualquier empleado activo ve el directorio (nombres para listas);
-- editar requiere employees.edit. Crear solo por RPC (crea también el PIN).
create policy employees_read on public.employees for select to authenticated
  using ((select app.current_employee_id()) is not null);
create policy employees_update on public.employees for update to authenticated
  using ((select app.has_perm('employees.edit'))) with check ((select app.has_perm('employees.edit')));

create policy overrides_read on public.employee_permission_overrides for select to authenticated
  using (employee_id = (select app.current_employee_id()) or (select app.has_perm('employees.manage')));

-- Flota
create policy vehicle_models_read on public.vehicle_models for select to authenticated
  using ((select app.current_employee_id()) is not null);
create policy vehicle_models_insert on public.vehicle_models for insert to authenticated
  with check ((select app.has_perm('fleet.manage')));
create policy vehicle_models_update on public.vehicle_models for update to authenticated
  using ((select app.has_perm('fleet.manage'))) with check ((select app.has_perm('fleet.manage')));

create policy vehicles_read on public.vehicles for select to authenticated
  using (app.can_see_vehicle(id));
create policy vehicles_insert on public.vehicles for insert to authenticated
  with check ((select app.has_perm('fleet.create')));
create policy vehicles_update on public.vehicles for update to authenticated
  using ((select app.has_perm('fleet.edit'))) with check ((select app.has_perm('fleet.edit')));

create policy vehicle_status_history_read on public.vehicle_status_history for select to authenticated
  using (app.can_see_vehicle(vehicle_id));
create policy vehicle_meter_readings_read on public.vehicle_meter_readings for select to authenticated
  using (app.can_see_vehicle(vehicle_id));
create policy vehicle_timeline_read on public.vehicle_timeline for select to authenticated
  using (app.can_see_vehicle(vehicle_id));
create policy vehicle_assignments_read on public.vehicle_assignments for select to authenticated
  using ((select app.has_perm('fleet.view')) or employee_id = (select app.current_employee_id()));

-- Adjuntos: los ve quien los subió o quien puede ver el módulo
create policy attachments_read on public.attachments for select to authenticated
  using (uploaded_by = (select app.current_employee_id()) or app.has_perm(module_id || '.view'));
create policy attachments_insert on public.attachments for insert to authenticated
  with check (uploaded_by = (select app.current_employee_id()) and app.module_enabled(module_id));
create policy attachments_archive on public.attachments for update to authenticated
  using (uploaded_by = (select app.current_employee_id()) or app.has_perm(module_id || '.edit'))
  with check (uploaded_by = (select app.current_employee_id()) or app.has_perm(module_id || '.edit'));

-- Notificaciones
create policy notifications_read on public.notifications for select to authenticated
  using (recipient_employee_id = (select app.current_employee_id())
         or recipient_role = (select app.current_role_id()));
create policy notification_reads_read on public.notification_reads for select to authenticated
  using (employee_id = (select app.current_employee_id()));

-- Auditoría
create policy audit_log_read on public.audit_log for select to authenticated
  using ((select app.has_perm('settings.view')));

-- -----------------------------------------------------------------------------
-- Privilegios: anon no ve nada; las credenciales no son legibles por la API.
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on public.employee_credentials from anon, authenticated;
revoke all on public.alert_jobs from anon, authenticated;
revoke insert, update, delete on public.audit_log, public.vehicle_timeline, public.vehicle_status_history,
  public.vehicle_meter_readings, public.notifications, public.notification_reads, public.permissions,
  public.role_permissions, public.vehicle_assignments, public.app_modules
  from authenticated;
revoke delete on all tables in schema public from authenticated;   -- historial: archivado lógico, nunca borrado
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke delete on tables from authenticated;

-- -----------------------------------------------------------------------------
-- Storage (solo existe en Supabase; se omite en entornos sin el esquema)
-- Bucket privado 'files'. Ruta: <modulo>/<entidad>/<uuid>-<nombre>
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('files', 'files', false, 26214400) on conflict (id) do nothing;

    execute $p$create policy "files_read_employees" on storage.objects for select to authenticated
      using (bucket_id = 'files' and app.current_employee_id() is not null)$p$;
    execute $p$create policy "files_upload_employees" on storage.objects for insert to authenticated
      with check (bucket_id = 'files' and app.current_employee_id() is not null
                  and app.module_enabled(split_part(name, '/', 1)))$p$;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Realtime: el dashboard y las campanas se actualizan solos
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.vehicles, public.notifications, public.vehicle_timeline;
  end if;
end $$;
