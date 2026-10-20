// Table queries and RPC calls. Request bodies are a structured query description (never raw SQL):
// identifiers are validated against the introspected schema, values are always bound parameters.
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { authenticate } from './auth.ts';
import { isDbError, toDbError, withRole } from './db.ts';
import type { DbError, DbRole } from './db.ts';
import { getFunction, getTable } from './schema.ts';
import type { TableMeta } from './schema.ts';

type Filter = { column: string; op: string; value: unknown; negate?: boolean };
type Order = { column: string; ascending?: boolean; nullsFirst?: boolean };

interface QuerySpec {
  table: string;
  method: 'select' | 'insert' | 'update' | 'delete';
  columns?: string;
  filters?: Filter[];
  or?: string[];
  order?: Order[];
  limit?: number;
  values?: Record<string, unknown> | Array<Record<string, unknown>>;
  returning?: boolean;
  mode?: 'many' | 'single' | 'maybe';
}

class RequestError extends Error {
  constructor(public readonly db: DbError, public readonly status = 400) {
    super(db.message);
  }
}

const bad = (message: string, code = 'PGRST100') =>
  new RequestError({ code, message, details: null, hint: null });

const OPS: Record<string, string> = {
  eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'LIKE', ilike: 'ILIKE',
};

const quote = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;

function column(meta: TableMeta, name: unknown): string {
  if (typeof name !== 'string' || !meta.columns.has(name)) throw bad(`Unknown column: ${String(name)}`, 'PGRST204');
  return quote(name);
}

function selectList(meta: TableMeta, columns: string | undefined): string {
  const text = (columns ?? '*').trim();
  if (text === '*' || text === '') return '*';
  return text.split(',').map(part => column(meta, part.trim())).join(', ');
}

function encode(meta: TableMeta, name: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  const udt = meta.columns.get(name);
  return udt === 'json' || udt === 'jsonb' ? JSON.stringify(value) : value;
}

function condition(meta: TableMeta, filter: Filter, params: unknown[]): string {
  const col = column(meta, filter.column);
  let sql: string;
  if (filter.op === 'is') {
    const v = filter.value;
    if (v === null || v === 'null') sql = `${col} IS NULL`;
    else if (v === true || v === 'true') sql = `${col} IS TRUE`;
    else if (v === false || v === 'false') sql = `${col} IS FALSE`;
    else throw bad('Invalid value for is operator');
  } else if (filter.op === 'in') {
    if (!Array.isArray(filter.value)) throw bad('in operator requires an array');
    params.push(filter.value);
    sql = `${col} = ANY($${params.length})`;
  } else if (OPS[filter.op]) {
    params.push(filter.value);
    sql = `${col} ${OPS[filter.op]} $${params.length}`;
  } else {
    throw bad(`Unsupported operator: ${filter.op}`);
  }
  return filter.negate ? `NOT (${sql})` : sql;
}

// PostgREST-style "col.op.value,col.op.value" groups, joined with OR.
function orGroup(meta: TableMeta, text: string, params: unknown[]): string {
  const parts = text.split(',').map(part => part.trim()).filter(Boolean);
  if (parts.length === 0) throw bad('Empty or filter');
  const sql = parts.map(part => {
    const [col, op, ...rest] = part.split('.');
    return `(${condition(meta, { column: col, op, value: rest.join('.') }, params)})`;
  });
  return `(${sql.join(' OR ')})`;
}

function where(meta: TableMeta, spec: QuerySpec, params: unknown[]): string {
  const clauses = [
    ...(spec.filters ?? []).map(filter => condition(meta, filter, params)),
    ...(spec.or ?? []).map(text => orGroup(meta, text, params)),
  ];
  return clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
}

function rowsOf(value: QuerySpec['values']): Array<Record<string, unknown>> {
  const rows = Array.isArray(value) ? value : value ? [value] : [];
  if (rows.length === 0 || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw bad('Request body must be an object or a non-empty array of objects');
  }
  return rows;
}

