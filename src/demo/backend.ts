/**
 * DEMO — Postgres en el navegador (PGlite) con las migraciones reales del sistema
 * y datos de ejemplo. Reemplaza a Supabase solo en el build de demostración.
 */
import { PGlite, types } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import stub from '../../supabase/tests/00_supabase_stub.sql?raw';
import seed from './seed.sql?raw';
import { DemoRest } from './rest';

const migrations = import.meta.glob('../../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const VERSION = 'v' + Object.values(migrations).reduce((n, s) => n + s.length, seed.length);
const DB_NAME = `fleet-ops-demo-${VERSION}`;
const READY_FLAG = `${DB_NAME}:ready`;

export let db: PGlite;
export let rest: DemoRest;
let booting: Promise<void> | null = null;

const parsers = {
  [types.NUMERIC]: (v: string) => Number(v),
  [types.INT8]: (v: string) => Number(v),
  [types.DATE]: (v: string) => v,
  [types.TIMESTAMPTZ]: (v: string) => new Date(v).toISOString(),
  [types.TIMESTAMP]: (v: string) => v,
};

async function open(dataDir?: string) {
  return PGlite.create({ dataDir, extensions: { pgcrypto, btree_gist }, parsers, relaxedDurability: true });
}

const storageOk = () => { try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return !!window.indexedDB; } catch { return false; } };
const flag = { get: () => { try { return localStorage.getItem(READY_FLAG) === '1'; } catch { return false; } },
  set: () => { try { localStorage.setItem(READY_FLAG, '1'); } catch { /* sin almacenamiento */ } } };

export function bootDemo(onStep: (msg: string) => void) {
  if (booting) return booting;
  booting = (async () => {
    onStep('Iniciando base de datos…');
    const persistent = storageOk();
    db = await open(persistent ? `idb://${DB_NAME}` : undefined).catch(() => open());
    const installed = (await db.query<{ t: string | null }>(`select to_regclass('public.vehicles')::text as t`)).rows[0].t;
    const fresh = !installed || !flag.get();
    if (fresh && installed) { await db.close(); db = await open(); } // base a medio instalar: empezar limpio en memoria
    if (fresh) {
      onStep('Instalando núcleo y módulos…');
      await db.exec(stub);
      const files = Object.keys(migrations).sort();
      for (let i = 0; i < files.length; i++) {
        onStep(`Instalando módulos (${i + 1}/${files.length})…`);
        await db.exec(migrations[files[i]]);
      }
      onStep('Cargando datos de ejemplo…');
      await db.exec(seed);
      if (persistent) flag.set();
    }
    rest = new DemoRest(db);
  })();
  return booting;
}

/** Borra los cambios hechos y vuelve a los datos de ejemplo */
export async function resetDemo() {
  try { localStorage.removeItem(READY_FLAG); localStorage.removeItem('fleet-ops-auth'); } catch { /* */ }
  try { await db?.close(); } catch { /* */ }
  await new Promise<void>((res) => { try { const r = indexedDB.deleteDatabase(`/pglite/${DB_NAME}`); r.onsuccess = r.onerror = r.onblocked = () => res(); } catch { res(); } });
  location.reload();
}
