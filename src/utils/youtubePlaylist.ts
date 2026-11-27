export interface YouTubePlaylistEntry {
  videoId: string;
  title: string;
  channel: string;
  duration: number;
  image: string;
  playable: boolean;
}

export interface ParsedYouTubePlaylistPage {
  title: string;
  image: string;
  entries: YouTubePlaylistEntry[];
  sourceEntriesReceived: number;
  hasContinuation: boolean;
}

function extractJsonAfterMarker(html: string, marker: string): unknown | null {
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = html.indexOf('{', markerIndex + marker.length);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const char = html[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(html.slice(start, index + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function collectObjects(root: unknown, key: string, out: Record<string, any>[] = []): Record<string, any>[] {
  if (!root || typeof root !== 'object') return out;
  if (Array.isArray(root)) {
    for (const item of root) collectObjects(item, key, out);
    return out;
  }
  const record = root as Record<string, unknown>;
  const candidate = record[key];
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) out.push(candidate as Record<string, any>);
  for (const value of Object.values(record)) collectObjects(value, key, out);
  return out;
}

function textValue(value: any): string {
  if (typeof value?.simpleText === 'string') return value.simpleText;
  if (Array.isArray(value?.runs)) return value.runs.map((run: any) => String(run?.text || '')).join('');
  if (typeof value?.content === 'string') return value.content;
  return '';
}

function lastThumbnail(value: any): string {
  const thumbnails = value?.thumbnails;
  return Array.isArray(thumbnails) ? String(thumbnails.at(-1)?.url || '') : '';
}

/** Parses the public playlist page's best-effort, undocumented initial data. */
export function parseYouTubePlaylistPage(html: string): ParsedYouTubePlaylistPage | null {
  const data = extractJsonAfterMarker(html, 'ytInitialData');
  if (!data) return null;
  const lists = collectObjects(data, 'playlistVideoListRenderer');
  if (lists.length === 0) return null;

  const entries: YouTubePlaylistEntry[] = [];
  const seen = new Set<string>();
  let hasContinuation = false;
  for (const list of lists) {
    for (const content of Array.isArray(list.contents) ? list.contents : []) {
      const old = content?.playlistVideoRenderer;
      if (old) {
        const videoId = String(old.videoId || '');
        if (videoId && !seen.has(videoId)) {
          seen.add(videoId);
          entries.push({
            videoId,
            title: textValue(old.title).trim() || 'Unavailable video',
            channel: textValue(old.shortBylineText || old.ownerText).trim() || 'YouTube',
            duration: Number(old.lengthSeconds) > 0 ? Math.floor(Number(old.lengthSeconds)) : 0,
            image: lastThumbnail(old.thumbnail),
            playable: old.isPlayable !== false,
          });
        }
      }
      if (content?.continuationItemRenderer) hasContinuation = true;
    }
  }

  // Newer YouTube playlist pages use lockupViewModel instead of playlistVideoRenderer.
  const lockups = collectObjects(lists, 'lockupViewModel');
  for (const lockup of lockups) {
    if (!String(lockup.contentType || '').includes('VIDEO')) continue;
    const videoId = String(lockup.contentId || '');
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId) || seen.has(videoId)) continue;
    seen.add(videoId);
    const metadata = lockup.metadata?.lockupMetadataViewModel;
    const image = lastThumbnail(lockup.contentImage?.thumbnailViewModel?.image);
    entries.push({
      videoId,
      title: textValue(metadata?.title).trim() || 'Unavailable video',
      channel: textValue(metadata?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text).trim() || 'YouTube',
      duration: 0,
      image,
      playable: true,
    });
  }
  if (entries.length === 0) return null;

  const metadata = collectObjects(data, 'playlistMetadataRenderer')[0];
  const primary = collectObjects(data, 'playlistSidebarPrimaryInfoRenderer')[0];
  const title = String(metadata?.title || textValue(primary?.title) || 'YouTube Playlist');
  const image = lastThumbnail(primary?.thumbnailRenderer?.playlistVideoThumbnailRenderer?.thumbnail);
  hasContinuation ||= collectObjects(data, 'continuationItemRenderer').length > 0;
  return { title, image, entries, sourceEntriesReceived: entries.length, hasContinuation };
}
