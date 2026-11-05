// Edge Function: run-alerts
// Ejecuta public.run_alerts(): cada módulo instalado y activo genera sus alertas
// (inspecciones pendientes, mantenimientos, documentos, inventario, órdenes atrasadas).
// Programar cada hora con Supabase Cron (ver SETUP.md) o con pg_cron directamente:
//   select cron.schedule('run-alerts', '0 * * * *', 'select public.run_alerts()');
// Protegida con CRON_SECRET (cabecera x-cron-secret).
import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
  }
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const { data, error } = await admin.rpc('run_alerts');
  return new Response(JSON.stringify(error ? { error: error.message } : { ok: true, jobs: data }), {
    status: error ? 500 : 200, headers: { 'Content-Type': 'application/json' },
  });
});
