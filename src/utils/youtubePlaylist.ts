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
  continuationToken: string | null;
  clientVersion: string;
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
  if (typeof value?.text === 'string') return value.text;
  return '';
}

function lastThumbnail(value: any): string {
  const thumbnails = value?.thumbnails;
  return Array.isArray(thumbnails) ? String(thumbnails.at(-1)?.url || '') : '';
}

function parseDuration(value: unknown): number {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
}

function parseEntries(data: unknown): YouTubePlaylistEntry[] {
  const entries: YouTubePlaylistEntry[] = [];
  const seen = new Set<string>();
  for (const renderer of collectObjects(data, 'playlistVideoRenderer')) {
    const videoId = String(renderer.videoId || '');
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId) || seen.has(videoId)) continue;
    seen.add(videoId);
    entries.push({
      videoId,
      title: textValue(renderer.title).trim() || 'Unavailable video',
      channel: textValue(renderer.shortBylineText || renderer.ownerText).trim() || 'YouTube',
      duration: parseDuration(renderer.lengthSeconds),
      image: lastThumbnail(renderer.thumbnail),
      playable: renderer.isPlayable !== false,
    });
  }
  for (const lockup of collectObjects(data, 'lockupViewModel')) {
    if (!String(lockup.contentType || '').includes('VIDEO')) continue;
    const videoId = String(lockup.contentId || '');
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId) || seen.has(videoId)) continue;
    seen.add(videoId);
    const metadata = lockup.metadata?.lockupMetadataViewModel;
    const row = metadata?.metadata?.contentMetadataViewModel?.metadataRows?.[0];
    entries.push({
      videoId,
      title: textValue(metadata?.title).trim() || 'Unavailable video',
      channel: textValue(row?.metadataParts?.[0]?.text).trim() || 'YouTube',
      duration: 0,
      image: lastThumbnail(lockup.contentImage?.thumbnailViewModel?.image),
      playable: true,
    });
  }
  return entries;
}

function getContinuationToken(data: unknown): string | null {
  const commands = collectObjects(data, 'continuationCommand');
  for (const command of commands) {
    if (typeof command.token === 'string' && command.token) return command.token;
  }
  const next = collectObjects(data, 'nextContinuationData');
  for (const item of next) {
    if (typeof item.continuation === 'string' && item.continuation) return item.continuation;
  }
  return null;
}

/** Parses the public playlist page's best-effort, undocumented initial data. */
export function parseYouTubePlaylistPage(html: string): ParsedYouTubePlaylistPage | null {
  const data = extractJsonAfterMarker(html, 'ytInitialData');
  if (!data || collectObjects(data, 'playlistVideoListRenderer').length === 0) return null;
  const entries = parseEntries(data);
  if (entries.length === 0) return null;
  const metadata = collectObjects(data, 'playlistMetadataRenderer')[0];
  const primary = collectObjects(data, 'playlistSidebarPrimaryInfoRenderer')[0];
  const clientVersion = html.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/)?.[1] || '';
  return {
    title: String(metadata?.title || textValue(primary?.title) || 'YouTube Playlist'),
    image: lastThumbnail(primary?.thumbnailRenderer?.playlistVideoThumbnailRenderer?.thumbnail),
    entries,
    sourceEntriesReceived: entries.length,
    continuationToken: getContinuationToken(data),
    clientVersion,
  };
}

/** Parses one public continuation response. No credentials or API key are used. */
export function parseYouTubePlaylistContinuation(payload: unknown): {
  entries: YouTubePlaylistEntry[];
  continuationToken: string | null;
} {
  return {
    entries: parseEntries(payload),
    continuationToken: getContinuationToken(payload),
  };
}
