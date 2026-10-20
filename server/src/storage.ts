// Private object storage. Metadata lives in storage.objects (so the Row Level Security policies of
// migration 04 apply unchanged); the bytes live on a local volume (STORAGE_DIR).
// Download links are short-lived signed tokens, like Supabase signed URLs.
import fs from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { authenticate } from './auth.ts';
import { config } from './config.ts';
import { pool, toDbError, withRole } from './db.ts';
import { signStorageToken, verifyToken } from './tokens.ts';

const BUCKET_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/i;

function fail(c: Context, status: 400 | 401 | 403 | 404 | 409 | 413 | 500, message: string) {
  return c.json({ statusCode: String(status), error: message, message }, status);
}

// Resolve bucket/key to a path inside STORAGE_DIR; reject anything that escapes it.
function filePath(bucket: string, key: string): string | null {
  if (!BUCKET_RE.test(bucket) || !key || key.includes('\0')) return null;
  const root = path.join(config.storageDir, bucket);
  const full = path.resolve(root, key);
  return full.startsWith(root + path.sep) ? full : null;
}

function origin(c: Context): string {
  const proto = c.req.header('x-forwarded-proto')?.split(',')[0].trim() ?? new URL(c.req.url).protocol.replace(':', '');
  const host = c.req.header('x-forwarded-host')?.split(',')[0].trim() ?? c.req.header('host') ?? new URL(c.req.url).host;
  return `${proto}://${host}`;
}

async function signedUrl(c: Context, bucket: string, key: string, expiresIn: number): Promise<string> {
  const token = await signStorageToken(bucket, key, expiresIn);
  const encoded = key.split('/').map(encodeURIComponent).join('/');
  return `${origin(c)}/storage/v1/object/signed/${bucket}/${encoded}?token=${token}`;
}

function expiry(value: unknown): number {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.min(Math.max(Math.floor(seconds), 60), 7 * 24 * 3600) : 3600;
}

export const storageRoutes = new Hono();

// ---- signing: POST /object/sign/:bucket (batch) and /object/sign/:bucket/<key...> ----
storageRoutes.post('/object/sign/:bucket', async c => {
  const user = await authenticate(c);
  if (!user) return fail(c, 401, 'Unauthorized');
  const bucket = c.req.param('bucket');
  const body = (await c.req.json().catch(() => ({}))) as { expiresIn?: unknown; paths?: unknown };
  const paths = Array.isArray(body.paths) ? body.paths.filter((p): p is string => typeof p === 'string') : [];
  if (paths.length === 0 || paths.length > 200 || !BUCKET_RE.test(bucket)) return fail(c, 400, 'Invalid request');

  const visible = await withRole('authenticated', { sub: user.id, email: user.email }, async client => {
    const { rows } = await client.query('SELECT name FROM storage.objects WHERE bucket_id = $1 AND name = ANY($2)', [bucket, paths]);
    return new Set<string>(rows.map(row => row.name));
  });
  const seconds = expiry(body.expiresIn);
  const result = await Promise.all(paths.map(async p => visible.has(p)
    ? { error: null, path: p, signedURL: await signedUrl(c, bucket, p, seconds) }
    : { error: 'Object not found', path: p, signedURL: null }));
  return c.json(result);
});

storageRoutes.post('/object/sign/:bucket/*', async c => {
  const user = await authenticate(c);
  if (!user) return fail(c, 401, 'Unauthorized');
  const bucket = c.req.param('bucket');
  const key = decodeURIComponent(c.req.path.split('/').slice(6).join('/'));
  const body = (await c.req.json().catch(() => ({}))) as { expiresIn?: unknown };
  if (!filePath(bucket, key)) return fail(c, 400, 'Invalid object path');

  const found = await withRole('authenticated', { sub: user.id, email: user.email }, async client => {
    const { rowCount } = await client.query('SELECT 1 FROM storage.objects WHERE bucket_id = $1 AND name = $2', [bucket, key]);
    return Boolean(rowCount);
  });
  if (!found) return fail(c, 404, 'Object not found');
  return c.json({ signedURL: await signedUrl(c, bucket, key, expiry(body.expiresIn)) });
});

