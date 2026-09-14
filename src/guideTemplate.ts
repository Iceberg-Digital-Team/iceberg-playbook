import type { GuideContent } from './data';
// Combine legacy prerequisites for presentation only. Historical snapshots stay untouched.
export function guideChecklist(guide: Pick<GuideContent, 'beforeYouStart' | 'requirements'>): string[] {
  return [...new Set([...guide.beforeYouStart, ...guide.requirements].map(s => s.trim()).filter(Boolean))];
}
export function safeMediaUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try { const parsed = new URL(url); return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : undefined; } catch { return undefined; }
}
export function videoEmbed(url: string): string | undefined {
  const safe = safeMediaUrl(url); if (!safe) return undefined;
  const parsed = new URL(safe); let id: string | null = null;
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(parsed.hostname)) id = parsed.searchParams.get('v') || parsed.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1] || null;
  if (parsed.hostname === 'youtu.be') id = parsed.pathname.slice(1);
  if (id && /^[\w-]{11}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}`;
  if (['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(parsed.hostname)) { const vimeo = parsed.pathname.match(/(?:video\/)?(\d+)$/)?.[1]; if (vimeo) return `https://player.vimeo.com/video/${vimeo}`; }
  return undefined;
}