function build(meta: TableMeta, spec: QuerySpec): { sql: string; params: unknown[]; returns: boolean } {
  const params: unknown[] = [];
  const table = `public.${quote(spec.table)}`;
  const returning = spec.returning ? ` RETURNING ${selectList(meta, spec.columns)}` : '';

  if (spec.method === 'select') {
    let sql = `SELECT ${selectList(meta, spec.columns)} FROM ${table}${where(meta, spec, params)}`;
    if (spec.order?.length) {
      sql += ' ORDER BY ' + spec.order
        .map(o => `${column(meta, o.column)} ${o.ascending === false ? 'DESC' : 'ASC'}${o.nullsFirst === undefined ? '' : o.nullsFirst ? ' NULLS FIRST' : ' NULLS LAST'}`)
        .join(', ');
    }
    if (spec.limit !== undefined) {
      if (!Number.isInteger(spec.limit) || spec.limit < 0) throw bad('Invalid limit');
      sql += ` LIMIT ${spec.limit}`;
    }
    return { sql, params, returns: true };
  }

  if (spec.method === 'insert') {
    const rows = rowsOf(spec.values);
    const names = [...new Set(rows.flatMap(row => Object.keys(row)))];
    if (names.length === 0) throw bad('No columns to insert');
    const cols = names.map(name => column(meta, name)).join(', ');
    const tuples = rows.map(row => {
      const marks = names.map(name => {
        params.push(name in row ? encode(meta, name, row[name]) : null);
        return `$${params.length}`;
      });
      return `(${marks.join(', ')})`;
    });
    return { sql: `INSERT INTO ${table} (${cols}) VALUES ${tuples.join(', ')}${returning}`, params, returns: Boolean(spec.returning) };
  }

  // update / delete must always be narrowed by a filter.
  if (!(spec.filters?.length || spec.or?.length)) throw bad(`${spec.method} requires a filter`);

  if (spec.method === 'update') {
    const row = rowsOf(spec.values)[0];
    const sets = Object.keys(row).map(name => {
      const col = column(meta, name);
      params.push(encode(meta, name, row[name]));
      return `${col} = $${params.length}`;
    });
    if (sets.length === 0) throw bad('No columns to update');
    return { sql: `UPDATE ${table} SET ${sets.join(', ')}${where(meta, spec, params)}${returning}`, params, returns: Boolean(spec.returning) };
  }

  if (spec.method === 'delete') {
    return { sql: `DELETE FROM ${table}${where(meta, spec, params)}${returning}`, params, returns: Boolean(spec.returning) };
  }

  throw bad('Unsupported method');
}

function shape(rows: unknown[], mode: QuerySpec['mode']) {
  if (mode === 'single' || mode === 'maybe') {
    if (rows.length === 1) return rows[0];
    if (rows.length === 0 && mode === 'maybe') return null;
    throw new RequestError({
      code: 'PGRST116',
      message: 'JSON object requested, multiple (or no) rows returned',
      details: `The result contains ${rows.length} rows`,
      hint: null,
    });
  }
  return rows;
}

function errorBody(error: unknown): { db: DbError; status: number } {
  if (error instanceof RequestError) return { db: error.db, status: error.status };
  if (isDbError(error)) return { db: toDbError(error), status: 400 };
  console.error('[rest] unexpected error:', error);
  return { db: { code: 'PGRST000', message: 'Internal error', details: null, hint: null }, status: 500 };
}

function roleFor(user: { id: string } | null): DbRole | null {
  return user ? 'authenticated' : null;
}

export const restRoutes = new Hono();
restRoutes.use('*', bodyLimit({ maxSize: 2 * 1024 * 1024, onError: c => c.json({ data: null, error: { code: 'PGRST000', message: 'Request too large' } }, 413) }));

restRoutes.post('/query', async c => {
  const user = await authenticate(c);
  const role = roleFor(user);
  if (!user || !role) return c.json({ data: null, error: { code: 'PGRST301', message: 'JWT expired or invalid' } }, 401);

  try {
    const spec = (await c.req.json()) as QuerySpec;
    const meta = getTable(spec.table, role);
    if (!meta) throw bad(`Table not found: ${String(spec.table)}`, 'PGRST205');
    const { sql, params, returns } = build(meta, spec);
    const data = await withRole(role, { sub: user.id, email: user.email }, async client => {
      const result = await client.query(sql, params as unknown[]);
      return returns ? shape(result.rows, spec.mode) : null;
    });
    return c.json({ data, error: null });
  } catch (error) {
    const { db, status } = errorBody(error);
    return c.json({ data: null, error: db }, status as 400 | 500);
  }
});

restRoutes.post('/rpc/:fn', async c => {
  const user = await authenticate(c);
  const role = roleFor(user);
  if (!user || !role) return c.json({ data: null, error: { code: 'PGRST301', message: 'JWT expired or invalid' } }, 401);

  try {
    const args = ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    if (typeof args !== 'object' || Array.isArray(args)) throw bad('RPC arguments must be an object');
    const result = await callRpc(role, { sub: user.id, email: user.email }, c.req.param('fn'), args);
    return c.json({ data: result, error: null });
  } catch (error) {
    const { db, status } = errorBody(error);
    return c.json({ data: null, error: db }, status as 400 | 500);
  }
});

// Shared by the HTTP route and the Edge-Function dependencies (admin-users / auth-links).
export async function callRpc(
  role: DbRole,
  claims: { sub?: string; email?: string },
  fn: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const names = Object.keys(args);
  const meta = getFunction(fn, role, names);
  if (!meta) throw bad(`Could not find the function ${fn}`, 'PGRST202');

  const types = new Map(meta.args.map(arg => [arg.name, arg.type]));
  const params = names.map(name => {
    const value = args[name];
    const type = types.get(name);
    return (type === 'json' || type === 'jsonb') && value !== null && value !== undefined ? JSON.stringify(value) : value;
  });
  const call = `public.${quote(fn)}(${names.map((name, i) => `${quote(name)} => $${i + 1}`).join(', ')})`;
  const composite = meta.returnsSet || meta.returnKind === 'c';

  return withRole(role, claims, async client => {
    if (composite) {
      const result = await client.query(`SELECT * FROM ${call}`, params);
      return meta.returnsSet ? result.rows : result.rows[0] ?? null;
    }
    const result = await client.query(`SELECT ${call} AS result`, params);
    return meta.returnType === 'void' ? null : result.rows[0]?.result ?? null;
  });
}