// ---- upload: POST /object/:bucket/<key...> (raw body); registered after /object/sign so "sign" is never read as a bucket ----
storageRoutes.post('/object/:bucket/*', async c => {
  const user = await authenticate(c);
  if (!user) return fail(c, 401, 'Unauthorized');

  const bucket = c.req.param('bucket');
  const key = decodeURIComponent(c.req.path.split('/').slice(5).join('/'));
  const target = filePath(bucket, key);
  if (!target) return fail(c, 400, 'Invalid object path');

  const { rows } = await pool.query('SELECT file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = $1', [bucket]);
  const meta = rows[0];
  if (!meta) return fail(c, 404, 'Bucket not found');

  const contentType = (c.req.header('content-type') ?? 'application/octet-stream').split(';')[0].trim().toLowerCase();
  if (meta.allowed_mime_types && !meta.allowed_mime_types.includes(contentType)) {
    return fail(c, 400, `MIME type ${contentType} is not supported`);
  }
  const limit = Number(meta.file_size_limit ?? 52428800);
  const declared = Number(c.req.header('content-length') ?? 0);
  if (declared > limit) return fail(c, 413, 'The object exceeded the maximum allowed size');
  if (!c.req.raw.body) return fail(c, 400, 'Empty body');

  const temp = `${target}.${process.pid}.${Date.now()}.part`;
  try {
    await mkdir(path.dirname(target), { recursive: true });
    let size = 0;
    const counter = new Transform({
      transform(chunk, _enc, done) {
        size += chunk.length;
        if (size > limit) done(new Error('too_large'));
        else done(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(c.req.raw.body as never), counter, fs.createWriteStream(temp));

    await withRole('authenticated', { sub: user.id, email: user.email }, async client => {
      // RLS (support_assets_insert_support_admin) decides whether the caller may upload.
      await client.query(
        `INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES ($1, $2, $3, $4)`,
        [bucket, key, user.id, JSON.stringify({ mimetype: contentType, size })],
      );
    });
    await rename(temp, target);
    return c.json({ Key: `${bucket}/${key}`, Id: key });
  } catch (error) {
    await rm(temp, { force: true });
    if ((error as Error).message === 'too_large') return fail(c, 413, 'The object exceeded the maximum allowed size');
    const db = toDbError(error);
    if (db.code === '23505') return fail(c, 409, 'The resource already exists');
    if (db.code === '42501') return fail(c, 403, 'new row violates row-level security policy');
    console.error('[storage] upload failed:', db.message);
    return fail(c, 500, 'Upload failed');
  }
});

// ---- download: GET /object/signed/:bucket/<key...>?token=  (the token is the authorization) ----
storageRoutes.get('/object/signed/:bucket/*', async c => {
  const bucket = c.req.param('bucket');
  const key = decodeURIComponent(c.req.path.split('/').slice(6).join('/'));
  const payload = await verifyToken(c.req.query('token') ?? '', 'storage');
  if (!payload || payload.bucket !== bucket || payload.path !== key) return fail(c, 401, 'Invalid or expired token');

  const target = filePath(bucket, key);
  if (!target) return fail(c, 400, 'Invalid object path');
  const { rows } = await pool.query('SELECT metadata FROM storage.objects WHERE bucket_id = $1 AND name = $2', [bucket, key]);
  if (!rows[0]) return fail(c, 404, 'Object not found');

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(target);
  } catch {
    return fail(c, 404, 'Object not found');
  }

  const type = rows[0].metadata?.mimetype ?? 'application/octet-stream';
  const headers: Record<string, string> = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
    // Uploaded files are rendered inline for preview but never executed as pages.
    'Content-Security-Policy': "default-src 'none'; sandbox",
  };

  const range = /^bytes=(\d*)-(\d*)$/.exec(c.req.header('range') ?? '');
  let start = 0;
  let end = stat.size - 1;
  let status: 200 | 206 = 200;
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(Number(range[2]), end);
    } else {
      start = Math.max(stat.size - Number(range[2]), 0);
    }
    if (start > end || start >= stat.size) {
      return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${stat.size}` } });
    }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
  }
  headers['Content-Length'] = String(end - start + 1);
  const stream = Readable.toWeb(fs.createReadStream(target, { start, end })) as ReadableStream;
  return new Response(c.req.method === 'HEAD' ? null : stream, { status, headers });
});

// ---- delete: DELETE /object/:bucket  { prefixes: [...] } ----
storageRoutes.delete('/object/:bucket', async c => {
  const user = await authenticate(c);
  if (!user) return fail(c, 401, 'Unauthorized');
  const bucket = c.req.param('bucket');
  const body = (await c.req.json().catch(() => ({}))) as { prefixes?: unknown };
  const prefixes = Array.isArray(body.prefixes) ? body.prefixes.filter((p): p is string => typeof p === 'string') : [];
  if (prefixes.length === 0 || !BUCKET_RE.test(bucket)) return fail(c, 400, 'Invalid request');

  try {
    // RLS (support_assets_delete_admin_only) limits this to rows the caller may delete.
    const removed = await withRole('authenticated', { sub: user.id, email: user.email }, async client => {
      const { rows } = await client.query(
        'DELETE FROM storage.objects WHERE bucket_id = $1 AND name = ANY($2) RETURNING name',
        [bucket, prefixes],
      );
      return rows.map(row => row.name as string);
    });
    await Promise.all(removed.map(async name => {
      const target = filePath(bucket, name);
      if (target) await rm(target, { force: true });
    }));
    return c.json(removed.map(name => ({ name, bucket_id: bucket })));
  } catch (error) {
    const db = toDbError(error);
    console.error('[storage] delete failed:', db.message);
    return fail(c, db.code === '42501' ? 403 : 500, 'Delete failed');
  }
});
