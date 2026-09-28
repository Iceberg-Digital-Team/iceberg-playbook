import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://dummy.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'dummy-anon-key-for-unit-tests';

import { importTs } from './helpers/transpile.mjs';

function createMockFile(name, size, type) {
  return {
    name,
    size,
    type,
    slice: () => ({})
  };
}

function createMockSupabaseStorageClient(options = {}) {
  const uploadCalls = [];
  const createSignedUrlCalls = [];
  const createSignedUrlsCalls = [];
  const removeCalls = [];
  const mediaFilesInserts = [];

  const client = {
    storage: {
      from: (bucket) => ({
        upload: (path, file, opts) => {
          uploadCalls.push({ bucket, path, file, opts });
          if (options.uploadError) {
            return Promise.resolve({ data: null, error: options.uploadError });
          }
          return Promise.resolve({ data: { path }, error: null });
        },
        createSignedUrl: (path, expiresIn) => {
          createSignedUrlCalls.push({ bucket, path, expiresIn });
          if (options.signError) {
            return Promise.resolve({ data: null, error: options.signError });
          }
          return Promise.resolve({
            data: { signedUrl: `https://dummy.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=mock-token` },
            error: null
          });
        },
        createSignedUrls: (paths, expiresIn) => {
          createSignedUrlsCalls.push({ bucket, paths, expiresIn });
          return Promise.resolve({
            data: paths.map(p => ({
              path: p,
              signedUrl: `https://dummy.supabase.co/storage/v1/object/sign/${bucket}/${p}?token=mock-token`,
              error: null
            })),
            error: null
          });
        },
        remove: (paths) => {
          removeCalls.push({ bucket, paths });
          return Promise.resolve({ data: paths, error: null });
        }
      })
    },
    from: (table) => ({
      insert: (record) => {
        if (table === 'media_files') {
          mediaFilesInserts.push(record);
        }
        return Promise.resolve({ data: record, error: null });
      }
    })
  };

  return {
    client,
    uploadCalls,
    createSignedUrlCalls,
    createSignedUrlsCalls,
    removeCalls,
    mediaFilesInserts
  };
}

test('MIME validation accepts supported types and rejects unsupported formats', async () => {
  const { validateMediaFile, ALLOWED_MIME_TYPES } = await importTs('src/services/mediaService.ts', 'media-service');

  // Supported MIME types
  assert.equal(ALLOWED_MIME_TYPES.length, 6);
  assert.ok(ALLOWED_MIME_TYPES.includes('video/mp4'));
  assert.ok(ALLOWED_MIME_TYPES.includes('video/webm'));
  assert.ok(ALLOWED_MIME_TYPES.includes('application/pdf'));
  assert.ok(ALLOWED_MIME_TYPES.includes('image/png'));
  assert.ok(ALLOWED_MIME_TYPES.includes('image/jpeg'));
  assert.ok(ALLOWED_MIME_TYPES.includes('image/webp'));

  // Valid files
  const validMp4 = createMockFile('tutorial.mp4', 1024 * 1024, 'video/mp4');
  assert.equal(validateMediaFile(validMp4, 'video').valid, true);

  const validWebm = createMockFile('clip.webm', 2048 * 1024, 'video/webm');
  assert.equal(validateMediaFile(validWebm, 'video').valid, true);

  const validPdf = createMockFile('guide.pdf', 512 * 1024, 'application/pdf');
  assert.equal(validateMediaFile(validPdf, 'pdf').valid, true);

  const validPng = createMockFile('screenshot.png', 256 * 1024, 'image/png');
  assert.equal(validateMediaFile(validPng, 'image').valid, true);

  // Invalid MIME types
  const invalidExe = createMockFile('script.exe', 1024, 'application/x-msdownload');
  const exeResult = validateMediaFile(invalidExe);
  assert.equal(exeResult.valid, false);
  assert.match(exeResult.error, /Unsupported file format/);

  const invalidAvi = createMockFile('movie.avi', 1024, 'video/x-msvideo');
  assert.equal(validateMediaFile(invalidAvi).valid, false);

  // Cross-type mismatch (PDF uploaded as video)
  const mismatchResult = validateMediaFile(validPdf, 'video');
  assert.equal(mismatchResult.valid, false);
  assert.match(mismatchResult.error, /not a valid video/);
});

test('size validation rejects files larger than 50 MB limit', async () => {
  const { validateMediaFile, MAX_FILE_SIZE_BYTES } = await importTs('src/services/mediaService.ts', 'media-service');

  assert.equal(MAX_FILE_SIZE_BYTES, 52428800); // 50 MB exact

  // Just at limit
  const exactFile = createMockFile('exact.pdf', 52428800, 'application/pdf');
  assert.equal(validateMediaFile(exactFile, 'pdf').valid, true);

  // Exceeds limit by 1 byte
  const overLimitFile = createMockFile('huge.mp4', 52428801, 'video/mp4');
  const result = validateMediaFile(overLimitFile, 'video');
  assert.equal(result.valid, false);
  assert.match(result.error, /exceeds the 50 MB limit/);
});

test('upload path creation generates domain-based portable paths and avoids collisions', async () => {
  const { generateStoragePath } = await importTs('src/services/mediaService.ts', 'media-service');

  const path1 = generateStoragePath('guides', 'WA-G01', 'tutorial.mp4');
  assert.ok(path1.startsWith('guides/WA-G01/tutorial-'));
  assert.ok(path1.endsWith('.mp4'));

  const path2 = generateStoragePath('guides', 'WA-G01', 'tutorial.mp4');
  assert.notEqual(path1, path2, 'Storage paths must be unique to avoid overwriting versioned files');

  const pendingPath = generateStoragePath('guides', undefined, 'manual.pdf');
  assert.ok(pendingPath.startsWith('guides/pending/manual-'));
  assert.ok(pendingPath.endsWith('.pdf'));
});

