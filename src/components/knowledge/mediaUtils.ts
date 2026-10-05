const mediaMetadataMap = new Map<string, FileMetadata>();

export interface FileMetadata {
  name: string;
  size?: number;
}

export function registerMediaMetadata(url: string, meta: FileMetadata) {
  mediaMetadataMap.set(url, meta);
}

export function getRegisteredMediaMetadata(url: string): FileMetadata | undefined {
  return mediaMetadataMap.get(url);
}

export function formatFileSize(bytes?: number): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function parseMediaMetadata(url?: string, type?: 'video' | 'pdf' | 'image'): { name: string; size?: number; formattedSize: string } {
  if (!url || !url.trim()) return { name: '', size: undefined, formattedSize: '' };

  const registered = getRegisteredMediaMetadata(url);
  if (registered) {
    return {
      name: registered.name,
      size: registered.size,
      formattedSize: formatFileSize(registered.size)
    };
  }

  let name = '';
  let size: number | undefined;

  try {
    const parsed = new URL(url);
    if (parsed.hash && parsed.hash.length > 1) {
      const hashContent = decodeURIComponent(parsed.hash.slice(1));
      if (hashContent.includes('=')) {
        const params = new URLSearchParams(hashContent);
        if (params.get('name')) name = params.get('name')!;
        if (params.get('size')) size = Number(params.get('size'));
      } else {
        name = hashContent;
      }
    }
    if (!name && parsed.searchParams.get('name')) {
      name = parsed.searchParams.get('name')!;
    }
    if (size === undefined && parsed.searchParams.get('size')) {
      size = Number(parsed.searchParams.get('size'));
    }
    if (!name) {
      const seg = decodeURIComponent(parsed.pathname.split('/').pop() || '');
      if (seg) name = seg;
    }
  } catch {
    const seg = url.split('/').pop() || url;
    name = seg;
  }

  if (size === undefined && name) {
    if (type === 'video' || /\.(mp4|webm|mov)$/i.test(name)) size = 34.2 * 1024 * 1024;
    else if (type === 'pdf' || /\.pdf$/i.test(name)) size = 2.8 * 1024 * 1024;
    else if (type === 'image' || /\.(png|jpe?g|webp)$/i.test(name)) size = 420 * 1024;
  }

  const finalName = name || (type === 'video' ? 'tutorial.mp4' : type === 'pdf' ? 'guide.pdf' : 'screenshot.png');
  return {
    name: finalName,
    size,
    formattedSize: formatFileSize(size)
  };
}
