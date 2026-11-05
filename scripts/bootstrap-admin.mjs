#!/usr/bin/env node
/**
 * Crea el PRIMER administrador (solo funciona si no existe ningún empleado).
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run bootstrap-admin -- ADMIN "Nombre Apellido" 482613
 * También lee VITE_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY de .env.local.
 */
import fs from 'node:fs';

for (const f of ['.env.local', '.env']) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const [code, name, pin] = process.argv.slice(2);
if (!url || !key || !code || !name || !pin) {
  console.error('Uso: npm run bootstrap-admin -- <CODIGO> "<Nombre>" <PIN>\nRequiere SUPABASE_URL (o VITE_SUPABASE_URL) y SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
const res = await fetch(`${url}/rest/v1/rpc/bootstrap_admin`, {
  method: 'POST',
  headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_code: code, p_name: name, p_pin: pin }),
});
const body = await res.text();
if (!res.ok) { console.error('✖', body); process.exit(1); }
console.log(`✔ Administrador creado. Entre con código ${code.toUpperCase()} y su PIN.`);
