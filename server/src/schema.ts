// Introspection of the public schema (tables, columns, callable functions).
// The database grants decide what the API exposes: a table or function is reachable only if the
// request's role holds the privilege, exactly like PostgREST.
import { pool } from './db.ts';
import type { DbRole } from './db.ts';

export interface TableMeta {
  columns: Map<string, string>; // column -> udt name
  select: Set<DbRole>;
}

export interface FunctionArg {
  name: string;
  type: string;
}

export interface FunctionMeta {
  name: string;
  args: FunctionArg[];
  returnsSet: boolean;
  returnType: string;
  returnKind: string; // pg_type.typtype
  execute: Set<DbRole>;
}

let tables = new Map<string, TableMeta>();
let functions = new Map<string, FunctionMeta[]>();

const ROLES: DbRole[] = ['anon', 'authenticated', 'service_role'];

export async function loadSchema(): Promise<void> {
  const tableRows = await pool.query(`
    SELECT c.relname AS tbl, a.attname AS col, t.typname AS udt,
           has_table_privilege('anon', c.oid, 'SELECT') AS anon_ok,
           has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_ok,
           has_table_privilege('service_role', c.oid, 'SELECT') AS svc_ok
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    JOIN pg_type t ON t.oid = a.atttypid
    WHERE c.relkind IN ('r', 'p')`);

  const nextTables = new Map<string, TableMeta>();
  for (const row of tableRows.rows) {
    let meta = nextTables.get(row.tbl);
    if (!meta) {
      meta = { columns: new Map(), select: new Set() };
      if (row.anon_ok) meta.select.add('anon');
      if (row.auth_ok) meta.select.add('authenticated');
      if (row.svc_ok) meta.select.add('service_role');
      nextTables.set(row.tbl, meta);
    }
    meta.columns.set(row.col, row.udt);
  }

  const fnRows = await pool.query(`
    SELECT p.proname, p.proretset, rt.typname AS rettype, rt.typtype,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_ok,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_ok,
           has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc_ok,
           COALESCE((
             SELECT json_agg(json_build_object('name', u.n, 'type', format_type(u.ty, NULL)) ORDER BY u.ord)
             FROM unnest(COALESCE(p.proallargtypes, p.proargtypes::oid[]), p.proargnames, p.proargmodes)
                  WITH ORDINALITY AS u(ty, n, m, ord)
             WHERE COALESCE(u.m, 'i') IN ('i', 'b', 'v')
           ), '[]'::json) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
    JOIN pg_type rt ON rt.oid = p.prorettype
    WHERE p.prokind = 'f' AND p.proname LIKE 'fn\\_%'`);

  const nextFunctions = new Map<string, FunctionMeta[]>();
  for (const row of fnRows.rows) {
    const execute = new Set<DbRole>();
    if (row.anon_ok) execute.add('anon');
    if (row.auth_ok) execute.add('authenticated');
    if (row.svc_ok) execute.add('service_role');
    const meta: FunctionMeta = {
      name: row.proname,
      args: row.args,
      returnsSet: row.proretset,
      returnType: row.rettype,
      returnKind: row.typtype,
      execute,
    };
    nextFunctions.set(row.proname, [...(nextFunctions.get(row.proname) ?? []), meta]);
  }

  tables = nextTables;
  functions = nextFunctions;
}

export function getTable(name: string, role: DbRole): TableMeta | null {
  const meta = tables.get(name);
  return meta && meta.select.has(role) ? meta : null;
}

export function getFunction(name: string, role: DbRole, argNames: string[]): FunctionMeta | null {
  const overloads = functions.get(name) ?? [];
  const match = overloads.filter(fn => {
    if (!fn.execute.has(role)) return false;
    const known = new Set(fn.args.map(arg => arg.name));
    return argNames.every(arg => known.has(arg));
  });
  return match.length === 1 ? match[0] : null;
}

export const KNOWN_ROLES = ROLES;
