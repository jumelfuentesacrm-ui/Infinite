#!/usr/bin/env node
/**
 * Gestor de módulos ("piezas de lego").
 *
 *   npm run modules list                      → módulos instalados y su estado
 *   npm run modules check                     → valida dependencias
 *   npm run modules sync                      → genera supabase/migrations y supabase/functions
 *   npm run modules new-client <dir> <ids>    → copia el proyecto SOLO con los módulos indicados
 *                                               ej: new-client ../acme inspections,fuel,workorders
 *
 * Fuente de verdad:
 *   supabase/core/*.sql            → núcleo (siempre)
 *   modules/<id>/module.json       → manifiesto (dependencias, versión de migración)
 *   modules/<id>/db/*.sql          → esquema del módulo
 *   modules/<id>/functions/<fn>/   → Edge Functions del módulo (opcional)
 *   modules/<id>/ui/index.tsx      → interfaz (se descubre sola en el build)
 *   client.config.json             → marca y módulos activos para este cliente
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULES_DIR = path.join(ROOT, 'modules');
const CORE_SQL = path.join(ROOT, 'supabase', 'core');
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const FUNCTIONS = path.join(ROOT, 'supabase', 'functions');
const GENERATED_MARK = '-- @generated por scripts/modules.mjs — edite el archivo fuente, no este.\n';

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

function installedModules() {
  if (!fs.existsSync(MODULES_DIR)) return [];
  return fs.readdirSync(MODULES_DIR)
    .filter((d) => fs.existsSync(path.join(MODULES_DIR, d, 'module.json')))
    .map((d) => ({ ...readJson(path.join(MODULES_DIR, d, 'module.json')), dir: path.join(MODULES_DIR, d) }))
    .sort((a, b) => a.migration.localeCompare(b.migration));
}

function clientConfig() {
  const p = path.join(ROOT, 'client.config.json');
  return fs.existsSync(p) ? readJson(p) : { modules: {} };
}

function check(mods = installedModules()) {
  const cfg = clientConfig();
  const ids = new Set(mods.map((m) => m.id));
  const enabled = new Set(mods.filter((m) => cfg.modules?.[m.id] !== false).map((m) => m.id));
  const errors = [];
  for (const m of mods) {
    for (const dep of m.dependsOn ?? []) {
      if (!ids.has(dep)) errors.push(`"${m.id}" requiere el módulo "${dep}", que no está instalado.`);
      else if (enabled.has(m.id) && !enabled.has(dep)) errors.push(`"${m.id}" está activo pero su dependencia "${dep}" está desactivada.`);
    }
    if (m.id !== path.basename(m.dir)) errors.push(`La carpeta ${path.basename(m.dir)} no coincide con id "${m.id}".`);
  }
  errors.push(...importViolations(mods));
  for (const key of Object.keys(cfg.modules ?? {})) {
    if (!ids.has(key)) errors.push(`client.config.json menciona "${key}", que no está instalado (bórrelo o copie el módulo).`);
  }
  return errors;
}

/**
 * Regla anti-espagueti: el código de un módulo solo puede importar
 * su propia carpeta, el núcleo (@core/...) y paquetes npm. Nunca otro módulo
 * ni las páginas del núcleo (src/core-modules, src/app).
 */
function importViolations(mods) {
  const out = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(tsx?|jsx?)$/.test(e.name) ? [path.join(dir, e.name)] : []);
  for (const m of mods) {
    const ui = path.join(m.dir, 'ui');
    if (!fs.existsSync(ui)) continue;
    for (const file of walk(ui)) {
      const src = fs.readFileSync(file, 'utf8');
      for (const [, spec] of src.matchAll(/(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g).map((x) => [x[0], x[1] ?? x[2]])) {
        if (!spec) continue;
        const rel = path.relative(ROOT, file);
        if (spec.startsWith('.')) {
          const target = path.resolve(path.dirname(file), spec);
          if (!target.startsWith(m.dir + path.sep) && target !== m.dir) out.push(`${rel}: importa "${spec}" fuera de su módulo. Use @core o un slot.`);
        } else if (spec.startsWith('@app') || spec.includes('core-modules') || (!spec.startsWith('@core/') && /(^|\/)modules\//.test(spec))) {
          out.push(`${rel}: importa "${spec}". Los módulos solo pueden usar @core/* y paquetes npm.`);
        }
      }
    }
  }
  // El núcleo tampoco puede depender de un módulo (solo lo descubre por import.meta.glob)
  for (const file of walk(path.join(ROOT, 'src'))) {
    const src = fs.readFileSync(file, 'utf8');
    if (/from\s+['"][^'"]*\.\.\/modules\//.test(src) || /import\(\s*['"][^'"]*\.\.\/modules\//.test(src)) {
      out.push(`${path.relative(ROOT, file)}: el núcleo no puede importar módulos. Use slots o el registro.`);
    }
  }
  return out;
}

function copyDir(src, dst, filter = () => true) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (!filter(s, entry)) continue;
    if (entry.isDirectory()) copyDir(s, d, filter);
    else fs.copyFileSync(s, d);
  }
}

