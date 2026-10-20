// Applies db/00_compat.sql and supabase/migrations/*.sql in order, once each.
// Applied files are recorded in public.app_schema_migrations.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.ts';
import { pool } from './db.ts';

// The repository root (contains supabase/migrations and server/db).
const root = path.resolve(process.env.APP_ROOT ?? process.cwd());

// 05_seed_data.sql is demo content: applied only when SEED_DEMO_DATA=true.
const DEMO_ONLY = new Set(['05_seed_data.sql']);

async function listMigrations(): Promise<Array<{ name: string; file: string }>> {
  const dir = path.join(root, 'supabase', 'migrations');
  const names = (await readdir(dir)).filter(name => name.endsWith('.sql')).sort();
  return [
    { name: '00_compat.sql', file: path.join(root, 'server', 'db', '00_compat.sql') },
    ...names
      .filter(name => config.seedDemoData || !DEMO_ONLY.has(name))
      .map(name => ({ name, file: path.join(dir, name) })),
  ];
}

export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    // One instance migrates at a time (e.g. during a rolling deploy).
    await client.query('SELECT pg_advisory_lock(hashtext($1))', ['iceberg.migrations']);
    await client.query(`CREATE TABLE IF NOT EXISTS public.app_schema_migrations (
      name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await client.query('REVOKE ALL ON public.app_schema_migrations FROM PUBLIC');

    const done = new Set((await client.query('SELECT name FROM public.app_schema_migrations')).rows.map(row => row.name));
    for (const migration of await listMigrations()) {
      if (done.has(migration.name)) continue;
      const sql = await readFile(migration.file, 'utf8');
      console.log(`[migrate] applying ${migration.name}`);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO public.app_schema_migrations (name) VALUES ($1)', [migration.name]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(`Migration ${migration.name} failed: ${(error as Error).message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['iceberg.migrations']).catch(() => undefined);
    client.release();
  }
}

// One-off cleanup, enabled with PURGE_DEMO_DATA=true: deletes only the records of
// 05_seed_data.sql (see server/db/remove_demo_data.sql). Remove the variable afterwards.
export async function purgeDemoData(): Promise<void> {
  if (!config.purgeDemoData) return;
  if (config.seedDemoData) {
    throw new Error('PURGE_DEMO_DATA and SEED_DEMO_DATA cannot both be true.');
  }
  const sql = await readFile(path.join(root, 'server', 'db', 'remove_demo_data.sql'), 'utf8');
  console.log('[purge] removing demo data (PURGE_DEMO_DATA=true)');
  const result = await pool.query(sql);
  const summary = (Array.isArray(result) ? result : [result]).at(-2) ?? result;
  console.log('[purge] done; remaining rows:', JSON.stringify((summary as { rows?: unknown }).rows ?? []));
  console.log('[purge] Remove PURGE_DEMO_DATA from the service variables.');
}
