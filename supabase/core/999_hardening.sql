-- =============================================================================
-- CORE · Endurecimiento final (se aplica DESPUÉS de todos los módulos)
-- 1. Los visitantes sin sesión (anon) no pueden ejecutar ninguna función de la API.
--    El login por PIN usa la Edge Function con service_role, no anon.
-- 2. Toda función interna (esquema app) tiene search_path fijo.
-- Es idempotente: se puede volver a aplicar al instalar módulos nuevos.
-- =============================================================================
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated, service_role;
alter default privileges in schema public revoke execute on functions from anon, public;

-- Funciones solo para el servidor (vuelven a quedar fuera del alcance de authenticated)
do $$
declare f text;
begin
  foreach f in array array['public.verify_employee_pin(text,text)', 'public.link_employee_auth(uuid,uuid)',
                           'public.bootstrap_admin(text,text,text)', 'public.run_alerts()', 'public.gps_ingest(text,jsonb)'] loop
    if to_regprocedure(f) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', f);
    end if;
  end loop;
end $$;

-- Funciones públicas a propósito (comentario '@public'): p. ej. el reporte de taller sin PIN.
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and obj_description(p.oid, 'pg_proc') like '@public%' loop
    execute format('grant execute on function %s to anon', r.fn);
  end loop;
end $$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'app' and (p.proconfig is null or not exists
              (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) loop
    execute format('alter function %s set search_path = public, extensions', r.fn);
  end loop;
end $$;
