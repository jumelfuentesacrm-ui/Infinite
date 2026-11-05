/**
 * DEMO — Intercepta las llamadas de supabase-js (REST, Auth, Funciones, Storage)
 * y las resuelve contra PGlite. Nada sale del navegador.
 */
import { db, rest } from './backend';

const json = (body: unknown, status = 200) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const b64 = (o: object) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const makeToken = (sub: string) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub, role: 'authenticated', aud: 'authenticated', exp: 4102444800, iat: Math.floor(Date.now() / 1000) })}.demo`;
function subOf(auth: string | null): string | null {
  const t = auth?.replace(/^Bearer\s+/i, '');
  if (!t || t.split('.').length !== 3) return null;
  try { return JSON.parse(decodeURIComponent(escape(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))).sub ?? null; } catch { return null; }
}
const user = (id: string) => ({ id, aud: 'authenticated', role: 'authenticated', email: `${id}@pin.demo`, app_metadata: { provider: 'pin' }, user_metadata: {}, created_at: new Date().toISOString() });
const session = (id: string) => ({ access_token: makeToken(id), refresh_token: id, token_type: 'bearer', expires_in: 31536000, expires_at: 4102444800, user: user(id) });

const MESSAGES: Record<string, string> = {
  invalid: 'Código o PIN incorrecto', inactive: 'Cuenta desactivada. Contacte al administrador.', locked: 'Demasiados intentos. Cuenta bloqueada temporalmente.',
};

export async function demoFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const req = new Request(input, init);
  const url = new URL(req.url);
  const path = url.pathname;
  const headers = req.headers;

  // ---- Edge Function pin-login (misma lógica que supabase/functions/pin-login)
  if (path.endsWith('/functions/v1/pin-login')) {
    const { code = '', pin = '' } = await req.json().catch(() => ({}));
    const r = (await db.query<{ v: any }>(`select public.verify_employee_pin($1, $2) as v`, [String(code), String(pin)])).rows[0].v;
    if (!r.ok) return json({ error: MESSAGES[r.reason] ?? MESSAGES.invalid }, 401);
    let uid: string = r.auth_user_id;
    if (!uid) {
      uid = (await db.query<{ id: string }>(`insert into auth.users default values returning id`)).rows[0].id;
      await db.query(`select public.link_employee_auth($1, $2)`, [r.employee_id, uid]);
    }
    const s = session(uid);
    return json({ access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at });
  }
  if (path.includes('/functions/v1/')) return json({ error: 'No disponible en el demo' }, 404);

  // ---- Auth
  if (path.endsWith('/auth/v1/user')) { const s = subOf(headers.get('authorization')); return s ? json(user(s)) : json({ message: 'No autenticado' }, 401); }
  if (path.endsWith('/auth/v1/token')) {
    const body = await req.json().catch(() => ({}));
    return body.refresh_token ? json(session(body.refresh_token)) : json({ error: 'invalid_grant' }, 400);
  }
  if (path.endsWith('/auth/v1/logout')) return new Response(null, { status: 204 });

  // ---- Storage (archivos guardados dentro de la base del demo)
  const up = path.match(/\/storage\/v1\/object\/files\/(.+)$/);
  if (up && req.method === 'POST') {
    let blob: Blob;
    const ct = headers.get('content-type') ?? '';
    if (ct.includes('multipart/form-data')) { const fd = await req.formData(); blob = [...fd.values()].find((v): v is File => v instanceof Blob) as Blob; }
    else blob = await req.blob();
    const key = decodeURIComponent(up[1]);
    await db.query(`insert into demo.files(path, mime, data) values ($1, $2, $3) on conflict (path) do update set data = excluded.data`,
      [key, blob.type || 'application/octet-stream', new Uint8Array(await blob.arrayBuffer())]);
    return json({ Key: `files/${key}`, Id: key, path: key });
  }

  // ---- REST
  if (path.includes('/rest/v1/')) {
    const body = ['GET', 'HEAD'].includes(req.method) ? null : await req.text();
    const r = await rest.handle(req.method, url, body, headers, subOf(headers.get('authorization')));
    return r.body === undefined ? new Response(null, { status: r.status }) : json(r.body, r.status);
  }
  return json({ message: 'No disponible en el demo' }, 404);
}

/** URL local de un archivo subido en el demo */
const urls = new Map<string, string>();
export async function demoFileUrl(path: string) {
  if (urls.has(path)) return urls.get(path)!;
  const row = (await db.query<{ mime: string; data: Uint8Array }>(`select mime, data from demo.files where path = $1`, [path])).rows[0];
  if (!row) throw new Error('Archivo no encontrado');
  const u = URL.createObjectURL(new Blob([row.data as BlobPart], { type: row.mime }));
  urls.set(path, u);
  return u;
}

/** Realtime no aplica en el demo: socket inerte */
export class InertSocket {
  readyState = 0; binaryType = 'arraybuffer'; url: string;
  onopen: unknown = null; onclose: unknown = null; onerror: unknown = null; onmessage: unknown = null;
  constructor(url: string) { this.url = url; }
  close() { /* */ } send() { /* */ } addEventListener() { /* */ } removeEventListener() { /* */ }
}
