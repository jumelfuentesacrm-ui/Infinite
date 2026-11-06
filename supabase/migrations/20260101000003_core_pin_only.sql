-- @generated por scripts/modules.mjs — edite el archivo fuente, no este.
-- =============================================================================
-- CORE · Entrada solo con PIN
-- El PIN identifica a la persona: no se escribe código de empleado.
-- El largo del PIN depende del rol (configurable en roles.pin_length):
--   empleados (ATV/UTV, mecánicos) 4 · supervisores 5 · administradores 6.
-- Cada PIN es único entre todos los empleados.
-- Contra adivinanzas: límite de intentos fallidos por dispositivo/IP y global.
-- =============================================================================
alter table public.roles add column if not exists pin_length int not null default 4
  check (pin_length between 4 and 8);
update public.roles set pin_length = 6 where id = 'admin';
update public.roles set pin_length = 5 where id = 'supervisor';
update public.roles set pin_length = 4 where id in ('mechanic', 'driver');

create or replace function app.role_pin_length(p_role text)
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select pin_length from public.roles where id = p_role), 4);
$$;

-- ¿Algún otro empleado ya usa este PIN? (se compara contra los hashes)
create or replace function app.pin_in_use(p_pin text, p_except uuid default null)
returns boolean language plpgsql stable security definer set search_path = public, extensions as $$
declare c record;
begin
  for c in select ec.pin_hash from public.employee_credentials ec
             join public.employees e on e.id = ec.employee_id
             join public.roles r on r.id = e.role_id
            where r.pin_length = length(p_pin) and ec.employee_id is distinct from p_except loop
    if extensions.crypt(p_pin, c.pin_hash) = c.pin_hash then return true; end if;
  end loop;
  return false;
end $$;

create or replace function app.validate_pin(p_pin text, p_role text, p_except uuid default null)
returns void language plpgsql stable security definer set search_path = public as $$
declare n int := app.role_pin_length(p_role); v_label text;
begin
  select name into v_label from public.roles where id = p_role;
  if coalesce(p_pin, '') !~ ('^[0-9]{' || n || '}$') then
    raise exception 'El PIN de % debe tener % dígitos', coalesce(v_label, p_role), n using errcode = '22023';
  end if;
  if p_pin ~ '^(.)\1+$' or position(p_pin in '01234567890') > 0 or position(p_pin in '09876543210') > 0 then
    raise exception 'El PIN es demasiado fácil de adivinar' using errcode = '22023';
  end if;
  if app.pin_in_use(p_pin, p_except) then
    raise exception 'Ese PIN ya lo usa otra persona. Escoja otro.' using errcode = '23505';
  end if;
end $$;

-- Hash con costo 8: el PIN es corto, la protección real es el límite de intentos
create or replace function app.pin_hash(p_pin text)
returns text language sql volatile security definer set search_path = public, extensions as $$
  select extensions.crypt(p_pin, extensions.gen_salt('bf', 8));
$$;

