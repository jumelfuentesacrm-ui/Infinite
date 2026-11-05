/**
 * DEMO — Traductor mínimo de la API REST de Supabase (PostgREST) a SQL,
 * ejecutado sobre PGlite (Postgres en el navegador). Cada consulta corre
 * como el usuario autenticado (rol `authenticated` + auth.uid()), así que
 * RLS, permisos y funciones son exactamente los de producción.
 * Solo se usa en el build de demostración (VITE_DEMO=1).
 */
import type { PGlite, Transaction } from '@electric-sql/pglite';

type Row = Record<string, any>;
type Node = { col?: string; alias?: string; table?: string; hint?: string; sub?: Node[] };
type Fk = { conname: string; tbl: string; col: string; ref_tbl: string; ref_col: string };

const qi = (s: string) => '"' + s.replace(/"/g, '""') + '"';

export class DemoRest {
  private fks: Fk[] | null = null;
  private fnArgs = new Map<string, Record<string, string>>();
  constructor(private db: PGlite) {}

  private async loadFks(tx: Transaction) {
    if (this.fks) return this.fks;
    const { rows } = await tx.query<Fk>(`
      select c.conname, cl.relname as tbl, a.attname as col, rcl.relname as ref_tbl, ra.attname as ref_col
        from pg_constraint c join pg_class cl on cl.oid = c.conrelid join pg_class rcl on rcl.oid = c.confrelid
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
        join pg_attribute ra on ra.attrelid = c.confrelid and ra.attnum = c.confkey[1]
        join pg_namespace n on n.oid = cl.relnamespace where c.contype = 'f' and n.nspname = 'public'`);
    this.fks = rows;
    return rows;
  }

  /** Columnas de las vistas → tabla base, para resolver embeds desde vistas (gps_fleet_map, etc.) no se necesita */
  private parseSelect(s: string | null): Node[] {
    const items: string[] = []; let depth = 0, cur = '';
    for (const ch of s ?? '*') {
      if (ch === '(') depth++; if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { items.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) items.push(cur.trim());
    return items.map((it) => {
      const m = it.match(/^(?:(\w+):)?(\w+)(?:!(\w+))?\((.*)\)$/s);
      if (!m) return { col: it.replace(/^\w+:/, '') };
      return { alias: m[1] ?? m[2], table: m[2], hint: m[3], sub: this.parseSelect(m[4]) };
    });
  }

  private where(params: URLSearchParams, start = 1) {
    const OPS: Record<string, string> = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };
    const conds: string[] = []; const vals: any[] = [];
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'].includes(k)) continue;
      const not = v.startsWith('not.'); const raw = not ? v.slice(4) : v;
      const dot = raw.indexOf('.'); const op = raw.slice(0, dot); const val = raw.slice(dot + 1);
      let c: string | null = null;
      if (OPS[op]) { vals.push(val); c = `${qi(k)} ${OPS[op]} $${start + vals.length - 1}`; }
      else if (op === 'is') c = `${qi(k)} is ${val === 'null' ? 'null' : val === 'true' ? 'true' : 'false'}`;
      else if (op === 'in') {
        vals.push(val.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')));
        c = `${qi(k)}::text = any($${start + vals.length - 1}::text[])`;
      } else if (op === 'ilike' || op === 'like') { vals.push(val.replace(/\*/g, '%')); c = `${qi(k)}::text ilike $${start + vals.length - 1}`; }
      if (c) conds.push(not ? `not (${c})` : c);
    }
    return { sql: conds.length ? ' where ' + conds.join(' and ') : '', vals };
  }

  private async embed(tx: Transaction, table: string, rows: Row[], tree: Node[], top = true) {
    if (!rows.length) return rows;
    const all = await this.loadFks(tx);
    for (const node of tree.filter((n) => n.table)) {
      let fk = node.hint ? all.find((f) => f.conname === node.hint) : undefined;
      let many = false;
      if (fk) many = fk.tbl !== table;
      else {
        fk = all.find((f) => f.tbl === table && f.ref_tbl === node.table);
        if (!fk) { fk = all.find((f) => f.tbl === node.table && f.ref_tbl === table); many = !!fk; }
      }
      if (!fk) continue;
      const keyCol = many ? fk.ref_col : fk.col;
      const matchCol = many ? fk.col : fk.ref_col;
      const keys = [...new Set(rows.map((r) => r[keyCol]).filter((x) => x != null).map(String))];
      const sub = keys.length
        ? (await tx.query<Row>(`select ${await this.star(tx, node.table!)} from public.${qi(node.table!)} where ${qi(matchCol)}::text = any($1::text[])`, [keys])).rows
        : [];
      await this.embed(tx, node.table!, sub, node.sub!, false);
      const star = node.sub!.some((s) => s.col === '*');
      const pick = (r: Row) => (star ? r : Object.fromEntries(node.sub!.map((s) => { const k = s.alias ?? s.col!; return [k, r[k]]; })));
      for (const r of rows) {
        const m = sub.filter((x) => String(x[matchCol]) === String(r[keyCol]));
        r[node.alias!] = many ? m.map(pick) : m[0] ? pick(m[0]) : null;
      }
    }
    const cols = tree.filter((n) => n.col && n.col !== '*').map((n) => n.col!);
    if (top && !tree.some((n) => n.col === '*') && cols.length) {
      for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k) && !tree.some((n) => n.alias === k)) delete r[k];
    }
    return rows;
  }

  /** '*' como PostgREST: solo las columnas que el rol actual puede leer (privilegios por columna) */
  private starCache = new Map<string, string>();
  private async star(tx: Transaction, table: string) {
    const role = (await tx.query<{ r: string }>('select current_user as r')).rows[0].r;
    const key = role + ':' + table;
    if (!this.starCache.has(key)) {
      const { rows } = await tx.query<{ c: string | null }>(`
        select string_agg(quote_ident(attname), ', ' order by attnum) as c from pg_attribute
         where attrelid = ('public.' || quote_ident($1))::regclass and attnum > 0 and not attisdropped
           and has_column_privilege(attrelid, attnum, 'SELECT')`, [table]);
      this.starCache.set(key, rows[0]?.c || '*');
    }
    return this.starCache.get(key)!;
  }

  private async argTypes(tx: Transaction, fn: string) {
    if (!this.fnArgs.has(fn)) {
      const { rows } = await tx.query<{ n: string; t: string }>(`
        select unnest(proargnames) as n, unnest(proargtypes::regtype[]::text[]) as t
          from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace`, [fn]);
      this.fnArgs.set(fn, Object.fromEntries(rows.map((r) => [r.n, r.t])));
    }
    return this.fnArgs.get(fn)!;
  }

  async handle(method: string, url: URL, body: string | null, headers: Headers, uid: string | null) {
    const path = url.pathname.replace(/^.*\/rest\/v1\//, '');
    const accept = headers.get('accept') ?? '';
    const prefer = headers.get('prefer') ?? '';
    try {
      return await this.db.transaction(async (tx) => {
        await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? '']);
        await tx.exec(uid ? 'set local role authenticated' : 'set local role anon');
        let rows: Row[]; let table: string;

        if (path.startsWith('rpc/')) {
          const fn = path.slice(4);
          const args: Row = method === 'GET' ? Object.fromEntries(url.searchParams) : JSON.parse(body || '{}');
          const types = await this.argTypes(tx, fn);
          const names = Object.keys(args).filter((k) => k in types);
          const vals = names.map((n) => {
            const v = args[n]; const t = types[n];
            if (v === null || v === undefined) return null;
            if (t === 'json' || t === 'jsonb') return JSON.stringify(v);
            if (Array.isArray(v)) return '{' + v.map((x) => '"' + String(x).replace(/"/g, '\\"') + '"').join(',') + '}';
            return v;
          });
          const call = `public.${qi(fn)}(${names.map((n, i) => `${qi(n)} => $${i + 1}::${types[n]}`).join(', ')})`;
          const meta = (await tx.query<{ ret: boolean; rt: string }>(`select proretset as ret, prorettype::regtype::text as rt from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace`, [fn])).rows[0];
          if (!meta?.ret) {
            const r = (await tx.query<{ v: any }>(`select ${call} as v`, vals)).rows[0]?.v;
            return { status: 200, body: r === undefined ? null : r };
          }
          rows = (await tx.query<Row>(`select * from ${call} t`, vals)).rows;
          table = meta.rt.replace(/^public\./, '');
          if (url.searchParams.get('select')) await this.embed(tx, table, rows, this.parseSelect(url.searchParams.get('select')));
        } else {
          table = path;
          if (method === 'POST') {
            const input = JSON.parse(body || '[]');
            const list: Row[] = Array.isArray(input) ? input : [input];
            rows = [];
            for (const r of list) {
              const keys = Object.keys(r);
              const vals = keys.map((k) => (r[k] !== null && typeof r[k] === 'object' && !Array.isArray(r[k]) ? JSON.stringify(r[k]) : Array.isArray(r[k]) ? JSON.stringify(r[k]) : r[k]));
              const sql = keys.length
                ? `insert into public.${qi(table)} (${keys.map(qi).join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning ${await this.star(tx, table)}`
                : `insert into public.${qi(table)} default values returning ${await this.star(tx, table)}`;
              rows.push(...(await tx.query<Row>(sql, vals)).rows);
            }
          } else if (method === 'PATCH') {
            const patch: Row = JSON.parse(body || '{}');
            const keys = Object.keys(patch);
            const vals = keys.map((k) => (patch[k] !== null && typeof patch[k] === 'object' ? JSON.stringify(patch[k]) : patch[k]));
            const w = this.where(url.searchParams, keys.length + 1);
            rows = (await tx.query<Row>(`update public.${qi(table)} set ${keys.map((k, i) => `${qi(k)} = $${i + 1}`).join(', ')}${w.sql} returning ${await this.star(tx, table)}`, [...vals, ...w.vals])).rows;
          } else if (method === 'DELETE') {
            const w = this.where(url.searchParams);
            rows = (await tx.query<Row>(`delete from public.${qi(table)}${w.sql} returning ${await this.star(tx, table)}`, w.vals)).rows;
          } else {
            const w = this.where(url.searchParams);
            let sql = `select ${await this.star(tx, table)} from public.${qi(table)}${w.sql}`;
            const order = url.searchParams.get('order');
            if (order) sql += ' order by ' + order.split(',').map((o) => {
              const [c, d, n] = o.split('.');
              return `${qi(c)} ${d === 'desc' ? 'desc' : 'asc'}${n === 'nullsfirst' ? ' nulls first' : n === 'nullslast' ? ' nulls last' : ''}`;
            }).join(', ');
            if (url.searchParams.get('limit')) sql += ' limit ' + Number(url.searchParams.get('limit'));
            if (url.searchParams.get('offset')) sql += ' offset ' + Number(url.searchParams.get('offset'));
            rows = (await tx.query<Row>(sql, w.vals)).rows;
          }
          if (method !== 'GET' && !prefer.includes('return=representation')) return { status: method === 'POST' ? 201 : 204, body: undefined };
          await this.embed(tx, table, rows, this.parseSelect(url.searchParams.get('select')));
        }

        if (accept.includes('vnd.pgrst.object')) {
          if (rows.length === 1) return { status: 200, body: rows[0] };
          return { status: 406, body: { code: 'PGRST116', message: rows.length ? 'Se esperaba un solo registro' : 'Registro no encontrado', details: null, hint: null } };
        }
        return { status: 200, body: rows };
      });
    } catch (e: any) {
      const status = e.code === '42501' ? 403 : e.code === 'P0002' ? 404 : 400;
      return { status, body: { code: e.code ?? 'P0001', message: e.message, details: e.detail ?? null, hint: e.hint ?? null } };
    }
  }
}
