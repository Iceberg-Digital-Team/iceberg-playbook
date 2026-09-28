import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as defaultSupabase } from '../lib/supabase';

export const BUCKET_NAME = 'support-assets';
export const MAX_FILE_SIZE_BYTES = 52428800; // 50 MB

export const ALLOWED_MIME_TYPES = [
  'video/mp4',
  'video/webm',
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp'
] as const;

export type SupportedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export interface UploadMediaOptions {
  domain: 'guides' | 'issues' | 'sops';
  entityId?: string;
  mediaType: 'video' | 'pdf' | 'image' | 'attachment';
  createdBy?: string;
}

export interface UploadMediaResult {
  storageKey: string;
  filename: string;
  contentType: string;
  fileSizeBytes: number;
  signedUrl: string;
}

export function isStorageKey(pathOrUrl?: string | null): boolean {
  if (!pathOrUrl || typeof pathOrUrl !== 'string') return false;
  const trimmed = pathOrUrl.trim();
  if (!trimmed) return false;
  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('data:')
  ) {
    return false;
  }
  return (
    trimmed.startsWith('guides/') ||
    trimmed.startsWith('issues/') ||
    trimmed.startsWith('sops/') ||
    trimmed.includes('/')
  );
}

export function resolveContentType(file: File): string {
  const mime = (file.type || '').toLowerCase();
  if (ALLOWED_MIME_TYPES.includes(mime as SupportedMimeType)) {
    return mime;
  }

  const ext = `.${file.name.split('.').pop()?.toLowerCase() || ''}`;
  switch (ext) {
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.pdf':
      return 'application/pdf';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    default:
      return mime;
  }
}

export function validateMediaFile(
  file: File,
  expectedType?: 'video' | 'pdf' | 'image' | 'attachment'
): { valid: boolean; error?: string; contentType?: string } {
  if (!file) {
    return { valid: false, error: 'No file provided.' };
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `File size exceeds the 50 MB limit (${mb} MB).`
    };
  }

  const contentType = resolveContentType(file);
  if (!ALLOWED_MIME_TYPES.includes(contentType as SupportedMimeType)) {
    return {
      valid: false,
      error: `Unsupported file format (${contentType || file.name}). Allowed: MP4, WebM, PDF, PNG, JPEG, WebP.`
    };
  }

  if (expectedType === 'video' && !contentType.startsWith('video/')) {
    return { valid: false, error: 'Selected file is not a valid video (MP4 or WebM).' };
  }
  if (expectedType === 'pdf' && contentType !== 'application/pdf') {
    return { valid: false, error: 'Selected file is not a valid PDF document.' };
  }
  if (expectedType === 'image' && !contentType.startsWith('image/')) {
    return { valid: false, error: 'Selected file is not a valid image (PNG, JPG, WebP).' };
  }

  return { valid: true, contentType };
}

export function generateStoragePath(
  domain: 'guides' | 'issues' | 'sops',
  entityId: string | undefined,
  filename: string
): string {
  const cleanDomain = domain || 'guides';
  const cleanEntityId = entityId?.trim() ? encodeURIComponent(entityId.trim()) : 'pending';
  const ext = filename.includes('.') ? `.${filename.split('.').pop()?.toLowerCase()}` : '';
  const baseName = filename
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 30);
  const uniqueToken = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  return `${cleanDomain}/${cleanEntityId}/${baseName}-${uniqueToken}${ext}`;
}

export async function uploadMedia(
  file: File,
  options: UploadMediaOptions,
  client: SupabaseClient = defaultSupabase
): Promise<UploadMediaResult> {
  const validation = validateMediaFile(file, options.mediaType);
  if (!validation.valid || !validation.contentType) {
    throw new Error(validation.error || 'Invalid file.');
  }

  const contentType = validation.contentType;
  const storageKey = generateStoragePath(options.domain, options.entityId, file.name);

  // 1. Upload to Supabase Storage bucket (support-assets)
  const { error: uploadError } = await client.storage
    .from(BUCKET_NAME)
    .upload(storageKey, file, {
      contentType,
      upsert: false
    });

  if (uploadError) {
    throw new Error(`Failed to upload file to storage: ${uploadError.message}`);
  }

  // 2. Insert metadata into public.media_files
  try {
    const isRealEntity = options.entityId && !options.entityId.startsWith('pending') && !options.entityId.startsWith('draft-');
    await client.from('media_files').insert({
      storage_key: storageKey,
      bucket: BUCKET_NAME,
      filename: file.name,
      content_type: contentType,
      file_size_bytes: file.size,
      media_type: options.mediaType,
      guide_id: options.domain === 'guides' && isRealEntity ? options.entityId : null,
      issue_id: options.domain === 'issues' && isRealEntity ? options.entityId : null,
      sop_id: options.domain === 'sops' && isRealEntity ? options.entityId : null,
      created_by: options.createdBy || 'Support Team'
    });
  } catch (metaErr) {
    // Non-fatal if media_files row creation warns; backend fn_create_guide will also link by key
    console.warn('Could not record media_files metadata:', metaErr);
  }

  // 3. Generate signed URL for immediate preview
  const signedUrl = await getSignedMediaUrl(storageKey, 3600, client);

  return {
    storageKey,
    filename: file.name,
    contentType,
    fileSizeBytes: file.size,
    signedUrl
  };
}

export async function getSignedMediaUrl(
  storageKeyOrUrl: string,
  expiresIn = 3600,
  client: SupabaseClient = defaultSupabase
): Promise<string> {
  const clean = storageKeyOrUrl?.trim();
  if (!clean) return '';
  if (!isStorageKey(clean)) {
    return clean;
  }

  const { data, error } = await client.storage
    .from(BUCKET_NAME)
    .createSignedUrl(clean, expiresIn);

  if (error || !data?.signedUrl) {
    throw new Error(`Failed to generate signed URL: ${error?.message || 'Unknown error'}`);
  }

  return data.signedUrl;
}

export async function getSignedMediaUrls(
  storageKeysOrUrls: string[],
  expiresIn = 3600,
  client: SupabaseClient = defaultSupabase
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const toFetch: string[] = [];

  for (const item of storageKeysOrUrls) {
    const clean = item?.trim();
    if (!clean) continue;
    if (!isStorageKey(clean)) {
      result.set(clean, clean);
    } else {
      toFetch.push(clean);
    }
  }

  if (toFetch.length === 0) return result;

  const { data, error } = await client.storage
    .from(BUCKET_NAME)
    .createSignedUrls(toFetch, expiresIn);

  if (!error && Array.isArray(data)) {
    for (const item of data) {
      if (!item.error && item.signedUrl && item.path) {
        result.set(item.path, item.signedUrl);
      }
    }
  }

  return result;
}

export async function removeMedia(
  storageKey: string,
  client: SupabaseClient = defaultSupabase
): Promise<void> {
  const clean = storageKey?.trim();
  if (!clean || !isStorageKey(clean)) return;

  const { error } = await client.storage
    .from(BUCKET_NAME)
    .remove([clean]);

  if (error) {
    throw new Error(`Failed to remove media: ${error.message}`);
  }
}
