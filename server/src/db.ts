// PostgreSQL access. Every API request runs inside one transaction under a database role
// (authenticated / service_role / anon) with the caller's JWT claims set, so Row Level Security
// and the SECURITY DEFINER functions of the migrations behave exactly as they do on Supabase.
import pg from 'pg';
import { config } from './config.ts';

// bigint -> number (PostgREST returns JSON numbers for these).
pg.types.setTypeParser(20, value => Number(value));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

pool.on('error', error => console.error('[db] idle client error:', error.message));

export type DbRole = 'anon' | 'authenticated' | 'service_role';

export interface Claims {
  sub?: string;
  email?: string;
}

const ROLES: readonly DbRole[] = ['anon', 'authenticated', 'service_role'];

export async function withRole<T>(
  role: DbRole,
  claims: Claims,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  if (!ROLES.includes(role)) throw new Error('Invalid database role.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${role}`);
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ ...claims, role })]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

// PostgREST-style error object for a failed statement.
export interface DbError {
  code: string | null;
  message: string;
  details: string | null;
  hint: string | null;
}

export function toDbError(error: unknown): DbError {
  const e = error as { code?: string; message?: string; detail?: string; hint?: string };
  return {
    code: e?.code ?? null,
    message: e?.message ?? 'Database error',
    details: e?.detail ?? null,
    hint: e?.hint ?? null,
  };
}

export function isDbError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string';
}
