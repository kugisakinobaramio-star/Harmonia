import express from 'express';
import path from 'node:path';
import { Readable } from 'node:stream';
import { isIP } from 'node:net';
import { isPublicAddress } from './src/utils/networkSecurity.ts';
import { fileURLToPath } from 'node:url';
import {
  isPlausibleSongDuration,
  isRemixOrKnockoff,
  scoreAuthenticTrackCandidate,
} from './src/utils/playerEngine.ts';

const SAAVN_BASE = 'https://saavn.sumit.co';

interface StoredLyricLine {
  time: number;
  text: string;
}

interface StoredTrack {
  id: string;
  name: string;
  artist: string;
  albumName: string;
  year?: string;
  duration: number;
  playCount?: number;
  image: string;
  language?: string;
  region?: string;
  genre?: string;
  hasLyrics?: boolean;
  metadataOnly?: boolean;
  previewUrl?: string;
  streamUrls?: Record<string, string>;
  lyrics?: StoredLyricLine[];
}

// Only public HTTPS destinations may be fetched through user-controlled proxy URLs.
// Every redirect is revalidated to prevent redirect-based SSRF.
let cloudflareWorkerRuntime = false;

async function resolveWorkerDnsAddresses(host: string): Promise<Array<{ address: string }>> {
  // Workers does not implement dns.lookup(); resolve4/resolve6 use Cloudflare DNS-over-HTTPS.
  const dns = await import('node:dns/promises');
  const results = await Promise.allSettled([dns.resolve4(host), dns.resolve6(host)]);
  return results.flatMap((result) =>
    result.status === 'fulfilled' ? result.value.map((address) => ({ address })) : []
  );
}

async function validatePublicHttpsUrl(input: string): Promise<URL> {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Only public HTTPS URLs are allowed');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new Error('Local destinations are not allowed');
  }
  const addresses = isIP(host)
    ? [{ address: host }]
    : cloudflareWorkerRuntime
      ? await resolveWorkerDnsAddresses(host)
      : await (await import('node:dns/promises')).lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address))) {
    throw new Error('Non-public network destinations are not allowed');
  }
  return url;
}