function sync() {
  const mods = installedModules();
  const errors = check(mods);
  if (errors.length) { console.error('✖ ' + errors.join('\n✖ ')); process.exit(1); }

  fs.mkdirSync(MIGRATIONS, { recursive: true });
  const wanted = new Map();
  for (const f of fs.readdirSync(CORE_SQL).filter((f) => f.endsWith('.sql')).sort()) {
    const n = f.match(/^(\d+)_/)?.[1] ?? '000';
    wanted.set(`20260101000${n.padStart(3, '0').slice(-3)}_core_${f.replace(/^\d+_/, '')}`, path.join(CORE_SQL, f));
  }
  for (const m of mods) {
    const dbDir = path.join(m.dir, 'db');
    if (!fs.existsSync(dbDir)) continue;
    const files = fs.readdirSync(dbDir).filter((f) => f.endsWith('.sql')).sort();
    files.forEach((f, i) => {
      const version = (BigInt(m.migration) + BigInt(i)).toString();
      // El primer archivo conserva el nombre corto: añadir archivos nunca renombra una migración ya aplicada
      wanted.set(`${version}_${m.id}${i > 0 ? '_' + f.replace('.sql', '') : ''}.sql`, path.join(dbDir, f));
    });
  }

  // Escribe/actualiza migraciones generadas. No borra las de módulos retirados:
  // una migración aplicada no se elimina (los datos se conservan siempre).
  for (const [name, src] of wanted) {
    const out = GENERATED_MARK + fs.readFileSync(src, 'utf8');
    const dst = path.join(MIGRATIONS, name);
    if (!fs.existsSync(dst) || fs.readFileSync(dst, 'utf8') !== out) {
      fs.writeFileSync(dst, out);
      console.log('  migración  ' + name);
    }
  }
  for (const f of fs.readdirSync(MIGRATIONS)) {
    if (!wanted.has(f) && fs.readFileSync(path.join(MIGRATIONS, f), 'utf8').startsWith(GENERATED_MARK)) {
      console.warn(`  ⚠ ${f} pertenece a un módulo que ya no está instalado. Se conserva (no borre migraciones aplicadas).`);
    }
  }

  // Edge Functions de los módulos
  for (const m of mods) {
    const fnDir = path.join(m.dir, 'functions');
    if (!fs.existsSync(fnDir)) continue;
    for (const fn of fs.readdirSync(fnDir)) {
      copyDir(path.join(fnDir, fn), path.join(FUNCTIONS, fn));
      console.log('  función    ' + fn + '  (' + m.id + ')');
    }
  }
  console.log(`✔ ${wanted.size} migraciones listas para: supabase db push --include-all`);
}

function list() {
  const cfg = clientConfig();
  const mods = installedModules();
  console.log('Núcleo: auth PIN, permisos, empleados, flota, notificaciones, dashboard, ajustes (siempre)\n');
  for (const m of mods) {
    const on = cfg.modules?.[m.id] !== false;
    console.log(`${on ? '●' : '○'} ${m.id.padEnd(14)} ${m.name.padEnd(14)} deps: ${(m.dependsOn ?? []).join(', ') || '—'}`);
  }
  const errors = check(mods);
  if (errors.length) console.error('\n✖ ' + errors.join('\n✖ '));
}

function newClient(target, idsArg) {
  if (!target || !idsArg) { console.error('Uso: new-client <carpeta-destino> <mod1,mod2,...|all>'); process.exit(1); }
  const all = installedModules();
  const chosen = new Set(idsArg === 'all' ? all.map((m) => m.id) : idsArg.split(',').map((s) => s.trim()).filter(Boolean));
  // añade dependencias duras automáticamente
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of all) if (chosen.has(m.id)) for (const d of m.dependsOn ?? []) if (!chosen.has(d)) { chosen.add(d); changed = true; console.log(`  + ${d} (requerido por ${m.id})`); }
  }
  for (const id of chosen) if (!all.find((m) => m.id === id)) { console.error(`Módulo desconocido: ${id}`); process.exit(1); }

  const dst = path.resolve(target);
  if (fs.existsSync(dst) && fs.readdirSync(dst).length) { console.error(`La carpeta ${dst} no está vacía.`); process.exit(1); }
  const skip = new Set(['node_modules', 'dist', '.git', '.env', '.env.local', 'migrations']);
  copyDir(ROOT, dst, (src) => {
    const rel = path.relative(ROOT, src);
    const parts = rel.split(path.sep);
    if (skip.has(parts[parts.length - 1]) && !rel.startsWith('modules')) return false;
    if (parts[0] === 'modules' && parts.length >= 2 && !chosen.has(parts[1])) return false;
    if (parts[0] === 'supabase' && parts[1] === 'functions' && parts.length >= 3) {
      // solo funciones del núcleo; las de módulos se regeneran con sync
      const owner = all.find((m) => fs.existsSync(path.join(m.dir, 'functions', parts[2])));
      if (owner && !chosen.has(owner.id)) return false;
    }
    return true;
  });
  const cfgPath = path.join(dst, 'client.config.json');
  const cfg = readJson(cfgPath);
  cfg.modules = Object.fromEntries([...chosen].sort().map((id) => [id, true]));
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`✔ Proyecto creado en ${dst} con: ${[...chosen].join(', ')}`);
  console.log('  Siguiente: cd ' + target + ' && npm install && npm run modules sync');
}

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case 'list': list(); break;
  case 'check': { const e = check(); if (e.length) { console.error('✖ ' + e.join('\n✖ ')); process.exit(1); } console.log('✔ Dependencias correctas'); break; }
  case 'sync': sync(); break;
  case 'new-client': newClient(args[0], args[1]); break;
  default: console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 22).join('\n'));
}
