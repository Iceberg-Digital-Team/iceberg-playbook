// Runtime configuration, read once from environment variables.
import path from 'node:path';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function flag(name: string): boolean {
  return /^(1|true|yes)$/i.test(process.env[name]?.trim() ?? '');
}

function origins(): string[] {
  const list = new Set<string>();
  for (const raw of [process.env.PUBLIC_URL, ...(process.env.ALLOWED_ORIGINS ?? '').split(',')]) {
    const origin = raw?.trim().replace(/\/+$/, '');
    if (origin && origin !== '*') list.add(origin);
  }
  // Railway injects the public domain of the service.
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (railway) list.add(`https://${railway}`);
  if (process.env.NODE_ENV !== 'production') {
    for (const port of [5173, 4173, 3000, 8080]) list.add(`http://localhost:${port}`);
  }
  return [...list];
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required('DATABASE_URL'),
  databaseSsl: flag('DATABASE_SSL'),
  jwtSecret: required('JWT_SECRET'),
  accessTokenTtlSeconds: 60 * 60,
  refreshTokenTtlSeconds: 14 * 24 * 60 * 60,
  storageDir: path.resolve(process.env.STORAGE_DIR ?? './data/storage'),
  staticDir: path.resolve(process.env.STATIC_DIR ?? './dist'),
  allowedOrigins: origins(),
  seedDemoData: flag('SEED_DEMO_DATA'),
  adminEmail: process.env.ADMIN_EMAIL?.trim() ?? '',
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
  adminName: process.env.ADMIN_NAME?.trim() || 'Administrator',
};

if (config.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters long.');
}
