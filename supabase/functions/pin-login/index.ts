// Edge Function: pin-login
// Valida el PIN en el servidor (el PIN identifica a la persona; su largo depende del rol)
// y devuelve una sesión de Supabase Auth.
// Cada empleado tiene un usuario interno de Auth (correo sintético, sin contraseña conocida);
// el empleado nunca ve ni usa correo/contraseña. Requiere: SUPABASE_URL, SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY (inyectadas automáticamente por Supabase).
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const MESSAGES: Record<string, string> = {
  invalid: 'PIN incorrecto',
  inactive: 'Cuenta desactivada. Contacte al administrador.',
  locked: 'Demasiados intentos. Espere unos minutos e intente de nuevo.',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  let pin = '';
  try {
    const body = await req.json();
    pin = String(body.pin ?? '').trim();
  } catch { return json({ error: 'Solicitud inválida' }, 400); }
  if (!/^\d{4,8}$/.test(pin)) return json({ error: MESSAGES.invalid }, 401);
  // Límite de intentos por dispositivo: IP que reporta la red de Supabase
  const client = (req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'desconocido').trim();

  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  const { data: result, error } = await admin.rpc('verify_pin', { p_pin: pin, p_client: client });
  if (error) return json({ error: 'Error del servidor' }, 500);
  if (!result?.ok) {
    return json({ error: MESSAGES[result?.reason] ?? MESSAGES.invalid, locked_until: result?.locked_until }, 401);
  }

  // Usuario interno de Auth enlazado al empleado (se crea en el primer acceso)
  const email = `emp-${result.employee_id}@pin.internal`;
  let authUserId: string | null = result.auth_user_id;
  if (!authUserId) {
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email, email_confirm: true, password: crypto.randomUUID() + crypto.randomUUID(),
      app_metadata: { employee_id: result.employee_id, provider: 'pin' },
    });
    if (cErr || !created.user) return json({ error: 'No se pudo preparar la cuenta' }, 500);
    authUserId = created.user.id;
    const { error: lErr } = await admin.rpc('link_employee_auth', { p_employee: result.employee_id, p_auth: authUserId });
    if (lErr) return json({ error: 'No se pudo enlazar la cuenta' }, 500);
  }

  // Sesión sin contraseña: enlace mágico generado y verificado en el servidor
  const { data: link, error: gErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (gErr || !link.properties?.hashed_token) return json({ error: 'No se pudo iniciar sesión' }, 500);
  const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } });
  const { data: session, error: vErr } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
  if (vErr || !session.session) return json({ error: 'No se pudo iniciar sesión' }, 500);

  return json({
    access_token: session.session.access_token,
    refresh_token: session.session.refresh_token,
    expires_at: session.session.expires_at,
  });
});
