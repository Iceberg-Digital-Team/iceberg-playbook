import fs from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { authRoutes } from './auth.ts';
import { ensureFirstAdmin } from './bootstrap.ts';
import { config } from './config.ts';
import { pool } from './db.ts';
import { functionRoutes } from './functions.ts';
import { migrate } from './migrate.ts';
import { restRoutes } from './rest.ts';
import { loadSchema } from './schema.ts';
import { storageRoutes } from './storage.ts';

const app = new Hono();

app.use('*', secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
    imgSrc: ["'self'", 'data:', 'blob:'],
    mediaSrc: ["'self'", 'blob:'],
    connectSrc: ["'self'"],
    frameSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    frameAncestors: ["'self'"],
  },
}));

app.get('/healthz', async c => {
  try {
    await pool.query('SELECT 1');
    return c.json({ status: 'ok' });
  } catch {
    return c.json({ status: 'unavailable' }, 503);
  }
});

app.route('/auth/v1', authRoutes);
app.route('/rest/v1', restRoutes);
app.route('/storage/v1', storageRoutes);
app.route('/functions/v1', functionRoutes);

// Built single-page app.
const indexHtml = path.join(config.staticDir, 'index.html');
if (fs.existsSync(indexHtml)) {
  const relativeRoot = path.relative(process.cwd(), config.staticDir) || '.';
  app.use('/assets/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
  });
  app.use('*', serveStatic({ root: relativeRoot }));
  app.get('*', serveStatic({ root: relativeRoot, path: 'index.html' }));
} else {
  console.warn(`[server] No built frontend at ${config.staticDir}; serving the API only.`);
}

app.onError((error, c) => {
  console.error('[server] unhandled error:', error);
  return c.json({ error: 'Internal server error' }, 500);
});

async function main() {
  fs.mkdirSync(config.storageDir, { recursive: true });
  try {
    fs.accessSync(config.storageDir, fs.constants.W_OK);
  } catch {
    throw new Error(`STORAGE_DIR (${config.storageDir}) is not writable. On Railway set RAILWAY_RUN_UID=0 for the mounted volume.`);
  }
  await migrate();
  await loadSchema();
  await ensureFirstAdmin();
  const server = serve({ fetch: app.fetch, port: config.port }, info => {
    console.log(`[server] listening on :${info.port}`);
  });
  const shutdown = () => {
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(error => {
  console.error('[server] failed to start:', error);
  process.exit(1);
});