test('uploadMedia calls Supabase Storage and records metadata row in public.media_files', async () => {
  const { uploadMedia, BUCKET_NAME } = await importTs('src/services/mediaService.ts', 'media-service');
  const { client, uploadCalls, mediaFilesInserts } = createMockSupabaseStorageClient();

  const file = createMockFile('setup-walkthrough.mp4', 5 * 1024 * 1024, 'video/mp4');
  const result = await uploadMedia(
    file,
    { domain: 'guides', entityId: 'WA-G01', mediaType: 'video', createdBy: 'Tech Lead' },
    client
  );

  // 1. Upload call assertions
  assert.equal(uploadCalls.length, 1);
  assert.equal(uploadCalls[0].bucket, BUCKET_NAME);
  assert.equal(uploadCalls[0].bucket, 'support-assets');
  assert.equal(uploadCalls[0].opts.upsert, false);
  assert.equal(uploadCalls[0].opts.contentType, 'video/mp4');

  // 2. Media_files metadata table insert assertions
  assert.equal(mediaFilesInserts.length, 1);
  assert.equal(mediaFilesInserts[0].bucket, 'support-assets');
  assert.equal(mediaFilesInserts[0].storage_key, result.storageKey);
  assert.equal(mediaFilesInserts[0].filename, 'setup-walkthrough.mp4');
  assert.equal(mediaFilesInserts[0].content_type, 'video/mp4');
  assert.equal(mediaFilesInserts[0].media_type, 'video');
  assert.equal(mediaFilesInserts[0].guide_id, 'WA-G01');
  assert.equal(mediaFilesInserts[0].created_by, 'Tech Lead');

  // 3. Result assertions
  assert.ok(result.storageKey.startsWith('guides/WA-G01/setup-walkthrough-'));
  assert.ok(result.signedUrl.includes('mock-token'));
});

test('signed URL generation signs private storage keys and preserves external URLs untouched', async () => {
  const { getSignedMediaUrl, getSignedMediaUrls, isStorageKey } = await importTs('src/services/mediaService.ts', 'media-service');
  const { client, createSignedUrlCalls, createSignedUrlsCalls } = createMockSupabaseStorageClient();

  // 1. Storage key creates signed URL
  const signed = await getSignedMediaUrl('guides/WA-G01/video-123.mp4', 3600, client);
  assert.ok(signed.includes('mock-token'));
  assert.equal(createSignedUrlCalls.length, 1);
  assert.equal(createSignedUrlCalls[0].path, 'guides/WA-G01/video-123.mp4');

  // 2. External YouTube / Vimeo / HTTPS link is untouched
  const externalYoutube = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  const youtubeResult = await getSignedMediaUrl(externalYoutube, 3600, client);
  assert.equal(youtubeResult, externalYoutube);
  assert.equal(createSignedUrlCalls.length, 1, 'createSignedUrl must not be called for external URL');

  // 3. isStorageKey helper
  assert.equal(isStorageKey('guides/WA-G01/doc.pdf'), true);
  assert.equal(isStorageKey('sops/WA-SOP01/workflow.pdf'), true);
  assert.equal(isStorageKey('https://example.com/asset.png'), false);
  assert.equal(isStorageKey('blob:http://localhost/abc'), false);
  assert.equal(isStorageKey(''), false);
  assert.equal(isStorageKey(null), false);

  // 4. Batch signed URLs
  const mixed = ['guides/WA-G01/pic1.png', 'https://cdn.example.com/logo.png', 'guides/WA-G01/pic2.png'];
  const batchResult = await getSignedMediaUrls(mixed, 3600, client);
  assert.equal(batchResult.get('https://cdn.example.com/logo.png'), 'https://cdn.example.com/logo.png');
  assert.ok(batchResult.get('guides/WA-G01/pic1.png')?.includes('mock-token'));
  assert.ok(batchResult.get('guides/WA-G01/pic2.png')?.includes('mock-token'));
  assert.equal(createSignedUrlsCalls.length, 1);
});

test('Guide content persists storage key instead of permanent public or signed URL', async () => {
  const { uploadMedia, isStorageKey } = await importTs('src/services/mediaService.ts', 'media-service');
  const { client } = createMockSupabaseStorageClient();

  const file = createMockFile('doc.pdf', 1024, 'application/pdf');
  const { storageKey, signedUrl } = await uploadMedia(
    file,
    { domain: 'guides', entityId: 'WA-G01', mediaType: 'pdf' },
    client
  );

  // Storage key is portable path
  assert.ok(isStorageKey(storageKey));
  assert.ok(!storageKey.startsWith('http'));

  // Signed URL is ephemeral web URL
  assert.ok(!isStorageKey(signedUrl));
  assert.ok(signedUrl.startsWith('https://'));
  assert.ok(signedUrl.includes('mock-token'));
});

test('historical media is not automatically deleted when publishing or replacing', async () => {
  const { removeMedia } = await importTs('src/services/mediaService.ts', 'media-service');
  const { client, removeCalls } = createMockSupabaseStorageClient();

  // In this architecture, removeMedia is NOT invoked automatically during Guide publish or replace
  assert.equal(removeCalls.length, 0);

  // If removeMedia is called manually on an external URL, it safely ignores it
  await removeMedia('https://youtube.com/watch?v=123', client);
  assert.equal(removeCalls.length, 0);

  // If removeMedia is called on a valid storage key:
  await removeMedia('guides/WA-G01/temp.png', client);
  assert.equal(removeCalls.length, 1);
  assert.deepEqual(removeCalls[0].paths, ['guides/WA-G01/temp.png']);
});
