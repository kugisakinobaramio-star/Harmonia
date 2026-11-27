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
      else if (char === '\\\\') escaped = true;
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

function findObject(root: unknown, key: string): Record<string, any> | null {
  if (!root || typeof root !== 'object') return null;
  if (Array.isArray(root)) {
    for (const item of root) {
      const found = findObject(item, key);
      if (found) return found;
    }
    return null;
  }
  const record = root as Record<string, unknown>;
  const candidate = record[key];
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    return candidate as Record<string, any>;
  }
  for (const value of Object.values(record)) {
    const found = findObject(value, key);
    if (found) return found;
  }
  return null;
}

function textValue(value: any): string {
  if (typeof value?.simpleText === 'string') return value.simpleText;
  if (Array.isArray(value?.runs)) return value.runs.map((run: any) => String(run?.text || '')).join('');
  return '';
}

function parseDuration(value: unknown): number {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return Math.floor(seconds);
  return 0;
}

export function parseYouTubePlaylistPage(html: string): ParsedYouTubePlaylistPage | null {
  const data = extractJsonAfterMarker(html, 'ytInitialData');
  if (!data) return null;
  const list = findObject(data, 'playlistVideoListRenderer');
  if (!list || !Array.isArray(list.contents)) return null;

  const entries: YouTubePlaylistEntry[] = [];
  let hasContinuation = false;
  for (const content of list.contents) {
    const renderer = content?.playlistVideoRenderer;
    if (renderer) {
      const videoId = String(renderer.videoId || '');
      const title = textValue(renderer.title).trim();
      const channel = textValue(renderer.shortBylineText || renderer.ownerText).trim() || 'YouTube';
      const duration = parseDuration(renderer.lengthSeconds);
      const image = Array.isArray(renderer.thumbnail?.thumbnails)
        ? String(renderer.thumbnail.thumbnails.at(-1)?.url || '')
        : '';
      if (videoId || title) {
        entries.push({ videoId, title: title || (videoId ? 'Unavailable video' : 'Untitled video'), channel, duration, image, playable: renderer.isPlayable !== false });
      }
    }
    if (content?.continuationItemRenderer) hasContinuation = true;
  }

  const metadata = findObject(data, 'playlistMetadataRenderer');
  const primary = findObject(data, 'playlistSidebarPrimaryInfoRenderer');
  const thumbnail = primary?.thumbnailRenderer?.playlistVideoThumbnailRenderer?.thumbnail?.thumbnails;
  const image = Array.isArray(thumbnail) ? String(thumbnail.at(-1)?.url || '') : '';
  const title = String(metadata?.title || textValue(primary?.title) || 'YouTube Playlist');
  if (entries.length === 0) return null;
  return { title, image, entries, sourceEntriesReceived: entries.length, hasContinuation };
}
