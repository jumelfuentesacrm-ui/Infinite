// Edge Function: gps-ingest  (módulo GPS)
// Recibe posiciones de rastreadores, tabletas o proveedores externos, sin depender de que
// la app esté abierta. Autenticación por token del dispositivo (se genera al registrarlo
// en GPS › Dispositivos; solo se guarda su hash).
//
//   POST /functions/v1/gps-ingest
//   Authorization: Bearer <token-del-dispositivo>
//   { "points": [{ "lat": 18.46, "lng": -66.10, "speed_kmh": 12, "heading": 90,
//                  "accuracy_m": 8, "recorded_at": "2026-11-03T14:00:00Z" }] }
//
// Adaptadores de proveedores: añada un archivo en ./adapters y regístrelo en ADAPTERS.
// Cada adaptador convierte el formato del proveedor al formato estándar de arriba.
import { createClient } from 'npm:@supabase/supabase-js@2';

type Point = { lat: number; lng: number; speed_kmh?: number; heading?: number; accuracy_m?: number; recorded_at?: string };
type Adapter = (body: any) => Point[];

const ADAPTERS: Record<string, Adapter> = {
  standard: (b) => b.points ?? [],
  // Formato común de rastreadores tipo Traccar/OsmAnd: ?lat=..&lon=..&speed=(nudos)&bearing=..&timestamp=..
  osmand: (b) => [{ lat: +b.lat, lng: +b.lon, speed_kmh: b.speed != null ? +b.speed * 1.852 : undefined,
                    heading: b.bearing != null ? +b.bearing : undefined, accuracy_m: b.accuracy != null ? +b.accuracy : undefined,
                    recorded_at: b.timestamp ? new Date(+b.timestamp * (String(b.timestamp).length <= 10 ? 1000 : 1)).toISOString() : undefined }],
};

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? url.searchParams.get('token') ?? '';
  if (token.length < 32) return new Response('No autorizado', { status: 401 });

  let body: any = Object.fromEntries(url.searchParams);
  if (req.method === 'POST') {
    try { body = { ...body, ...(await req.json()) }; } catch { /* formulario o vacío */ }
  }
  const adapter = ADAPTERS[url.searchParams.get('format') ?? 'standard'] ?? ADAPTERS.standard;
  const points = adapter(body).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)).slice(0, 500);
  if (!points.length) return new Response(JSON.stringify({ error: 'Sin puntos válidos' }), { status: 400 });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const { data, error } = await admin.rpc('gps_ingest', { p_token_hash: await sha256(token), p_points: points });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: error.code === '42501' ? 401 : 400 });
  return new Response(JSON.stringify({ ok: true, stored: data }), { headers: { 'Content-Type': 'application/json' } });
});