async function fetchPublicHttpsUrl(
  input: string,
  timeoutMs = 8000,
  headers: Record<string, string> = {}
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let target = input;
    for (let redirects = 0; redirects <= 4; redirects += 1) {
      const url = await validatePublicHttpsUrl(target);
      const response = await fetch(url, {
        signal: controller.signal,
        headers,
        redirect: 'manual',
      });
      if (response.status < 300 || response.status >= 400) return response;
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirect without a location');
      target = new URL(location, url).toString();
    }
    throw new Error('Too many redirects');
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithTimeout(url: string, timeoutMs = 5000, headers: Record<string, string> = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        ...headers,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

// MusicBrainz is a metadata catalogue, not an audio host. Cache and pace
// requests to respect its public one-request-per-second guideline.
let musicBrainzQueue: Promise<void> = Promise.resolve();
let musicBrainzLastRequestAt = 0;
const musicBrainzCache = new Map<string, { expiresAt: number; value: any }>();

async function fetchMusicBrainzJson(url: string): Promise<any | null> {
  const cached = musicBrainzCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const request = musicBrainzQueue.then(async () => {
    const secondCache = musicBrainzCache.get(url);
    if (secondCache && secondCache.expiresAt > Date.now()) return secondCache.value;
    const waitMs = Math.max(0, 1100 - (Date.now() - musicBrainzLastRequestAt));
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    musicBrainzLastRequestAt = Date.now();
    const response = await fetchWithTimeout(url, 5000, {
      Accept: 'application/json',
      'User-Agent': 'Harmonia/1.0 (https://github.com/kugisakinobaramio-star/Harmonia)',
    });
    if (!response.ok) return null;
    const value = await response.json();
    musicBrainzCache.set(url, { expiresAt: Date.now() + 10 * 60_000, value });
    if (musicBrainzCache.size > 250) {
      for (const [key, entry] of musicBrainzCache) {
        if (entry.expiresAt <= Date.now()) musicBrainzCache.delete(key);
        if (musicBrainzCache.size <= 200) break;
      }
    }
    return value;
  });
  musicBrainzQueue = request.then(() => undefined, () => undefined);
  try { return await request; } catch { return null; }
}

interface MusicBrainzRecordingRaw {
  id?: string;
  title?: string;
  length?: number;
  'artist-credit'?: Array<string | { name?: string; artist?: { name?: string } }>;
  releases?: Array<{ title?: string; date?: string }>;
}

function mapMusicBrainzRecording(raw: MusicBrainzRecordingRaw): StoredTrack {
  const credits = (raw['artist-credit'] || [])
    .map((entry) => typeof entry === 'string' ? entry : entry.name || entry.artist?.name || '')
    .filter(Boolean);
  const release = raw.releases?.[0];
  return {
    id: 'mb-' + (raw.id || Math.random().toString(36).slice(2, 9)),
    name: raw.title || 'Untitled Recording',
    artist: credits.join(', ') || 'Unknown Artist',
    albumName: release?.title || 'Recording',
    year: release?.date?.slice(0, 4),
    duration: raw.length ? Math.round(raw.length / 1000) : 195,
    image: '',
    language: 'Other',
    region: 'GLOBAL',
    genre: 'MusicBrainz metadata',
    hasLyrics: true,
    metadataOnly: true,
  };
}

async function readResponseBodyWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) throw new Error('Remote response has no body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel('Response exceeded size limit').catch(() => {});
        throw new Error('Remote response exceeded size limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes);
}

// Simple LRU image buffer cache so album covers load instantaneously and never break
const imageCache = new Map<string, { buf: Buffer; contentType: string }>();
const MAX_IMAGE_CACHE_ENTRIES = 200;
const MAX_IMAGE_CACHE_BYTES = 32 * 1024 * 1024;
const MAX_REMOTE_IMAGE_BYTES = 8 * 1024 * 1024;
let imageCacheBytes = 0;

function cacheImage(key: string, buf: Buffer, contentType: string): void {
  const previous = imageCache.get(key);
  if (previous) {
    imageCacheBytes -= previous.buf.length;
    imageCache.delete(key);
  }
  while (
    imageCache.size >= MAX_IMAGE_CACHE_ENTRIES ||
    imageCacheBytes + buf.length > MAX_IMAGE_CACHE_BYTES
  ) {
    const oldestKey = imageCache.keys().next().value;
    if (!oldestKey) break;
    const oldest = imageCache.get(oldestKey);
    if (oldest) imageCacheBytes -= oldest.buf.length;
    imageCache.delete(oldestKey);
  }
  if (buf.length > MAX_IMAGE_CACHE_BYTES) return;
  imageCache.set(key, { buf, contentType });
  imageCacheBytes += buf.length;
}
const FALLBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
  <rect width="400" height="400" fill="#141416"/>
  <circle cx="200" cy="200" r="145" fill="#1c1c20" stroke="#2c2c32" stroke-width="2"/>
  <circle cx="200" cy="200" r="95" fill="none" stroke="#28282e" stroke-width="1.5"/>
  <circle cx="200" cy="200" r="42" fill="#1DB954" fill-opacity="0.18" stroke="#1DB954" stroke-opacity="0.55" stroke-width="2"/>
  <circle cx="200" cy="200" r="10" fill="#121212"/>
</svg>`;

function parseLrcText(lrc: string): StoredLyricLine[] {
  const out: StoredLyricLine[] = [];
  for (const raw of String(lrc || '').split('\n')) {
    const match = raw.match(/^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]\s*(.*)$/);
    if (!match) continue;
    const mins = Number(match[1]);
    const secs = Number(match[2]);
    const msPart = match[3] ? Number(match[3].padEnd(3, '0')) / 1000 : 0;
    const text = match[4].trim();
    if (!text) continue;
    out.push({ time: Math.round((mins * 60 + secs + msPart) * 10) / 10, text });
  }
  return out.sort((a, b) => a.time - b.time);
}

interface ParsedVideoItem {
  id: string;
  title: string;
  channel: string;
  dur: string;
}

function parseYouTubeSearchHtml(html: string, max = 12): ParsedVideoItem[] {
  const normalized = html
    .replace(/\\x22/g, '"')
    .replace(/\\x7b/g, '{')
    .replace(/\\x7d/g, '}')
    .replace(/\\x5b/g, '[')
    .replace(/\\x5d/g, ']')
    .replace(/\\u0026/g, '&')
    .replace(/\\x3d/g, '=');

  const chunks =
    normalized.split('"videoRenderer"').length > 1
      ? normalized.split('"videoRenderer"').slice(1)
      : normalized.split('"videoWithContextRenderer"').slice(1);

  const out: ParsedVideoItem[] = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    const idMatch = chunk.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
    if (!idMatch) continue;
    const id = idMatch[1];
    if (seen.has(id)) continue;
    seen.add(id);

    let title = `Music Video (${id})`;
    const titleMatch =
      chunk.match(/"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.){2,140})"/) ||
      chunk.match(/"headline":\{"runs":\[\{"text":"((?:[^"\\]|\\.){2,140})"/);
    if (titleMatch) {
      try {
        title = JSON.parse(`"${titleMatch[1]}"`);
      } catch {
        title = titleMatch[1];
      }
    }

    let channel = 'Official Channel';
    const chanMatch =
      chunk.match(/"ownerText":\{"runs":\[\{"text":"((?:[^"\\]|\\.){1,80})"/) ||
      chunk.match(/"shortBylineText":\{"runs":\[\{"text":"((?:[^"\\]|\\.){1,80})"/);
    if (chanMatch) {
      try {
        channel = JSON.parse(`"${chanMatch[1]}"`);
      } catch {
        channel = chanMatch[1];
      }
    }

    let dur = '';
    const durMatch =
      chunk.match(/"lengthText":\{"accessibility":\{[^}]+\},"simpleText":"([^"]{1,12})"/) ||
      chunk.match(/"lengthText":\{"runs":\[\{"text":"([^"]{1,12})"/);
    if (durMatch) dur = durMatch[1];

    out.push({ id, title, channel, dur });
    if (out.length >= max) break;
  }

  return out;
}

function isInstrumentalOrSpam(name: string, album = ''): boolean {
  const hay = `${name} ${album}`.toLowerCase();
  return [
    'instrumental',
    'karaoke',
    'off vocal',
    'no vocal',
    'type beat',
    'minus one',
    'white noise',
    'rain sound',
  ].some((p) => hay.includes(p));
}

function inferLanguage(text: string, hintLang?: string): 'Hindi' | 'Punjabi' | 'Haryanvi' | 'Marathi' | 'Bengali' | 'Tamil' | 'Telugu' | 'Kannada' | 'Malayalam' | 'Gujarati' | 'Bhojpuri' | 'Urdu' | 'English' | 'French' | 'Spanish' | 'Korean' | 'Japanese' | 'J-Pop' | 'Chinese' | 'Arabic' | 'Portuguese' | 'German' | 'Italian' | 'Turkish' | 'Thai' | 'Indonesian' | 'Other' {
  const supported = new Set(['Hindi', 'Punjabi', 'Haryanvi', 'Marathi', 'Bengali', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Gujarati', 'Bhojpuri', 'Urdu', 'English', 'French', 'Spanish', 'Korean', 'Japanese', 'J-Pop', 'Chinese', 'Arabic', 'Portuguese', 'German', 'Italian', 'Turkish', 'Thai', 'Indonesian']);
  if (hintLang && supported.has(hintLang)) return hintLang as ReturnType<typeof inferLanguage>;
  if (/[\u0a00-\u0a7f]/.test(text)) return 'Punjabi';
  if (/[\u0980-\u09ff]/.test(text)) return 'Bengali';
  if (/[\u0b80-\u0bff]/.test(text)) return 'Tamil';
  if (/[\u0c00-\u0c7f]/.test(text)) return 'Telugu';
  if (/[\u0c80-\u0cff]/.test(text)) return 'Kannada';
  if (/[\u0d00-\u0d7f]/.test(text)) return 'Malayalam';
  if (/[\u0a80-\u0aff]/.test(text)) return 'Gujarati';
  if (/[\u0600-\u06ff]/.test(text)) return 'Urdu';
  if (/[\u0900-\u097f]/.test(text)) return 'Hindi';
  if (/[\uac00-\ud7af]/.test(text)) return 'Korean';
  if (/[\u3040-\u30ff]/.test(text)) return 'Japanese';
  if (/[\u4e00-\u9fff]/.test(text)) return 'Chinese';
  const low = text.toLowerCase();
  if (/arijit|pritam|bollywood|hindi|shreya|jubin|atif|sonu|badshah|kesariya|sachin-jigar|afusic/.test(low)) return 'Hindi';
  if (/diljit|sidhu|punjabi|gurdas maan/.test(low)) return 'Punjabi';
  if (/haryanvi|masoom sharma|gulzaar chhaniwala/.test(low)) return 'Haryanvi';
  if (/marathi|ajay-atul/.test(low)) return 'Marathi';
  if (/yoasobi|kenshi|yonezu|fujii kaze|hige|ado|lisa|aimyon|radwimps|j-pop|tokyo/.test(low)) return 'J-Pop';
  return 'English';
}

interface ItunesTrackRaw {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  releaseDate?: string;
  trackTimeMillis?: number;
  artworkUrl100?: string;
  previewUrl?: string;
  primaryGenreName?: string;
}

function mapItunesTrack(raw: ItunesTrackRaw, region: string, hintLang?: string): StoredTrack {
  const highResArt = (raw.artworkUrl100 || '').replace('100x100bb', '300x300bb');
  const title = raw.trackName || 'Untitled Track';
  const artist = raw.artistName || 'Unknown Artist';
  const lang = inferLanguage(`${title} ${artist} ${raw.primaryGenreName || ''}`, hintLang);
  return {
    id: `itunes-${raw.trackId || Math.random().toString(36).slice(2, 9)}`,
    name: title,
    artist,
    albumName: raw.collectionName || 'Single',
    year: raw.releaseDate ? raw.releaseDate.slice(0, 4) : undefined,
    duration: raw.trackTimeMillis ? Math.round(raw.trackTimeMillis / 1000) : 195,
    image: highResArt,
    language: lang,
    region,
    genre: raw.primaryGenreName || lang,
    hasLyrics: !isInstrumentalOrSpam(title, raw.collectionName || ''),
    previewUrl: raw.previewUrl || undefined,
  };
}

interface DeezerTrackRaw {
  id?: number;
  title?: string;
  title_short?: string;
  duration?: number;
  rank?: number;
  preview?: string;
  artist?: { id?: number; name?: string; picture_medium?: string; picture_big?: string };
  album?: { id?: number; title?: string; cover_medium?: string; cover_big?: string };
}

function mapDeezerTrack(raw: DeezerTrackRaw, region: string, hintLang?: string): StoredTrack {
  const title = raw.title_short || raw.title || 'Untitled Track';
  const artist = raw.artist?.name || 'Unknown Artist';
  const albumName = raw.album?.title || 'Single';
  const lang = inferLanguage(`${title} ${artist} ${albumName}`, hintLang);
  const image =
    raw.album?.cover_big ||
    raw.album?.cover_medium ||
    raw.artist?.picture_big ||
    raw.artist?.picture_medium ||
    '';
  return {
    id: `dz-${raw.id || Math.random().toString(36).slice(2, 9)}`,
    name: title,
    artist,
    albumName,
    duration: raw.duration || 195,
    playCount: raw.rank || undefined,
    image,
    language: lang,
    region,
    genre: lang,
    hasLyrics: !isInstrumentalOrSpam(title, albumName),
    previewUrl: raw.preview || undefined,
  };
}

interface AudiusTrackRaw {
  id?: string;
  title?: string;
  duration?: number;
  play_count?: number;
  genre?: string;
  mood?: string;
  release_date?: string;
  artwork?: { '150x150'?: string; '480x480'?: string; '1000x1000'?: string };
  user?: { name?: string; handle?: string; is_verified?: boolean };
}

function mapAudiusTrack(raw: AudiusTrackRaw, region: string, hintLang?: string): StoredTrack {
  const title = raw.title || 'Untitled Track';
  const artist = raw.user?.name || raw.user?.handle || 'Independent Artist';
  const image =
    raw.artwork?.['480x480'] ||
    raw.artwork?.['1000x1000'] ||
    raw.artwork?.['150x150'] ||
    '';
  const streamUrl = raw.id
    ? `https://discoveryprovider.audius.co/v1/tracks/${encodeURIComponent(raw.id)}/stream`
    : '';
  const lang = inferLanguage(`${title} ${artist} ${raw.genre || ''}`, hintLang);
  return {
    id: `aud-${raw.id || Math.random().toString(36).slice(2, 9)}`,
    name: title,
    artist,
    albumName: raw.genre ? `${raw.genre} · Audius` : 'Audius Release',
    year: raw.release_date ? raw.release_date.slice(0, 4) : undefined,
    duration: raw.duration || 195,
    playCount: raw.play_count || undefined,
    image,
    language: lang,
    region,
    genre: raw.genre || lang,
    hasLyrics: !isInstrumentalOrSpam(title, raw.genre || ''),
    streamUrls: streamUrl ? { '160kbps': streamUrl } : undefined,
    previewUrl: streamUrl || undefined,
  };
}

function scoreAuthenticAudiusMatch(
  audItem: AudiusTrackRaw,
  requestedTitle: string,
  requestedArtist: string,
  targetDurationSec = 0
): number | null {
  if (!audItem.id || !audItem.title) return null;
  if ((audItem.duration || 0) < 75) return null;
  // Verification is a trust signal, not a matching requirement. Unverified uploads
  // remain eligible only when title, uploader/artist identity, and duration pass
  // the same strict authenticity scorer used for every other candidate.

  const audArtist = audItem.user?.name || audItem.user?.handle || '';
  return scoreAuthenticTrackCandidate({
    itemTitle: audItem.title,
    itemArtist: audArtist,
    requestedTitle,
    requestedArtist,
    itemDurationSec: audItem.duration || 0,
    targetDurationSec,
  });
}

const artworkLookupCache = new Map<string, string>();

async function lookupTrackArtwork(title: string, artist: string): Promise<string> {
  const cleanTitle = title.split('(')[0]?.split('-')[0]?.trim() || title;
  const primaryArtist = artist.split(',')[0]?.trim() || '';
  const key = `${cleanTitle.toLowerCase()}::${primaryArtist.toLowerCase()}`;
  const cached = artworkLookupCache.get(key);
  if (cached) return cached;

  const query = `${cleanTitle} ${primaryArtist}`.trim();
  if (!query) return '';

  const [dzSettled, itSettled, saavnSettled] = await Promise.allSettled([
    fetchWithTimeout(
      `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=1`,
      2200
    ).then((r) => (r.ok ? r.json() : null)),
    fetchWithTimeout(
      `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=1`,
      2200
    ).then((r) => (r.ok ? r.json() : null)),
    fetchWithTimeout(
      `${SAAVN_BASE}/api/search/songs?query=${encodeURIComponent(query)}&page=0&limit=1`,
      2200
    ).then((r) => (r.ok ? r.json() : null)),
  ]);

  let found = '';
  if (dzSettled.status === 'fulfilled' && dzSettled.value?.data?.[0]) {
    const d = dzSettled.value.data[0] as DeezerTrackRaw;
    found = d.album?.cover_big || d.album?.cover_medium || d.artist?.picture_medium || '';
  }
  if (!found && itSettled.status === 'fulfilled' && itSettled.value?.results?.[0]) {
    const it = itSettled.value.results[0] as ItunesTrackRaw;
    found = (it.artworkUrl100 || '').replace('100x100bb', '300x300bb');
  }
  if (!found && saavnSettled.status === 'fulfilled' && saavnSettled.value?.data?.results?.[0]?.image?.length) {
    const imgs = saavnSettled.value.data.results[0].image as Array<{ quality?: string; url?: string }>;
    const best = imgs.find((i) => i.quality === '500x500' && i.url) || imgs[imgs.length - 1];
    if (best?.url && !best.url.includes('artist-default') && !best.url.includes('/_i/3.0/')) {
      found = best.url;
    }
  }

  if (found) {
    if (artworkLookupCache.size >= 600) {
      const firstKey = artworkLookupCache.keys().next().value;
      if (firstKey) artworkLookupCache.delete(firstKey);
    }
    artworkLookupCache.set(key, found);
  }
  return found;
}

async function enrichSpotifyTracksArtwork(tracks: StoredTrack[]): Promise<StoredTrack[]> {
  const toEnrich = tracks.slice(0, 18);
  const rest = tracks.slice(18);
  const enriched = await Promise.all(
    toEnrich.map(async (track) => {
      const realCover = await lookupTrackArtwork(track.name, track.artist);
      return realCover ? { ...track, image: realCover } : track;
    })
  );
  return [...enriched, ...rest];
}

interface SaavnCandidateRaw {
  name?: string;
  duration?: number | string;
  artists?: { primary?: Array<{ name?: string }>; all?: Array<{ name?: string }> };
  downloadUrl?: Array<{ quality?: string; url?: string }>;
}

function scoreSaavnMatch(
  saavnItem: SaavnCandidateRaw,
  requestedTitle: string,
  requestedArtist: string,
  targetDurationSec = 0
): number | null {
  if (!saavnItem.downloadUrl?.length || !saavnItem.name) return null;
  // Strictly match ONLY primary artists (never artists.all, which knockoff covers credit as songwriters)
  const primaryArtists = (saavnItem.artists?.primary || [])
    .map((a) => (a.name || '').trim())
    .filter(Boolean)
    .join(', ');
  if (!primaryArtists) return null;

  return scoreAuthenticTrackCandidate({
    itemTitle: saavnItem.name,
    itemArtist: primaryArtists,
    requestedTitle,
    requestedArtist,
    itemDurationSec: Number(saavnItem.duration || 0),
    targetDurationSec,
  });
}

function parseSpotifyTarget(
  input: string
): { kind: 'track' | 'album' | 'playlist' | 'artist'; id: string } | null {
  const trimmed = String(input || '').trim();
  const urlMatch = trimmed.match(
    /open\.spotify\.com\/(?:intl-[a-z-]+\/)?(track|album|playlist|artist)\/([a-zA-Z0-9]+)/i
  );
  if (urlMatch) {
    return {
      kind: urlMatch[1].toLowerCase() as 'track' | 'album' | 'playlist' | 'artist',
      id: urlMatch[2],
    };
  }
  const uriMatch = trimmed.match(/^spotify:(track|album|playlist|artist):([a-zA-Z0-9]+)$/i);
  if (uriMatch) {
    return {
      kind: uriMatch[1].toLowerCase() as 'track' | 'album' | 'playlist' | 'artist',
      id: uriMatch[2],
    };
  }
  return null;
}

interface SpotifyEmbedTrackRaw {
  uri?: string;
  title?: string;
  subtitle?: string;
  duration?: number;
  isPlayable?: boolean;
  audioPreview?: { url?: string };
}

interface SpotifyResolvedPayload {
  kind: 'track' | 'album' | 'playlist' | 'artist';
  id: string;
  title: string;
  subtitle: string;
  image: string;
  tracks: StoredTrack[];
}

const spotifyEmbedCache = new Map<string, { expiresAt: number; data: SpotifyResolvedPayload }>();

async function fetchSpotifyEmbedEntity(
  kind: 'track' | 'album' | 'playlist' | 'artist',
  id: string
): Promise<SpotifyResolvedPayload | null> {
  const key = `${kind}:${id}`;
  const cached = spotifyEmbedCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  try {
    const res = await fetchWithTimeout(`https://open.spotify.com/embed/${kind}/${id}`, 5000);
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/);
    if (!match?.[1]) return null;

    const nextData = JSON.parse(match[1]) as {
      props?: {
        pageProps?: {
          state?: {
            data?: {
              entity?: {
                name?: string;
                title?: string;
                subtitle?: string;
                coverArt?: { sources?: Array<{ url?: string }> };
                visualIdentity?: { image?: Array<{ url?: string }> };
                artists?: Array<{ name?: string }>;
                duration?: number;
                audioPreview?: { url?: string };
                trackList?: SpotifyEmbedTrackRaw[];
              };
            };
          };
        };
      };
    };

    const entity = nextData.props?.pageProps?.state?.data?.entity;
    if (!entity) return null;

    const cover =
      entity.coverArt?.sources?.[0]?.url ||
      entity.visualIdentity?.image?.[0]?.url ||
      '';
    const title = entity.name || entity.title || 'Spotify Mix';
    const subtitle =
      entity.subtitle ||
      (entity.artists?.map((a) => a.name).filter(Boolean).join(', ') || 'Spotify Ad-Free');

    let tracks: StoredTrack[] = [];
    if (Array.isArray(entity.trackList) && entity.trackList.length > 0) {
      tracks = entity.trackList
        .map((t, idx) => {
          const trackId = (t.uri || '').split(':').pop() || `${id}-${idx}`;
          const name = t.title || 'Untitled Track';
          const artist = t.subtitle || 'Artist';
          return {
            id: `sp-${trackId}`,
            name,
            artist,
            albumName: title,
            duration: t.duration ? Math.max(30, Math.round(t.duration / 1000)) : 195,
            image: cover,
            language: inferLanguage(`${name} ${artist} ${title}`),
            region: title.toLowerCase().includes('india') || title.toLowerCase().includes('hindi')
              ? 'IN'
              : title.toLowerCase().includes('japan')
                ? 'JP'
                : 'GLOBAL',
            genre: 'Spotify Streaming',
            hasLyrics: !isInstrumentalOrSpam(name, title),
            previewUrl: t.audioPreview?.url || undefined,
          };
        })
        .filter((t) => !isInstrumentalOrSpam(t.name, t.albumName) && !isRemixOrKnockoff(t.name, '', t.artist, ''));
    } else if (kind === 'track' && entity.title) {
      const artist = entity.artists?.map((a) => a.name).filter(Boolean).join(', ') || 'Artist';
      tracks = [
        {
          id: `sp-${id}`,
          name: entity.title,
          artist,
          albumName: title,
          duration: entity.duration ? Math.max(30, Math.round(entity.duration / 1000)) : 195,
          image: cover,
          language: inferLanguage(`${entity.title} ${artist}`),
          genre: 'Spotify Streaming',
          hasLyrics: !isInstrumentalOrSpam(entity.title, ''),
          previewUrl: entity.audioPreview?.url || undefined,
        },
      ];
    }

    const enrichedTracks = await enrichSpotifyTracksArtwork(tracks);
    const payload: SpotifyResolvedPayload = {
      kind,
      id,
      title,
      subtitle: `${subtitle} · ${enrichedTracks.length} tracks`,
      image: cover || enrichedTracks[0]?.image || '',
      tracks: enrichedTracks,
    };

    spotifyEmbedCache.set(key, { expiresAt: Date.now() + 15 * 60_000, data: payload });
    return payload;
  } catch {
    return null;
  }
}