create or replace function public.create_employee(p_code text, p_name text, p_role text, p_pin text,
  p_phone text default null, p_job_title text default null, p_hired_at date default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  perform app.require_perm('employees.create');
  if p_role = 'admin' and not app.has_perm('employees.manage') then
    raise exception 'Solo quien administra permisos puede crear administradores' using errcode = '42501';
  end if;
  perform app.validate_pin(p_pin, p_role);
  insert into public.employees(employee_code, full_name, role_id, phone, job_title, hired_at, notes)
  values (upper(trim(p_code)), trim(p_name), p_role, p_phone, p_job_title, p_hired_at, p_notes)
  returning id into v_id;
  insert into public.employee_credentials(employee_id, pin_hash) values (v_id, app.pin_hash(p_pin));
  return v_id;
end $$;

create or replace function public.set_employee_pin(p_employee uuid, p_pin text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_role text;
begin
  if p_employee is distinct from app.current_employee_id() then
    perform app.require_perm('employees.manage');
  end if;
  select role_id into v_role from public.employees where id = p_employee;
  if v_role is null then raise exception 'Empleado no encontrado' using errcode = 'P0002'; end if;
  perform app.validate_pin(p_pin, v_role, p_employee);
  insert into public.employee_credentials(employee_id, pin_hash) values (p_employee, app.pin_hash(p_pin))
  on conflict (employee_id) do update
     set pin_hash = excluded.pin_hash, failed_attempts = 0, locked_until = null, pin_changed_at = now();
  insert into public.audit_log(table_name, record_id, action, new_data, employee_id)
  values ('employee_credentials', p_employee::text, 'UPDATE', '{"pin":"changed"}', app.current_employee_id());
end $$;

create or replace function public.bootstrap_admin(p_code text, p_name text, p_pin text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  if exists (select 1 from public.employees) then
    raise exception 'Ya existen empleados; use la aplicación para crear más' using errcode = '42501';
  end if;
  perform app.validate_pin(p_pin, 'admin');
  insert into public.employees(employee_code, full_name, role_id, job_title)
  values (upper(trim(p_code)), trim(p_name), 'admin', 'Administrador') returning id into v_id;
  insert into public.employee_credentials(employee_id, pin_hash) values (v_id, app.pin_hash(p_pin));
  return v_id;
end $$;

-- Intentos de entrada (por dispositivo/IP). Ningún rol de la API la lee.
create table if not exists public.auth_attempts (
  id     bigserial primary key,
  client text not null,
  ok     boolean not null,
  at     timestamptz not null default now()
);
create index if not exists auth_attempts_client_idx on public.auth_attempts(client, at desc);
create index if not exists auth_attempts_at_idx on public.auth_attempts(at desc);
alter table public.auth_attempts enable row level security;
revoke all on public.auth_attempts from anon, authenticated;

-- Verificación: SOLO la llama la Edge Function pin-login (service_role).
create or replace function public.verify_pin(p_pin text, p_client text default 'desconocido')
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_max int; v_lock int; v_client text := left(coalesce(nullif(trim(p_client), ''), 'desconocido'), 80);
  r record; v_emp public.employees;
begin
  select (value->>'max_failed_pin_attempts')::int, (value->>'lockout_minutes')::int
    into v_max, v_lock from public.app_settings where key = 'security';
  v_max := coalesce(v_max, 5); v_lock := coalesce(v_lock, 15);

  delete from public.auth_attempts where at < now() - interval '2 days';
  if (select count(*) from public.auth_attempts where client = v_client and not ok and at > now() - make_interval(mins => v_lock)) >= v_max
     or (select count(*) from public.auth_attempts where not ok and at > now() - make_interval(mins => v_lock)) >= v_max * 40 then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;

  if coalesce(p_pin, '') ~ '^[0-9]{4,8}$' then
    for r in select e.id, ec.pin_hash from public.employees e
               join public.employee_credentials ec on ec.employee_id = e.id
               join public.roles ro on ro.id = e.role_id
              where ro.pin_length = length(p_pin) loop
      if extensions.crypt(p_pin, r.pin_hash) = r.pin_hash then
        select * into v_emp from public.employees where id = r.id; exit;
      end if;
    end loop;
  end if;

  if v_emp.id is null then
    insert into public.auth_attempts(client, ok) values (v_client, false);
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if v_emp.status <> 'active' then
    insert into public.auth_attempts(client, ok) values (v_client, false);
    return jsonb_build_object('ok', false, 'reason', 'inactive');
  end if;

  insert into public.auth_attempts(client, ok) values (v_client, true);
  update public.employees set last_login_at = now() where id = v_emp.id;
  insert into public.audit_log(table_name, record_id, action, new_data, employee_id)
  values ('auth', v_emp.id::text, 'UPDATE', jsonb_build_object('event', 'login'), v_emp.id);
  return jsonb_build_object('ok', true, 'employee_id', v_emp.id, 'auth_user_id', v_emp.auth_user_id, 'role_id', v_emp.role_id);
end $$;
revoke execute on function public.verify_pin(text, text) from public, anon, authenticated;
