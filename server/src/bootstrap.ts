// Creates the first Admin from ADMIN_EMAIL / ADMIN_PASSWORD when no Admin exists yet.
// Later admins are invited from the app's user management screen.
import { hashPassword } from './auth.ts';
import { config } from './config.ts';
import { pool } from './db.ts';

export async function ensureFirstAdmin(): Promise<void> {
  const { rows } = await pool.query("SELECT 1 FROM public.profiles WHERE role = 'Admin' LIMIT 1");
  if (rows.length > 0) return;

  if (!config.adminEmail || !config.adminPassword) {
    console.warn('[bootstrap] No Admin exists. Set ADMIN_EMAIL and ADMIN_PASSWORD to create the first one.');
    return;
  }
  if (config.adminPassword.length < 12) {
    throw new Error('ADMIN_PASSWORD must be at least 12 characters long.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const user = await client.query(
      `INSERT INTO auth.users (email, encrypted_password, email_confirmed_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (lower(btrim(email))) DO UPDATE SET encrypted_password = EXCLUDED.encrypted_password
       RETURNING id`,
      [config.adminEmail, hashPassword(config.adminPassword)],
    );
    await client.query(
      `INSERT INTO public.profiles (id, email, full_name, role, department)
       VALUES ($1, $2, $3, 'Admin', 'Administration')
       ON CONFLICT (id) DO NOTHING`,
      [user.rows[0].id, config.adminEmail, config.adminName],
    );
    await client.query('COMMIT');
    console.log(`[bootstrap] Created first Admin: ${config.adminEmail}`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