export async function createApp(options: { mode?: 'node-development' | 'node-production' | 'worker' } = {}) {
  const mode = options.mode ?? (process.env.NODE_ENV === 'production' ? 'node-production' : 'node-development');
  cloudflareWorkerRuntime = mode === 'worker';
  const app = express();
  app.disable('x-powered-by');

  // Permit the hosted GitHub Pages frontend and the packaged Capacitor app
  // to call this API. Keep the allowlist explicit rather than reflecting
  // arbitrary Origin headers.
  const allowedApiOrigins = new Set([
    'https://kugisakinobaramio-star.github.io',
    'https://localhost',
    'capacitor://localhost',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ]);
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && allowedApiOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
  // The current API does not consume JSON request bodies. Avoid Express's body-parser
  // dependency here because its iconv-lite Node stream shim is incompatible with Workers.
  app.use((req, res, next) => {
    const contentLength = Number(req.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > 1024 * 1024) {
      res.status(413).json({ ok: false, error: 'Request body too large.' });
      return;
    }
    next();
  });

  // Bound expensive user-controlled media proxy requests per client IP.
  // Keep the map bounded so spoofed clients cannot grow it indefinitely.
  const proxyRateLimits = new Map<string, { count: number; resetAt: number }>();
  app.use(['/api/music/image', '/api/music/audio', '/api/music/download'], (req, res, next) => {
    const now = Date.now();
    const key = req.get('cf-connecting-ip') || req.ip || req.socket.remoteAddress || 'unknown';
    let bucket = proxyRateLimits.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + 60_000 };
      proxyRateLimits.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > 90) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      res.status(429).json({ ok: false, error: 'Too many media requests. Please retry shortly.' });
      return;
    }
    if (proxyRateLimits.size > 10_000) {
      for (const [client, limit] of proxyRateLimits) {
        if (limit.resetAt <= now) proxyRateLimits.delete(client);
        if (proxyRateLimits.size <= 8_000) break;
      }
    }
    next();
  });

  app.get('/api/music/health', (_req, res) => {
    res.json({ ok: true, service: 'harmonia-backend' });
  });

  // Same-origin image proxy with cache + multi-provider cover recovery + dark SVG fallback
  app.get('/api/music/image', async (req, res) => {
    const rawUrl = String(req.query.url || '').trim();
    const titleHint = String(req.query.title || '').trim();

    const tryServeRemote = async (targetUrl: string): Promise<boolean> => {
      if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) return false;
      const cached = imageCache.get(targetUrl);
      if (cached) {
        res.setHeader('Content-Type', cached.contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(cached.buf);
        return true;
      }
      try {
        const upstream = await fetchPublicHttpsUrl(targetUrl, 2500, {
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        });
        if (!upstream.ok) return false;
        const ct = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']);
        if (!allowedImageTypes.has(ct)) return false;
        const declaredLength = Number(upstream.headers.get('content-length') || 0);
        if (declaredLength > MAX_REMOTE_IMAGE_BYTES) return false;
        const buf = await readResponseBodyWithLimit(upstream, MAX_REMOTE_IMAGE_BYTES);

        cacheImage(targetUrl, buf, ct);

        res.setHeader('Content-Type', ct);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(buf);
        return true;
      } catch {
        return false;
      }
    };

    if (await tryServeRemote(rawUrl)) return;

    if (titleHint && titleHint.length >= 2) {
      const recovered = await lookupTrackArtwork(titleHint, '');
      if (recovered && recovered !== rawUrl && (await tryServeRemote(recovered))) {
        return;
      }
    }

    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(FALLBACK_SVG);
  });

  // Range-capable streaming audio proxy so external streams start playing in <100ms
  app.get('/api/music/audio', async (req, res) => {
    const rawUrl = String(req.query.url || '').trim();
    if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) {
      res.status(400).end();
      return;
    }
    try {
      const headers: Record<string, string> = {};
      if (req.headers.range) headers.Range = String(req.headers.range);
      const upstream = await fetchPublicHttpsUrl(rawUrl, 12000, headers);
      res.status(upstream.status);
      const ct = upstream.headers.get('content-type');
      const cl = upstream.headers.get('content-length');
      const cr = upstream.headers.get('content-range');
      const ar = upstream.headers.get('accept-ranges');
      if (ct) res.setHeader('Content-Type', ct);
      if (cl) res.setHeader('Content-Length', cl);
      if (cr) res.setHeader('Content-Range', cr);
      res.setHeader('Accept-Ranges', ar || 'bytes');

      if (!upstream.body) {
        res.end();
        return;
      }

      const nodeStream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
      res.on('close', () => {
        nodeStream.destroy();
      });
      nodeStream.on('error', () => {
        if (!res.headersSent) res.status(502);
        res.end();
      });
      nodeStream.pipe(res);
    } catch {
      if (!res.headersSent) res.status(502).end();
      else res.end();
    }
  });

  // Direct audio download proxy endpoint (forces attachment download with clean filename)
  app.get('/api/music/download', async (req, res) => {
    const rawUrl = String(req.query.url || '').trim();
    const filename = String(req.query.filename || 'harmonia-track.mp3').trim().replace(/["\\/]/g, '_');
    if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) {
      res.status(400).send('Invalid audio stream URL');
      return;
    }
    try {
      const upstream = await fetchPublicHttpsUrl(rawUrl, 15000);
      if (!upstream.ok || !upstream.body) {
        res.status(502).send('Failed to fetch stream for download');
        return;
      }
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'audio/mpeg');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.mp3"`);
      const cl = upstream.headers.get('content-length');
      if (cl) res.setHeader('Content-Length', cl);

      const nodeStream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
      res.on('close', () => {
        nodeStream.destroy();
      });
      nodeStream.on('error', () => {
        if (!res.headersSent) res.status(502);
        res.end();
      });
      nodeStream.pipe(res);
    } catch {
      if (!res.headersSent) res.status(502).end();
    }
  });
  app.get('/api/music/artwork', async (req, res) => {
    const title = String(req.query.title || '').trim();
    const artist = String(req.query.artist || '').trim();
    if (!title && !artist) {
      res.json({ ok: false, image: '' });
      return;
    }

    let image = await lookupTrackArtwork(title || artist, artist);
    if (!image) {
      const q = `${title} ${artist}`.trim();
      const [audSettled, mbSettled] = await Promise.allSettled([
        fetchWithTimeout(
          `https://discoveryprovider.audius.co/v1/tracks/search?query=${encodeURIComponent(q)}&limit=1`,
          2500
        ).then((r) => (r.ok ? r.json() : null)),
        fetchWithTimeout(
          `https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(q)}&fmt=json&limit=1`,
          2800,
          { 'User-Agent': 'HarmoniaMusicPlayer/1.0 (https://harmonia.app)' }
        ).then((r) => (r.ok ? r.json() : null)),
      ]);
      if (audSettled.status === 'fulfilled' && audSettled.value?.data?.[0]) {
        const aud = audSettled.value.data[0] as AudiusTrackRaw;
        image = aud.artwork?.['480x480'] || aud.artwork?.['150x150'] || '';
      }
      if (!image && mbSettled.status === 'fulfilled' && mbSettled.value?.releases?.[0]?.id) {
        const mbid = String(mbSettled.value.releases[0].id);
        image = `https://coverartarchive.org/release/${encodeURIComponent(mbid)}/front-250`;
      }
    }

    res.json({ ok: Boolean(image), image });
  });

  // Resolve authentic ORIGINAL-ARTIST streams (JioSaavn 320k primary artist + Verified Audius + Deezer/iTunes + YouTube Music full studio tracks)
  type StreamResolvePayload = {
    streamUrls: Record<string, string>;
    previewUrl?: string;
    alternates: string[];
    youtubeId?: string;
    youtubeAlternates?: string[];
  };

  // Resolved stream URLs can expire or be withdrawn. Keep this cache short-lived
  // rather than treating a previously successful provider URL as permanent.
  const streamResolveCache = new Map<
    string,
    { expiresAt: number; payload: StreamResolvePayload }
  >();


  app.get('/api/music/resolve', async (req, res) => {
    const title = String(req.query.title || '').trim();
    const artist = String(req.query.artist || '').trim();
    const targetDurationSec = Number(req.query.duration || 0);
    if (!title) {
      res.json({ ok: false, streamUrls: {}, alternates: [] });
      return;
    }

    const cacheKey = `${title.toLowerCase()}::${artist.toLowerCase()}::${Math.round(targetDurationSec || 0)}`;
    const forceRefresh = String(req.query.forceRefresh || '') === '1';
    const cached = streamResolveCache.get(cacheKey);
    if (cached && cached.expiresAt <= Date.now()) {
      streamResolveCache.delete(cacheKey);
    }
    const freshCached = streamResolveCache.get(cacheKey);
    if (
      !forceRefresh &&
      freshCached &&
      (Object.keys(freshCached.payload.streamUrls).length > 0 || freshCached.payload.youtubeId)
    ) {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ ok: true, ...freshCached.payload, cache: 'hit' });
      return;
    }

    const primaryArtist = artist.split(',')[0]?.trim() || '';
    const cleanTitle = title.split('(')[0]?.trim() || title;
    const query = `${cleanTitle} ${primaryArtist}`.trim();

    const streamUrls: Record<string, string> = {};
    const fullAlternates: string[] = [];
    const previewAlternates: string[] = [];
    let previewUrl: string | undefined;

  interface JamendoTrackRaw {
    id?: string;
    name?: string;
    artist_name?: string;
    audio?: string;
    duration?: number;
  }

  interface InternetArchiveSearchDoc {
    identifier?: string;
    title?: string;
    creator?: string | string[];
    licenseurl?: string | string[];
  }

  interface FunkwhaleTrackRaw {
    id?: number | string;
    title?: string;
    name?: string;
    artist_name?: string;
    artists?: Array<{ name?: string }>;
    duration?: number | string;
    listen_url?: string;
    is_playable?: boolean;
    album?: { title?: string; cover?: string; cover_url?: string };
    cover?: string;
    uploads?: Array<{ listen_url?: string; audio_file?: { listen_url?: string } }>;
  }


  interface InternetArchiveFile {
    name?: string;
    format?: string;
    size?: string;
    private?: string | boolean;
  }

  function hasReusableArchiveLicense(value: string): boolean {
    return /creativecommons\.org\/(?:publicdomain\/zero|licenses\/by\/|licenses\/by-sa\/)/i.test(value);
  }

  function parseArchiveRuntime(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return undefined;
    const parts = value.trim().split(':').map(Number);
    if (!parts.length || parts.some((part) => !Number.isFinite(part))) return undefined;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return undefined;
  }

  async function resolveInternetArchiveStream(
    cleanTitle: string,
    primaryArtist: string,
    targetDurationSec = 0
  ): Promise<string | undefined> {
    try {
      const safeTerm = (value: string) => value.replace(/["\\]/g, ' ').trim();
      const query = `mediatype:audio AND title:"${safeTerm(cleanTitle)}" AND creator:"${safeTerm(primaryArtist)}"`;
      const searchUrl =
        `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}` +
        `&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=licenseurl&fl[]=runtime&rows=6&page=1&output=json`;
      const searchResponse = await fetchWithTimeout(searchUrl, 4000);
      if (!searchResponse.ok) return undefined;
      const searchJson = (await searchResponse.json()) as {
        response?: { docs?: InternetArchiveSearchDoc[] };
      };
      const docs = searchJson.response?.docs || [];

      for (const doc of docs) {
        const identifier = String(doc.identifier || '').trim();
        const creator = Array.isArray(doc.creator) ? doc.creator.join(', ') : String(doc.creator || '');
        const licenseValues = Array.isArray(doc.licenseurl) ? doc.licenseurl : [doc.licenseurl || ''];
        if (!identifier || !licenseValues.some(hasReusableArchiveLicense)) continue;

        const score = scoreAuthenticTrackCandidate({
          itemTitle: String(doc.title || ''),
          itemArtist: creator,
          requestedTitle: cleanTitle,
          requestedArtist: primaryArtist,
          itemDurationSec: parseArchiveRuntime((doc as { runtime?: unknown }).runtime),
          targetDurationSec,
        });
        if (score === null) continue;

        const metadataResponse = await fetchWithTimeout(
          `https://archive.org/metadata/${encodeURIComponent(identifier)}`,
          3500
        );
        if (!metadataResponse.ok) continue;
        const metadataJson = (await metadataResponse.json()) as {
          metadata?: { licenseurl?: string; runtime?: string | number };
          files?: InternetArchiveFile[];
        };
        const metadataLicense = String(metadataJson.metadata?.licenseurl || '');
        if (!hasReusableArchiveLicense(metadataLicense)) continue;
        const runtime = parseArchiveRuntime(metadataJson.metadata?.runtime);
        if (runtime !== undefined && !isPlausibleSongDuration(runtime)) continue;

        const audioFile = (metadataJson.files || [])
          .filter((file) => {
            const name = String(file.name || '');
            const size = Number(file.size || 0);
            return (
              /\.(?:mp3|ogg|opus|m4a|flac)$/i.test(name) &&
              file.private !== true &&
              file.private !== 'true' &&
              (!size || size <= 150 * 1024 * 1024)
            );
          })
          .sort((a, b) => {
            const rank = (name: string) =>
              /\.mp3$/i.test(name) ? 0 : /\.ogg$/i.test(name) ? 1 : /\.opus$/i.test(name) ? 2 : 3;
            return rank(String(a.name || '')) - rank(String(b.name || ''));
          })[0];
        if (!audioFile?.name) continue;

        const encodedPath = audioFile.name.split('/').map(encodeURIComponent).join('/');
        return `https://archive.org/download/${encodeURIComponent(identifier)}/${encodedPath}`;
      }
    } catch {
      // The archive is an optional, best-effort source; other providers remain available.
    }
    return undefined;
  }

  async function resolveJamendoStream(
    cleanTitle: string,
    primaryArtist: string,
    targetDurationSec = 0
  ): Promise<string | undefined> {
    try {
      const q = `${cleanTitle} ${primaryArtist}`.trim();
      const res = await fetchWithTimeout(
        `https://api.jamendo.com/v3.0/tracks/?client_id=5c361a6b&format=json&limit=6&search=${encodeURIComponent(
          q
        )}`,
        3500
      );
      if (!res.ok) return undefined;
      const json = (await res.json()) as { results?: JamendoTrackRaw[] };
      if (!Array.isArray(json.results) || json.results.length === 0) return undefined;

      const scored = json.results
        .map((item) => {
          if (!item.audio) return null;
          const dur = Number(item.duration || 0);
          const score = scoreAuthenticTrackCandidate({
            itemTitle: item.name || '',
            itemArtist: item.artist_name || primaryArtist,
            requestedTitle: cleanTitle,
            requestedArtist: primaryArtist,
            itemDurationSec: dur,
            targetDurationSec,
          });
          return { audio: item.audio, score };
        })
        .filter((x): x is { audio: string; score: number } => x !== null && x.score !== null)
        .sort((a, b) => b.score - a.score);

      return scored[0]?.audio;
    } catch {
      return undefined;
    }
  }

  // Funkwhale is an open-source, federated music platform. Only public,
  // playable recordings with a strong title/artist/duration match are eligible.
  // Remix/cover filtering is applied before a stream can enter the fallback list.
  async function resolveFunkwhaleStream(
    cleanTitle: string,
    primaryArtist: string,
    targetDurationSec = 0
  ): Promise<string | undefined> {
    const pods = ['https://open.audio', 'https://demo.funkwhale.audio'];
    const results = await Promise.allSettled(
      pods.map(async (pod) => {
        const endpoint = `${pod}/api/v1/tracks/?q=${encodeURIComponent(
          `${cleanTitle} ${primaryArtist}`.trim()
        )}&page_size=12`;
        const response = await fetchWithTimeout(endpoint, 3500);
        if (!response.ok) return [];
        const json = (await response.json()) as { results?: FunkwhaleTrackRaw[] };
        return (json.results || []).map((track) => ({ track, pod }));
      })
    );
    const candidates = results.flatMap((r) => r.status === 'fulfilled' ? r.value : []);
    const ranked = candidates.map(({ track, pod }) => {
      const title = String(track.title || track.name || '');
      const artist = String(
        track.artist_name ||
        track.artists?.map((a) => a.name || '').filter(Boolean).join(', ') ||
        primaryArtist
      );
      const duration = Number(track.duration || 0);
      const listenPath =
        track.listen_url ||
        track.uploads?.find((u) => u.listen_url)?.listen_url ||
        track.uploads?.find((u) => u.audio_file?.listen_url)?.audio_file?.listen_url ||
        '';
      const score = scoreAuthenticTrackCandidate({
        itemTitle: title,
        itemArtist: artist,
        requestedTitle: cleanTitle,
        requestedArtist: primaryArtist,
        itemDurationSec: duration,
        targetDurationSec,
      });
      if (
        track.is_playable === false ||
        !listenPath ||
        !isPlausibleSongDuration(duration) ||
        isRemixOrKnockoff(title, cleanTitle, artist, primaryArtist) ||
        score === null
      ) return null;
      let streamUrl = '';
      try {
        streamUrl = new URL(listenPath, pod).toString();
      } catch {
        return null;
      }
      if (!streamUrl.startsWith(`${pod}/`)) return null;
      return { streamUrl, score };
    }).filter((item): item is { streamUrl: string; score: number } => item !== null)
      .sort((a, b) => b.score - a.score);
    return ranked[0]?.streamUrl;
  }

    const [saavnSettled, audiusSettled, deezerSettled, itunesSettled, jamendoSettled, funkwhaleSettled] =
      await Promise.allSettled([
        (async () => {
          // Search both the combined query and title-only variants. Public catalogues
          // sometimes tokenize artist/title differently; the strict scorer below
          // still verifies the primary artist before accepting any stream.
          const saavnQueries = [...new Set([
            query,
            `${primaryArtist} ${cleanTitle}`.trim(),
            cleanTitle,
          ].filter(Boolean))];
          const responses = await Promise.allSettled(
            saavnQueries.map((term) =>
              fetchWithTimeout(
                `${SAAVN_BASE}/api/search/songs?query=${encodeURIComponent(term)}&page=0&limit=12`,
                5000
              ).then((r) => (r.ok ? r.json() : null))
            )
          );
          const seen = new Set<string>();
          const results: SaavnCandidateRaw[] = [];
          for (const response of responses) {
            if (response.status !== 'fulfilled') continue;
            const items = response.value?.data?.results;
            if (!Array.isArray(items)) continue;
            for (const item of items as SaavnCandidateRaw[]) {
              const primary = (item.artists?.primary || [])
                .map((entry) => entry.name || '')
                .join(', ')
                .toLowerCase();
              const key = `${String(item.name || '').toLowerCase()}::${primary}`;
              if (!item.name || seen.has(key)) continue;
              seen.add(key);
              results.push(item);
            }
          }
          return { data: { results } };
        })(),
        (async () => {
          // Audius' public API is the canonical read endpoint; keep a discovery
          // provider as a resilient mirror. Read-only search/streaming is public.
          // Search multiple token orders: Audius indexing can rank a combined
          // title/artist query differently from title-only discovery.
          const audiusQueries = [...new Set([
            query,
            cleanTitle,
            `${primaryArtist} ${cleanTitle}`.trim(),
          ].filter(Boolean))];
          const requests = audiusQueries.flatMap((term) => [
            `https://api.audius.co/v1/tracks/search?query=${encodeURIComponent(term)}&limit=8`,
            `https://discoveryprovider.audius.co/v1/tracks/search?query=${encodeURIComponent(term)}&limit=8`,
          ]);
          const responses = await Promise.allSettled(
            requests.map((url) =>
              fetchWithTimeout(url, 4000).then((r) => (r.ok ? r.json() : null))
            )
          );
          const seen = new Set<string>();
          const data: AudiusTrackRaw[] = [];
          for (const response of responses) {
            if (response.status !== 'fulfilled' || !Array.isArray(response.value?.data)) continue;
            for (const track of response.value.data as AudiusTrackRaw[]) {
              const id = String(track.id || '');
              if (id && !seen.has(id)) {
                seen.add(id);
                data.push(track);
              }
            }
          }
          return { data };
        })(),
        fetchWithTimeout(
          `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=6`,
          4000
        ).then((r) => (r.ok ? r.json() : null)),
        fetchWithTimeout(
          `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=6`,
          4000
        ).then((r) => (r.ok ? r.json() : null)),
        resolveJamendoStream(cleanTitle, primaryArtist, targetDurationSec),
        resolveFunkwhaleStream(cleanTitle, primaryArtist, targetDurationSec),
      ]);

    if (saavnSettled.status === 'fulfilled' && saavnSettled.value?.data?.results?.length) {
      const results = saavnSettled.value.data.results as SaavnCandidateRaw[];
      const bestSaavn = results
        .map((r) => ({ r, score: scoreSaavnMatch(r, cleanTitle, artist || primaryArtist, targetDurationSec) }))
        .filter((x): x is { r: SaavnCandidateRaw; score: number } => x.score !== null)
        .sort((a, b) => b.score - a.score)[0]?.r;
      for (const d of bestSaavn?.downloadUrl || []) {
        if (d.quality && d.url) {
          streamUrls[d.quality] = d.url;
        }
      }
      if (streamUrls['320kbps']) fullAlternates.push(streamUrls['320kbps']);
      if (streamUrls['160kbps']) fullAlternates.push(streamUrls['160kbps']);
      if (streamUrls['96kbps']) fullAlternates.push(streamUrls['96kbps']);
    }

    if (audiusSettled.status === 'fulfilled' && audiusSettled.value?.data?.length) {
      const audList = audiusSettled.value.data as AudiusTrackRaw[];
      const bestAud = audList
        .map((a) => ({
          a,
          // Audius exposes the uploader account as its artist identity. For
          // collaborations, verify against the requested primary artist only;
          // requiring every featured artist to match one uploader rejects valid tracks.
          score: scoreAuthenticAudiusMatch(a, cleanTitle, primaryArtist || artist, targetDurationSec),
        }))
        .filter((x): x is { a: AudiusTrackRaw; score: number } => x.score !== null)
        .sort((x, y) => y.score - x.score)[0]?.a;
      if (bestAud?.id) {
        const audStreams = [
          `https://api.audius.co/v1/tracks/${encodeURIComponent(bestAud.id)}/stream`,
          `https://discoveryprovider.audius.co/v1/tracks/${encodeURIComponent(bestAud.id)}/stream`,
        ];
        // Keep Audius behind every available JioSaavn quality. Putting an Audius
        // URL in the 160/96 slots made Auto/160 playback choose Audius even when
        // an exact JioSaavn 320kbps stream had already matched.
        if (!Object.values(streamUrls).some(Boolean)) {
          streamUrls['160kbps'] = audStreams[0];
          streamUrls['96kbps'] = audStreams[1];
        }
        fullAlternates.push(...audStreams);
      }
    }

    let internetArchiveAttempted = false;
    let internetArchiveSelected = false;
    if (!fullAlternates.length && !Object.values(streamUrls).some(Boolean)) {
      internetArchiveAttempted = true;
      const archiveUrl = await resolveInternetArchiveStream(
        cleanTitle,
        primaryArtist,
        targetDurationSec
      );
      if (archiveUrl) {
        streamUrls['160kbps'] = archiveUrl;
        fullAlternates.push(archiveUrl);
        internetArchiveSelected = true;
      }
    }

    if (!Object.values(streamUrls).some(Boolean)) {
      // Jamendo/Funkwhale are fallback sources. Do not mix their 160kbps
      // stream into a track that already has an exact primary-catalogue match:
      // otherwise quality selection can accidentally play a different version.
      const fallbackUrl =
        (jamendoSettled.status === 'fulfilled' ? jamendoSettled.value : undefined) ||
        (funkwhaleSettled.status === 'fulfilled' ? funkwhaleSettled.value : undefined);
      if (fallbackUrl) {
        streamUrls['160kbps'] = fallbackUrl;
        fullAlternates.push(fallbackUrl);
      }
    }

    if (deezerSettled.status === 'fulfilled' && deezerSettled.value?.data?.length) {
      const dzList = deezerSettled.value.data as DeezerTrackRaw[];
      const bestDz = dzList
        .filter((d) => Boolean(d.preview) && !isInstrumentalOrSpam(d.title || '', d.album?.title || ''))
        .map((d) => ({
          d,
          score: scoreAuthenticTrackCandidate({
            itemTitle: d.title || d.title_short || '',
            itemArtist: d.artist?.name || '',
            requestedTitle: cleanTitle,
            requestedArtist: artist || primaryArtist,
            itemDurationSec: d.duration || 0,
            targetDurationSec,
          }),
        }))
        .filter((x): x is { d: DeezerTrackRaw; score: number } => x.score !== null)
        .sort((x, y) => y.score - x.score)[0]?.d;
      if (bestDz?.preview) {
        previewUrl = bestDz.preview;
        previewAlternates.push(bestDz.preview);
      }
    }

    if (itunesSettled.status === 'fulfilled' && itunesSettled.value?.results?.length) {
      const list = itunesSettled.value.results as ItunesTrackRaw[];
      const bestIt = list
        .filter((r) => Boolean(r.previewUrl) && !isInstrumentalOrSpam(r.trackName || '', r.collectionName || ''))
        .map((r) => ({
          r,
          score: scoreAuthenticTrackCandidate({
            itemTitle: r.trackName || '',
            itemArtist: r.artistName || '',
            requestedTitle: cleanTitle,
            requestedArtist: artist || primaryArtist,
            itemDurationSec: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : 0,
            targetDurationSec,
          }),
        }))
        .filter((x): x is { r: ItunesTrackRaw; score: number } => x.score !== null)
        .sort((x, y) => y.score - x.score)[0]?.r;
      if (bestIt?.previewUrl) {
        if (!previewUrl) previewUrl = bestIt.previewUrl;
        previewAlternates.push(bestIt.previewUrl);
      }
    }

    // YouTube is offered only through the user-initiated video viewer.
    // Do not resolve YouTube IDs into the hidden audio engine: that would
    // rely on unofficial search endpoints and could enable background audio.

    const payload = {
      streamUrls,
      previewUrl,
      alternates: Array.from(new Set([...fullAlternates, ...previewAlternates])),
    };

    // Safe playback diagnostics: never log search terms, stream URLs, or user data.
    // Promise status distinguishes provider timeouts/errors from fulfilled requests;
    // candidate counts and selected-source flags show where resolution stopped.
    const saavnCandidateDiagnostics = saavnSettled.status === 'fulfilled'
      ? ((saavnSettled.value?.data?.results || []) as SaavnCandidateRaw[]).slice(0, 8).map((candidate) => {
          const primaryArtists = (candidate.artists?.primary || [])
            .map((entry) => (entry.name || '').trim())
            .filter(Boolean)
            .join(', ');
          const downloadEntries = Array.isArray(candidate.downloadUrl) ? candidate.downloadUrl : [];
          const score = scoreSaavnMatch(candidate, cleanTitle, artist || primaryArtist, targetDurationSec);
          const reason = !candidate.name
            ? 'missing_title'
            : !primaryArtists
              ? 'missing_primary_artist'
              : !downloadEntries.length
                ? 'missing_download_urls'
                : score === null
                  ? 'strict_match_rejected'
                  : 'accepted';
          return {
            title: String(candidate.name || '').slice(0, 120),
            primaryArtist: primaryArtists.slice(0, 160),
            duration: Number(candidate.duration || 0),
            downloadEntryCount: downloadEntries.length,
            downloadQualities: downloadEntries
              .map((entry) => String(entry.quality || ''))
              .filter(Boolean)
              .slice(0, 8),
            score,
            reason,
          };
        })
      : [];
    const audiusCandidateDiagnostics = audiusSettled.status === 'fulfilled'
      ? ((audiusSettled.value?.data || []) as AudiusTrackRaw[]).slice(0, 12).map((candidate) => {
          const uploader = String(candidate.user?.name || candidate.user?.handle || '');
          const score = scoreAuthenticAudiusMatch(
            candidate,
            cleanTitle,
            primaryArtist || artist,
            targetDurationSec
          );
          const reason = !candidate.id || !candidate.title
            ? 'missing_track_identity'
            : Number(candidate.duration || 0) < 75
              ? 'duration_too_short'
              : score === null
                ? 'strict_match_rejected'
                : candidate.user?.is_verified === true
                  ? 'accepted_verified'
                  : 'accepted_unverified_strict_match';
          return {
            title: String(candidate.title || '').slice(0, 120),
            uploader: uploader.slice(0, 120),
            verified: candidate.user?.is_verified === true,
            duration: Number(candidate.duration || 0),
            score,
            reason,
          };
        })
      : [];
    const diagnostics = {
      providers: {
        saavn: {
          request: saavnSettled.status,
          candidates: saavnSettled.status === 'fulfilled'
            ? Number(saavnSettled.value?.data?.results?.length || 0)
            : 0,
          selected: Boolean(streamUrls['320kbps'] || streamUrls['96kbps']),
        },
        audius: {
          request: audiusSettled.status,
          candidates: audiusSettled.status === 'fulfilled'
            ? Number(audiusSettled.value?.data?.length || 0)
            : 0,
          selected: fullAlternates.some((url) => url.includes('discoveryprovider.audius.co')),
        },
        deezer: {
          request: deezerSettled.status,
          candidates: deezerSettled.status === 'fulfilled'
            ? Number(deezerSettled.value?.data?.length || 0)
            : 0,
          previewSelected: Boolean(previewUrl && previewUrl.includes('deezer')),
        },
        itunes: {
          request: itunesSettled.status,
          candidates: itunesSettled.status === 'fulfilled'
            ? Number(itunesSettled.value?.results?.length || 0)
            : 0,
          previewSelected: Boolean(previewAlternates.some((url) => url.includes('apple.com'))),
        },
        jamendo: {
          request: jamendoSettled.status,
          candidateSelected: Boolean(jamendoSettled.status === 'fulfilled' && jamendoSettled.value),
        },
        funkwhale: {
          request: funkwhaleSettled.status,
          candidateSelected: Boolean(funkwhaleSettled.status === 'fulfilled' && funkwhaleSettled.value),
        },
        internetArchive: {
          attempted: internetArchiveAttempted,
          selected: internetArchiveSelected,
        },
      },
      saavnCandidates: saavnCandidateDiagnostics,
      audiusCandidates: audiusCandidateDiagnostics,
      output: {
        has320kbps: Boolean(streamUrls['320kbps']),
        has160kbps: Boolean(streamUrls['160kbps']),
        has96kbps: Boolean(streamUrls['96kbps']),
        hasPreview: Boolean(previewUrl),
        alternateCount: payload.alternates.length,
        ok: Object.keys(streamUrls).length > 0 || Boolean(previewUrl),
      },
      cache: { forceRefresh, bypassed: forceRefresh },
    };
    // Keep candidate titles/artists out of routine logs; expose them only
    // in the explicit diagnostics=1 response requested by the client.
    console.log('[music-resolve-diagnostics]', JSON.stringify({
      providers: diagnostics.providers,
      output: diagnostics.output,
      cache: diagnostics.cache,
    }));
    if (Object.keys(streamUrls).length > 0) {
      if (streamResolveCache.size >= 300) {
        const first = streamResolveCache.keys().next().value;
        if (first) streamResolveCache.delete(first);
      }
      streamResolveCache.set(cacheKey, {
        // Provider URLs are volatile; five minutes limits stale-link failures
        // while still avoiding repeated multi-provider lookups during a session.
        expiresAt: Date.now() + 5 * 60_000,
        payload,
      });
    }

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: Object.keys(streamUrls).length > 0 || Boolean(previewUrl),
      ...payload,
      cache: 'miss',
      ...(String(req.query.diagnostics || '') === '1' ? { diagnostics } : {}),
    });
  });

  // Zero-API Spotify Free Resolver (playlists, albums, tracks, artists via embed entity data)
  app.get('/api/music/spotify/resolve', async (req, res) => {
    const rawUrl = String(req.query.url || '').trim();
    const target = parseSpotifyTarget(rawUrl);
    if (!target) {
      res.status(400).json({ ok: false, error: 'Invalid Spotify link or URI' });
      return;
    }
    const entity = await fetchSpotifyEmbedEntity(target.kind, target.id);
    if (!entity || !entity.tracks.length) {
      res.json({ ok: false, error: 'Unable to load Spotify item' });
      return;
    }
    res.json({ ok: true, ...entity });
  });

  app.get('/api/music/spotify/playlists', async (_req, res) => {
    const curatedIds = [
      { id: '37i9dQZF1DXcBWIGoYBM5M', language: 'English', region: 'GLOBAL' },
      { id: '37i9dQZF1DX0XUfTFmNBRM', language: 'Hindi', region: 'IN' },
      { id: '37i9dQZEVXbKXQ4mDTEBXq', language: 'J-Pop', region: 'JP' },
      { id: '37i9dQZF1DXbVhgADFy3im', language: 'Hindi', region: 'IN' },
      { id: '37i9dQZEVXbMDoHDwVN2tF', language: 'Mixed', region: 'GLOBAL' },
      { id: '37i9dQZF1DWUa8ZRTfalHk', language: 'English', region: 'US' },
    ];

    const settled = await Promise.allSettled(
      curatedIds.map(async (item) => {
        const data = await fetchSpotifyEmbedEntity('playlist', item.id);
        if (!data || !data.tracks.length) return null;
        return {
          id: `spotify-pl-${item.id}`,
          name: data.title,
          description: `Spotify Free · ${data.tracks.length} tracks · Zero Ads`,
          image: data.image,
          language: item.language,
          region: item.region,
          tracks: data.tracks,
        };
      })
    );

    const playlists = [];
    for (const s of settled) {
      if (s.status === 'fulfilled' && s.value) {
        playlists.push(s.value);
      }
    }

    res.json({ ok: playlists.length > 0, playlists });
  });

  // Synced LRC lyrics (LRCLIB primary + lyrics.ovh fallback)
  app.get('/api/music/lyrics', async (req, res) => {
    const artist = String(req.query.artist || '').trim();
    const title = String(req.query.title || '').trim();
    const duration = Number(req.query.duration || 0);
    if (!artist || !title) {
      res.json({ ok: false, hasLyrics: false, synced: false, lines: [] });
      return;
    }

    // 1. Try LRCLIB exact get
    try {
      const params = new URLSearchParams({
        artist_name: artist,
        track_name: title,
      });
      if (duration > 10) params.set('duration', String(Math.round(duration)));
      const lrcRes = await fetchWithTimeout(`https://lrclib.net/api/get?${params.toString()}`, 4500);
      if (lrcRes.ok) {
        const data = (await lrcRes.json()) as {
          instrumental?: boolean;
          syncedLyrics?: string;
          plainLyrics?: string;
        };
        if (data.instrumental) {
          res.json({ ok: true, hasLyrics: false, synced: false, lines: [] });
          return;
        }
        if (data.syncedLyrics) {
          const lines = parseLrcText(data.syncedLyrics);
          if (lines.length) {
            res.json({ ok: true, hasLyrics: true, synced: true, lines });
            return;
          }
        }
        if (data.plainLyrics) {
          const plain = data.plainLyrics
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean);
          const dur = duration > 10 ? duration : 180;
          const interval = dur / Math.max(1, plain.length);
          res.json({
            ok: true,
            hasLyrics: true,
            synced: false,
            lines: plain.map((text, idx) => ({ time: Math.round(idx * interval * 10) / 10, text })),
          });
          return;
        }
      }
    } catch {
      // Try LRCLIB search fallback
    }

    // 2. Try LRCLIB fuzzy search
    try {
      const q = `${title} ${artist}`;
      const searchRes = await fetchWithTimeout(
        `https://lrclib.net/api/search?q=${encodeURIComponent(q)}`,
        4000
      );
      if (searchRes.ok) {
        const list = (await searchRes.json()) as Array<{
          instrumental?: boolean;
          syncedLyrics?: string;
          plainLyrics?: string;
        }>;
        const firstWithLyrics = list.find((item) => !item.instrumental && (item.syncedLyrics || item.plainLyrics));
        if (firstWithLyrics?.syncedLyrics) {
          const lines = parseLrcText(firstWithLyrics.syncedLyrics);
          if (lines.length) {
            res.json({ ok: true, hasLyrics: true, synced: true, lines });
            return;
          }
        }
        if (firstWithLyrics?.plainLyrics) {
          const plain = firstWithLyrics.plainLyrics
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean);
          const dur = duration > 10 ? duration : 180;
          const interval = dur / Math.max(1, plain.length);
          res.json({
            ok: true,
            hasLyrics: true,
            synced: false,
            lines: plain.map((text, idx) => ({ time: Math.round(idx * interval * 10) / 10, text })),
          });
          return;
        }
      }
    } catch {
      // Try lyrics.ovh
    }

    // 3. Fallback to lyrics.ovh
    try {
      const upstream = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
      const response = await fetchWithTimeout(upstream, 4000);
      if (response.ok) {
        const json = (await response.json()) as { lyrics?: string };
        if (json.lyrics) {
          const plain = json.lyrics
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 120);
          const dur = duration > 10 ? duration : 180;
          const interval = dur / Math.max(1, plain.length);
          res.json({
            ok: true,
            hasLyrics: true,
            synced: false,
            lines: plain.map((text, idx) => ({ time: Math.round(idx * interval * 10) / 10, text })),
          });
          return;
        }
      }
    } catch {
      // Ignore
    }

    res.json({ ok: false, hasLyrics: false, synced: false, lines: [] });
  });

  // Multi-source search (Deezer + iTunes + Audius + JioSaavn)
  app.get('/api/music/search', async (req, res) => {
    const type = String(req.query.type || 'songs');
    const query = String(req.query.query || '').trim();
    const region = String(req.query.region || 'IN').toUpperCase();
    const page = Number(req.query.page || 0);
    const limit = Math.min(30, Math.max(1, Number(req.query.limit || 20)));

    if (!query) {
      res.status(400).json({ ok: false, error: 'Missing query parameter' });
      return;
    }

    if (type === 'songs') {
      const country = region === 'JP' ? 'JP' : region === 'US' ? 'US' : region === 'GB' ? 'GB' : 'IN';
      // MusicBrainz is a metadata-only catalogue with a strict global rate limit.
      // Keep it out of the interactive song-search critical path so it cannot
      // delay playable results from the audio catalogues.
      const [saavnResult, itunesResult, deezerResult, audiusResult] = await Promise.allSettled([
        fetchWithTimeout(
          `${SAAVN_BASE}/api/search/songs?query=${encodeURIComponent(query)}&page=${page}&limit=${limit}`,
          3200
        ).then((r) => (r.ok ? r.json() : null)),
        fetchWithTimeout(
          `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&country=${country}&media=music&entity=song&limit=10`,
          3200
        ).then((r) => (r.ok ? r.json() : null)),
        fetchWithTimeout(
          `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=10`,
          3200
        ).then((r) => (r.ok ? r.json() : null)),
        fetchWithTimeout(
          `https://discoveryprovider.audius.co/v1/tracks/search?query=${encodeURIComponent(query)}&limit=6`,
          3200
        ).then((r) => (r.ok ? r.json() : null)),
      ]);

      const saavnRaw = (
        saavnResult.status === 'fulfilled' && saavnResult.value
          ? ((saavnResult.value.data?.results || []) as Array<{
              name?: string;
              artists?: { primary?: Array<{ name?: string }> };
            }>)
          : []
      ).filter((r) => {
        const primary = (r.artists?.primary || []).map((a) => a.name || '').join(', ');
        return !isRemixOrKnockoff(r.name || '', query, primary, query);
      });

      const itunesRaw =
        itunesResult.status === 'fulfilled' && itunesResult.value
          ? ((itunesResult.value.results || []) as ItunesTrackRaw[])
          : [];

      const deezerRaw =
        deezerResult.status === 'fulfilled' && deezerResult.value
          ? ((deezerResult.value.data || []) as DeezerTrackRaw[])
          : [];

      const audiusRaw =
        audiusResult.status === 'fulfilled' && audiusResult.value
          ? ((audiusResult.value.data || []) as AudiusTrackRaw[])
          : [];
      const musicBrainzRecordings: MusicBrainzRecordingRaw[] = [];

      const itunesTracks = itunesRaw
        .map((r) => mapItunesTrack(r, country))
        .filter(
          (t) =>
            !isInstrumentalOrSpam(t.name, t.albumName) &&
            !isRemixOrKnockoff(`${t.name} ${t.albumName}`, query, t.artist, query)
        );

      const deezerTracks = deezerRaw
        .filter(
          (r) =>
            !isInstrumentalOrSpam(r.title || r.title_short || '', r.album?.title || '') &&
            !isRemixOrKnockoff(`${r.title || r.title_short || ''} ${r.album?.title || ''}`, query, r.artist?.name || '', query)
        )
        .map((r) => mapDeezerTrack(r, country));

      const audiusTracks = audiusRaw
        .filter((r) => (r.duration || 0) >= 75)
        .map((r) => mapAudiusTrack(r, country))
        .filter(
          (t) =>
            Boolean(t.image) &&
            !isInstrumentalOrSpam(t.name, t.albumName) &&
            !isRemixOrKnockoff(`${t.name} ${t.albumName}`, query, t.artist, query)
        );

      const payload = {
        ok:
          saavnRaw.length > 0 ||
          itunesTracks.length > 0 ||
          deezerTracks.length > 0 ||
          audiusTracks.length > 0,
        data: { results: saavnRaw, itunesTracks, deezerTracks, audiusTracks, musicBrainzRecordings },
      };
      res.setHeader('Cache-Control', 'public, max-age=20, s-maxage=20');
      res.json(payload);
      return;
    }

    const allowed = new Set(['albums', 'playlists', 'artists']);
    const safeType = allowed.has(type) ? type : 'albums';
    const dzEndpoint =
      safeType === 'artists' ? 'artist' : safeType === 'playlists' ? 'playlist' : 'album';

    const [saavnSettled, deezerSettled, musicBrainzSettled] = await Promise.allSettled([
      fetchWithTimeout(
        `${SAAVN_BASE}/api/search/${safeType}?query=${encodeURIComponent(query)}&page=${page}&limit=${limit}`,
        4500
      ).then((r) => (r.ok ? r.json() : null)),
      fetchWithTimeout(
        `https://api.deezer.com/search/${dzEndpoint}?q=${encodeURIComponent(query)}&limit=8`,
        4000
      ).then((r) => (r.ok ? r.json() : null)),
      safeType === 'artists'
        ? fetchMusicBrainzJson('https://musicbrainz.org/ws/2/artist/?query=' + encodeURIComponent(query) + '&fmt=json&limit=8')
        : Promise.resolve(null),
    ]);

    const saavnData =
      saavnSettled.status === 'fulfilled' && saavnSettled.value
        ? (saavnSettled.value.data ?? saavnSettled.value)
        : { results: [] };
    const deezerItems =
      deezerSettled.status === 'fulfilled' && deezerSettled.value?.data
        ? (deezerSettled.value.data as Array<{
            id?: number;
            name?: string;
            title?: string;
            picture_medium?: string;
            picture_big?: string;
            cover_medium?: string;
            cover_big?: string;
            nb_fan?: number;
            nb_tracks?: number;
            artist?: { name?: string };
          }>)
        : [];

    const musicBrainzArtists =
      musicBrainzSettled.status === 'fulfilled' && musicBrainzSettled.value
        ? ((musicBrainzSettled.value.artists || []) as Array<{
            id?: string; name?: string; disambiguation?: string; country?: string;
          }>)
        : [];

    res.json({
      ok: Boolean((saavnData?.results?.length || 0) > 0 || deezerItems.length > 0 || musicBrainzArtists.length > 0),
      data: { ...saavnData, deezerItems, musicBrainzArtists },
    });
  });

  const discoverCache = new Map<string, { expiresAt: number; tracks: StoredTrack[] }>();

  // Live, genre-led discovery. No fixed artist seeds: each genre is queried
  // against the current regional catalogues and the results are diversified.
  app.get('/api/music/discover', async (req, res) => {
    const region = String(req.query.region || 'IN').toUpperCase();
    const forceRefresh = String(req.query.refresh || '') === '1';
    const cached = discoverCache.get(region);
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
      res.json({ ok: true, region, tracks: cached.tracks, cached: true });
      return;
    }

    const country = region === 'JP' ? 'JP' : region === 'GB' ? 'GB' : region === 'US' ? 'US' : 'IN';
    const genres = [
      'indie pop', 'alternative rock', 'electronic', 'hip hop',
      'R&B', 'jazz', 'folk', 'J-pop', 'Afrobeats', 'Latin pop',
      'Punjabi pop', 'ambient'
    ];

    try {
      const settled = await Promise.allSettled(genres.flatMap((term) => [
        fetchWithTimeout(
          `https://api.deezer.com/search?q=${encodeURIComponent(term)}&limit=12`,
          5000
        ).then((r) => r.ok ? r.json() : { data: [] })
          .then((json: { data?: DeezerTrackRaw[] }) =>
            (json.data || []).map((item) => mapDeezerTrack(item, country))
              .filter((track) => Boolean(track.image) &&
                !isInstrumentalOrSpam(track.name, track.albumName) &&
                !isRemixOrKnockoff(track.name, '', track.artist, ''))
          ),
        fetchWithTimeout(
          `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&country=${country}&media=music&entity=song&limit=12`,
          5000
        ).then((r) => r.ok ? r.json() : { results: [] })
          .then((json: { results?: ItunesTrackRaw[] }) =>
            (json.results || []).map((item) => mapItunesTrack(item, country))
              .filter((track) => Boolean(track.image) &&
                !isInstrumentalOrSpam(track.name, track.albumName) &&
                !isRemixOrKnockoff(track.name, '', track.artist, ''))
          )
      ]));

      const byGenre: StoredTrack[][] = settled.map((result) =>
        result.status === 'fulfilled' ? result.value : []
      );
      const seenTracks = new Set<string>();
      const seenArtists = new Set<string>();
      // Round-robin across genres and providers, then allow artist repeats only
      // after the first pass has introduced as many distinct artists as possible.
      const candidates = byGenre.flat();
      const unique = candidates.filter((track) => {
        const key = `${track.name.toLowerCase()}::${track.artist.toLowerCase()}`;
        if (seenTracks.has(key)) return false;
        seenTracks.add(key);
        return true;
      });
      const firstPass: StoredTrack[] = [];
      const repeats: StoredTrack[] = [];
      for (const track of unique) {
        const artist = track.artist.split(/,|&| feat\.? | ft\.? /i)[0].trim().toLowerCase();
        if (!seenArtists.has(artist)) {
          seenArtists.add(artist);
          firstPass.push(track);
        } else {
          repeats.push(track);
        }
      }
      const tracks = [...firstPass, ...repeats].slice(0, 80) as StoredTrack[];
      if (tracks.length) discoverCache.set(region, { expiresAt: Date.now() + 5 * 60_000, tracks });
      res.json({ ok: tracks.length > 0, region, tracks, cached: false });
    } catch {
      res.json({ ok: false, region, tracks: [] });
    }
  });

  app.get('/api/music/detail', async (req, res) => {
    const type = String(req.query.type || 'albums');
    const id = String(req.query.id || '').trim();
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 30)));
    if (!id) {
      res.status(400).json({ ok: false, error: 'Missing id parameter' });
      return;
    }

    if (id.startsWith('mb-art:') && type === 'artists') {
      const mbid = id.slice('mb-art:'.length);
      if (!/^[0-9a-f-]{36}$/i.test(mbid)) {
        res.status(400).json({ ok: false, error: 'Invalid MusicBrainz artist id.' });
        return;
      }
      const mbJson = await fetchMusicBrainzJson(
        'https://musicbrainz.org/ws/2/recording/?query=' + encodeURIComponent('arid:' + mbid) + '&fmt=json&limit=' + limit
      );
      const recordings = (mbJson?.recordings || []) as MusicBrainzRecordingRaw[];
      const tracks = recordings.map(mapMusicBrainzRecording)
        .filter((track) => !isInstrumentalOrSpam(track.name, track.albumName));
      res.json({
        ok: tracks.length > 0,
        source: 'musicbrainz',
        data: { name: tracks[0]?.artist || 'Artist', image: '', tracks },
      });
      return;
    }

    if (id.startsWith('dz-')) {
      const dzId = id.replace(/^dz-(alb|pl|art):/, '');
      const dzUrl =
        type === 'playlists'
          ? `https://api.deezer.com/playlist/${encodeURIComponent(dzId)}`
          : type === 'artists'
            ? `https://api.deezer.com/artist/${encodeURIComponent(dzId)}/top?limit=${limit}`
            : `https://api.deezer.com/album/${encodeURIComponent(dzId)}`;
      try {
        const dzRes = await fetchWithTimeout(dzUrl, 4500);
        if (dzRes.ok) {
          const dzJson = (await dzRes.json()) as {
            title?: string;
            name?: string;
            cover_big?: string;
            cover_medium?: string;
            picture_big?: string;
            picture_medium?: string;
            tracks?: { data?: DeezerTrackRaw[] };
            data?: DeezerTrackRaw[];
          };
          const rawTracks = dzJson.tracks?.data || dzJson.data || [];
          const albumCover = dzJson.cover_big || dzJson.cover_medium || dzJson.picture_big || dzJson.picture_medium || '';
          const mapped = rawTracks
            .map((item) => {
              const t = mapDeezerTrack(item, 'GLOBAL');
              return !t.image && albumCover ? { ...t, image: albumCover } : t;
            })
            .filter(
              (t) =>
                !isInstrumentalOrSpam(t.name, t.albumName) &&
                !isRemixOrKnockoff(t.name, '', t.artist, '')
            );
          res.json({
            ok: mapped.length > 0,
            source: 'deezer',
            data: {
              name: dzJson.title || dzJson.name || 'Collection',
              image: albumCover || mapped[0]?.image || '',
              tracks: mapped,
            },
          });
          return;
        }
      } catch {
        // Fallback below
      }
      res.json({ ok: false, fallback: true });
      return;
    }

    let upstream = `${SAAVN_BASE}/api/albums?id=${encodeURIComponent(id)}`;
    if (type === 'playlists') {
      upstream = `${SAAVN_BASE}/api/playlists?id=${encodeURIComponent(id)}&page=0&limit=${limit}`;
    } else if (type === 'artists') {
      upstream = `${SAAVN_BASE}/api/artists/${encodeURIComponent(id)}/songs?page=0&limit=${limit}`;
    }

    try {
      const response = await fetchWithTimeout(upstream, 4500);
      if (!response.ok) {
        res.json({ ok: false, fallback: true });
        return;
      }
      const json = await response.json();
      res.json({ ok: true, data: json.data ?? json });
    } catch {
      res.json({ ok: false, fallback: true });
    }
  });

  app.get('/api/music/videos', async (req, res) => {
    const query = String(req.query.query || '').trim();
    const max = Math.min(16, Math.max(1, Number(req.query.limit || 12)));
    if (!query) {
      res.json({ ok: false, results: [] });
      return;
    }

    try {
      const upstream = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      const response = await fetchWithTimeout(upstream, 4500);
      if (!response.ok) {
        res.json({ ok: false, results: [], fallback: true });
        return;
      }
      const html = await response.text();
      const results = parseYouTubeSearchHtml(html, max);
      res.json({ ok: results.length > 0, results });
    } catch {
      res.json({ ok: false, results: [], fallback: true });
    }
  });

  // User data is intentionally kept in browser localStorage. A shared server-side
  // JSON database would expose every listener's likes, playlists and preferences.
  app.get('/api/user/state', (_req, res) => {
    res.status(410).json({ ok: false, error: 'User data is stored locally in this browser.' });
  });
  app.post('/api/user/event', (_req, res) => {
    res.status(410).json({ ok: false, error: 'User data is stored locally in this browser.' });
  });
  app.post('/api/user/playlists', (_req, res) => {
    res.status(410).json({ ok: false, error: 'User data is stored locally in this browser.' });
  });
  app.post('/api/user/personalise', (_req, res) => {
    res.status(410).json({ ok: false, error: 'User data is stored locally in this browser.' });
  });

  if (mode === 'node-production') {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  // In Cloudflare mode, Workers Static Assets serves the Vite build output.
  // The Express app handles only /api/* requests and is adapted by worker/index.ts.
  return app;
}
