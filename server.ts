import express from 'express';
import path from 'node:path';
import { Readable } from 'node:stream';
import { isIP } from 'node:net';
import { isPublicAddress } from './src/utils/networkSecurity.ts';
import { fileURLToPath } from 'node:url';
import {
  decodeHtmlEntities,
  isPlausibleSongDuration,
  isRelevantSongSearchCandidate,
  isAllowedJamendoNonCommercialLicense,
  isMatchingLyricsCandidate,
  isRemixOrKnockoff,
  scoreAuthenticTrackCandidate,
  selectSaavnArtistForMatch,
} from './src/utils/playerEngine.ts';
import {
  JIOSAAVN_NATIVE_HEADERS,
  mapNativeSaavnAlbum,
  mapNativeSaavnArtist,
  mapNativeSaavnSong,
  type NativeSaavnAlbumRaw,
  type NativeSaavnArtistRaw,
  type NativeSaavnSongRaw,
  type SaavnNormalizedSong,
} from './src/utils/jiosaavnNative.ts';
import {
  buildCanonicalEditionPlan,
  type CanonicalEditionPlan,
} from './src/utils/editionSearch.ts';
import { mapSpotifyEmbedTrackList, type SpotifyEmbedTrackEntry } from './src/utils/spotifyEmbed.ts';
import { parseYouTubePlaylistContinuation, parseYouTubePlaylistPage } from './src/utils/youtubePlaylist.ts';

const SAAVN_BASE = 'https://saavn.sumit.co';
const JIOSAAVN_API_BASE = 'https://www.jiosaavn.com/api.php';

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
  sourceProvider?: string;
  sourceAvailability?: 'full' | 'preview' | 'lookup' | 'metadata';
  sourcePageUrl?: string;
  sourceLicense?: string;
  offlineAvailable?: boolean;
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
    duration: raw.length ? Math.round(raw.length / 1000) : 0,
    image: '',
    language: 'Other',
    region: 'GLOBAL',
    genre: 'MusicBrainz metadata',
    metadataOnly: true,
    sourceProvider: 'MusicBrainz',
    sourceAvailability: 'metadata',
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
    duration: raw.trackTimeMillis ? Math.round(raw.trackTimeMillis / 1000) : 0,
    image: highResArt,
    language: lang,
    region,
    genre: raw.primaryGenreName || lang,
    hasLyrics: !isInstrumentalOrSpam(title, raw.collectionName || ''),
    previewUrl: raw.previewUrl || undefined,
    sourceProvider: 'Apple Music',
    sourceAvailability: raw.previewUrl ? 'preview' : 'lookup',
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
    duration: Number(raw.duration) || 0,
    playCount: raw.rank || undefined,
    image,
    language: lang,
    region,
    genre: lang,
    hasLyrics: !isInstrumentalOrSpam(title, albumName),
    previewUrl: raw.preview || undefined,
    sourceProvider: 'Deezer',
    sourceAvailability: raw.preview ? 'preview' : 'lookup',
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

interface JamendoSearchTrackRaw {
  id?: string | number;
  name?: string;
  artist_name?: string;
  album_name?: string;
  duration?: number;
  releasedate?: string;
  image?: string;
  album_image?: string;
  audio?: string;
  shareurl?: string;
  license_ccurl?: string;
  audiodownload_allowed?: boolean;
}

interface FunkwhaleSearchTrackRaw {
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
    duration: Number(raw.duration) || 0,
    playCount: raw.play_count || undefined,
    image,
    language: lang,
    region,
    genre: raw.genre || lang,
    hasLyrics: !isInstrumentalOrSpam(title, raw.genre || ''),
    streamUrls: streamUrl ? { '160kbps': streamUrl } : undefined,
    previewUrl: streamUrl || undefined,
    sourceProvider: 'Audius',
    sourceAvailability: streamUrl ? 'full' : 'lookup',
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

async function fetchSaavnNativeSongs(
  query: string,
  page = 0,
  limit = 20,
  timeoutMs = 3500
): Promise<SaavnNormalizedSong[]> {
  try {
    const url =
      `${JIOSAAVN_API_BASE}?__call=search.getResults&q=${encodeURIComponent(query)}` +
      `&n=${limit}&p=${page + 1}&_format=json&_marker=0&api_version=4`;
    const res = await fetchWithTimeout(url, timeoutMs, JIOSAAVN_NATIVE_HEADERS);
    if (!res.ok) return [];
    const json = (await res.json()) as { results?: NativeSaavnSongRaw[] };
    const out: SaavnNormalizedSong[] = [];
    const seen = new Set<string>();
    for (const raw of json.results || []) {
      const mapped = mapNativeSaavnSong(raw);
      if (mapped && !seen.has(mapped.id)) {
        seen.add(mapped.id);
        out.push(mapped);
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function fetchSaavnSongsCombined(
  query: string,
  page = 0,
  limit = 20,
  timeoutMs = 3500
): Promise<SaavnCandidateRaw[]> {
  const [nativeSettled, sumitSettled] = await Promise.allSettled([
    fetchSaavnNativeSongs(query, page, limit, timeoutMs),
    fetchWithTimeout(
      `${SAAVN_BASE}/api/search/songs?query=${encodeURIComponent(query)}&page=${page}&limit=${limit}`,
      timeoutMs
    ).then((r) => (r.ok ? r.json() : null)),
  ]);
  const merged: SaavnCandidateRaw[] = [];
  const seenIds = new Set<string>();
  const pushItem = (item: SaavnCandidateRaw & { id?: string }) => {
    const id = String(item.id || '');
    if (id && seenIds.has(id)) return;
    if (id) seenIds.add(id);
    merged.push(item);
  };
  if (nativeSettled.status === 'fulfilled') {
    for (const item of nativeSettled.value) pushItem(item);
  }
  if (sumitSettled.status === 'fulfilled' && sumitSettled.value?.data?.results) {
    for (const item of sumitSettled.value.data.results as Array<SaavnCandidateRaw & { id?: string }>) {
      pushItem(item);
    }
  }
  return merged;
}

interface SaavnCandidateRaw {
  id?: string;
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

interface SpotifyResolvedPayload {
  kind: 'track' | 'album' | 'playlist' | 'artist';
  id: string;
  title: string;
  subtitle: string;
  image: string;
  sourceEntriesReceived: number;
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
                trackList?: SpotifyEmbedTrackEntry[];
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
    let sourceEntriesReceived = Array.isArray(entity.trackList) ? entity.trackList.length : 0;
    if (Array.isArray(entity.trackList)) {
      // Import is a user-selected action, not discovery ranking. Preserve every
      // entry exposed by Spotify, including duplicates, remixes and instrumentals.
      tracks = mapSpotifyEmbedTrackList(entity.trackList, id, title, cover, inferLanguage);
    } else if (kind === 'track' && entity.title) {
      sourceEntriesReceived = 1;
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
      subtitle: `${subtitle} · ${sourceEntriesReceived} source entries received`,
      image: cover || enrichedTracks[0]?.image || '',
      sourceEntriesReceived,
      tracks: enrichedTracks,
    };

    spotifyEmbedCache.set(key, { expiresAt: Date.now() + 15 * 60_000, data: payload });
    return payload;
  } catch {
    return null;
  }
}

function parseYouTubePlaylistId(input: string): string | null {
  const value = String(input || '').trim();
  if (/^[A-Za-z0-9_-]{10,80}$/.test(value)) return value;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'youtube.com' && host !== 'm.youtube.com' && host !== 'music.youtube.com') return null;
    if (url.pathname !== '/playlist') return null;
    const id = url.searchParams.get('list') || '';
    return /^[A-Za-z0-9_-]{10,80}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

interface YouTubePlaylistPayload {
  kind: 'playlist';
  provider: 'YouTube';
  id: string;
  title: string;
  subtitle: string;
  image: string;
  sourceEntriesReceived: number;
  sourceEntriesTotal: number;
  complete: boolean;
  tracks: StoredTrack[];
}

const youtubePlaylistCache = new Map<string, { expiresAt: number; data: YouTubePlaylistPayload }>();
const youtubePlaylistRateLimits = new Map<string, { count: number; resetAt: number }>();

function cacheYouTubePlaylist(id: string, data: YouTubePlaylistPayload): void {
  const now = Date.now();
  for (const [key, entry] of youtubePlaylistCache) {
    if (entry.expiresAt <= now) youtubePlaylistCache.delete(key);
  }
  // Keep memory bounded even if clients request many distinct public playlist IDs.
  while (youtubePlaylistCache.size >= 200) {
    const oldestKey = youtubePlaylistCache.keys().next().value;
    if (!oldestKey) break;
    youtubePlaylistCache.delete(oldestKey);
  }
  youtubePlaylistCache.set(id, { expiresAt: now + 10 * 60_000, data });
}

async function fetchYouTubePlaylist(id: string): Promise<YouTubePlaylistPayload | null> {
  const cached = youtubePlaylistCache.get(id);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  try {
    const response = await fetchWithTimeout(
      `https://www.youtube.com/playlist?list=${encodeURIComponent(id)}`,
      9000,
      { Accept: 'text/html,application/xhtml+xml' }
    );
    if (!response.ok) return null;
    const html = await response.text();
    if (html.length > 12 * 1024 * 1024) return null;
    const parsed = parseYouTubePlaylistPage(html);
    if (!parsed) return null;

    const entries = [...parsed.entries];
    const seen = new Set(entries.map((entry) => entry.videoId));
    let continuationToken = parsed.continuationToken;
    let continuationPages = 0;
    const maxContinuationPages = 9;
    const maxPlaylistEntries = 500;
    const clientVersion = parsed.clientVersion || '2.20250101.00.00';

    // YouTube's public continuation interface is undocumented. Bound the number
    // of requests and total entries; if the format changes, keep the valid first page.
    while (continuationToken && continuationPages < maxContinuationPages && entries.length < maxPlaylistEntries) {
      continuationPages += 1;
      let parsedContinuation: ReturnType<typeof parseYouTubePlaylistContinuation>;
      try {
        const continuationController = new AbortController();
        const continuationTimeout = setTimeout(() => continuationController.abort(), 7000);
        let continuationResponse: Response;
        try {
          continuationResponse = await fetch(
            'https://www.youtube.com/youtubei/v1/browse?prettyPrint=false',
            {
              method: 'POST',
              signal: continuationController.signal,
              headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                Origin: 'https://www.youtube.com',
                Referer: `https://www.youtube.com/playlist?list=${encodeURIComponent(id)}`,
              },
              body: JSON.stringify({
                context: { client: { clientName: 'WEB', clientVersion } },
                continuation: continuationToken,
              }),
            }
          );
        } finally {
          clearTimeout(continuationTimeout);
        }
        if (!continuationResponse.ok) break;
        const continuationPayload: unknown = await continuationResponse.json();
        parsedContinuation = parseYouTubePlaylistContinuation(continuationPayload);
      } catch {
        // A blocked or timed-out continuation should not discard the readable first page.
        break;
      }
      for (const entry of parsedContinuation.entries) {
        if (seen.has(entry.videoId)) continue;
        seen.add(entry.videoId);
        entries.push(entry);
        if (entries.length >= maxPlaylistEntries) break;
      }
      if (!parsedContinuation.entries.length || parsedContinuation.continuationToken === continuationToken) break;
      continuationToken = parsedContinuation.continuationToken;
    }

    const tracks: StoredTrack[] = entries.map((entry) => ({
      id: `yt-${entry.videoId}`,
      name: entry.title,
      artist: entry.channel,
      albumName: parsed.title,
      duration: entry.duration,
      image: entry.image,
      language: inferLanguage(entry.title),
      genre: 'YouTube Playlist',
      metadataOnly: true,
      sourceProvider: 'YouTube',
      sourceAvailability: 'metadata',
      sourcePageUrl: `https://www.youtube.com/watch?v=${entry.videoId}`,
    }));
    const hasMore = Boolean(continuationToken) || continuationPages >= maxContinuationPages || entries.length >= maxPlaylistEntries;
    const data: YouTubePlaylistPayload = {
      kind: 'playlist',
      provider: 'YouTube',
      id,
      title: parsed.title,
      subtitle: `${entries.length} entries received${hasMore ? ' · playlist may be incomplete' : ''}`,
      image: parsed.image || tracks[0]?.image || '',
      sourceEntriesReceived: entries.length,
      sourceEntriesTotal: entries.length,
      complete: !hasMore,
      tracks,
    };
    cacheYouTubePlaylist(id, data);
    return data;
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
      let upstream: Response;
      try {
        upstream = await fetchPublicHttpsUrl(rawUrl, 12000, headers);
      } catch (firstErr) {
        if (req.closed) throw firstErr;
        upstream = await fetchPublicHttpsUrl(rawUrl, 12000, headers);
      }
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

  const SC_CLIENT_ID = 'qLcgHhXgeEFFaSolTB9I71LBsqncsD93';

  interface SoundCloudTrackRaw {
    id: number;
    title?: string;
    duration?: number;
    permalink_url?: string;
    artwork_url?: string;
    user?: { username?: string };
    media?: {
      transcodings?: Array<{
        preset?: string;
        format?: { protocol?: string; mime_type?: string };
        url?: string;
      }>;
    };
  }

  async function fetchSoundCloudTracks(query: string, limit = 10): Promise<StoredTrack[]> {
    try {
      const res = await fetchWithTimeout(
        `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&client_id=${SC_CLIENT_ID}&limit=${limit}`,
        3500
      );
      if (!res.ok) return [];
      const json = (await res.json()) as { collection?: SoundCloudTrackRaw[] };
      const items = json.collection || [];
      const out: StoredTrack[] = [];
      for (const item of items) {
        if (!item.id || !item.title) continue;
        const durationSec = Math.round((item.duration || 0) / 1000);
        if (durationSec < 45 || durationSec > 1800) continue;
        const titleParts = item.title.split(/[-–—]|(?:\s+by\s+)/i).map((s) => s.trim()).filter(Boolean);
        let name = item.title;
        let artist = item.user?.username || 'SoundCloud Artist';
        if (titleParts.length >= 2 && item.title.includes('-')) {
          artist = titleParts[0];
          name = titleParts.slice(1).join(' - ');
        }
        const artwork = (item.artwork_url || '').replace('-large.', '-t500x500.');
        out.push({
          id: `sc-${item.id}`,
          name: decodeHtmlEntities(name),
          artist: decodeHtmlEntities(artist),
          albumName: 'SoundCloud Release',
          duration: durationSec,
          image: artwork,
          streamUrls: { '160kbps': `/api/music/soundcloud/audio?id=${item.id}` },
          sourceProvider: 'SoundCloud',
          sourceAvailability: 'full',
          sourcePageUrl: item.permalink_url,
          // SoundCloud availability does not grant permission to store offline copies.
          offlineAvailable: false,
        });
      }
      return out;
    } catch {
      return [];
    }
  }

  app.get('/api/music/soundcloud/audio', async (req, res) => {
    const trackId = String(req.query.id || '').trim();
    if (!trackId) {
      res.status(400).end();
      return;
    }
    try {
      const trackRes = await fetchWithTimeout(
        `https://api-v2.soundcloud.com/tracks/${encodeURIComponent(trackId)}?client_id=${SC_CLIENT_ID}`,
        4000
      );
      if (!trackRes.ok) {
        res.status(404).end();
        return;
      }
      const track = (await trackRes.json()) as SoundCloudTrackRaw;
      const hlsTc =
        track.media?.transcodings?.find((x) => x.preset === 'aac_160k' && x.format?.protocol === 'hls') ||
        track.media?.transcodings?.find((x) => x.preset === 'aac_96k' && x.format?.protocol === 'hls') ||
        track.media?.transcodings?.find((x) => x.format?.protocol === 'hls');
      if (!hlsTc?.url) {
        res.status(404).end();
        return;
      }
      const resolvedRes = await fetchWithTimeout(`${hlsTc.url}?client_id=${SC_CLIENT_ID}`, 3500);
      if (!resolvedRes.ok) {
        res.status(502).end();
        return;
      }
      const resolvedJson = (await resolvedRes.json()) as { url?: string };
      const playlistUrl = resolvedJson.url;
      if (!playlistUrl) {
        res.status(502).end();
        return;
      }
      const playlistRes = await fetchWithTimeout(playlistUrl, 4000);
      if (!playlistRes.ok) {
        res.status(502).end();
        return;
      }
      const m3u8 = await playlistRes.text();
      const mapMatch = m3u8.match(/#EXT-X-MAP:URI="([^"]+)"/);
      const mapUrl = mapMatch ? mapMatch[1] : null;
      const segUrls = m3u8
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('https://'));

      res.setHeader('Content-Type', 'audio/mp4');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'no-store');

      if (mapUrl) {
        const mapRes = await fetch(mapUrl);
        if (mapRes.ok && mapRes.body) {
          const buf = Buffer.from(await mapRes.arrayBuffer());
          res.write(buf);
        }
      }
      for (const segUrl of segUrls) {
        if (res.writableEnded) break;
        try {
          const segRes = await fetch(segUrl);
          if (segRes.ok && segRes.body) {
            const buf = Buffer.from(await segRes.arrayBuffer());
            res.write(buf);
          }
        } catch {
          // Skip failed segment
        }
      }
      res.end();
    } catch {
      if (!res.headersSent) res.status(502).end();
      else res.end();
    }
  });

  // Direct audio download proxy endpoint (forces attachment download with clean filename)
  app.get('/api/music/download', async (req, res) => {
    const rawUrl = String(req.query.url || '').trim();
    const rawName = String(req.query.filename || 'harmonia-track').trim().replace(/["\\/]/g, '_');
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
      const upstreamType = (upstream.headers.get('content-type') || 'audio/mpeg').toLowerCase();
      const inferredExt = upstreamType.includes('mp4') || upstreamType.includes('aac')
        ? 'm4a'
        : upstreamType.includes('ogg')
          ? 'ogg'
          : upstreamType.includes('wav')
            ? 'wav'
            : 'mp3';
      const finalName = /\.(mp3|m4a|aac|ogg|opus|wav|flac)$/i.test(rawName)
        ? rawName
        : `${rawName}.${inferredExt}`;
      res.setHeader('Content-Type', upstreamType);
      res.setHeader('Content-Disposition', `attachment; filename="${finalName}"`);
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
    sourceProvider?: string;
    sourceAvailability?: 'full' | 'preview' | 'lookup';
    sourcePageUrl?: string;
    sourceLicense?: string;
    offlineAvailable?: boolean;
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
      (Object.keys(freshCached.payload.streamUrls).length > 0 || Boolean(freshCached.payload.previewUrl))
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
    let resolvedSourceProvider: string | undefined;
    let previewSourceProvider: string | undefined;
    let resolvedSourcePageUrl: string | undefined;
    let resolvedSourceLicense: string | undefined;
    let resolvedOfflineAvailable: boolean | undefined;

  interface JamendoTrackRaw {
    id?: string;
    name?: string;
    artist_name?: string;
    audio?: string;
    duration?: number;
    shareurl?: string;
    license_ccurl?: string;
    audiodownload_allowed?: boolean;
  }

  interface JamendoResolvedStream {
    url: string;
    sourcePageUrl: string;
    sourceLicense: string;
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
  ): Promise<JamendoResolvedStream | undefined> {
    try {
      const q = `${cleanTitle} ${primaryArtist}`.trim();
      const res = await fetchWithTimeout(
        `https://api.jamendo.com/v3.0/tracks/?client_id=5c361a6b&format=json&limit=6&audioformat=mp32&include=licenses&ccnc=true&search=${encodeURIComponent(q)}`,
        3500
      );
      if (!res.ok) return undefined;
      const json = (await res.json()) as { results?: JamendoTrackRaw[] };
      if (!Array.isArray(json.results) || json.results.length === 0) return undefined;

      const scored = json.results
        .map((item) => {
          const audio = String(item.audio || '').trim();
          const sourcePageUrl = String(item.shareurl || '').trim().replace(/^http:/i, 'https:');
          const sourceLicense = String(item.license_ccurl || '').trim().replace(/^http:/i, 'https:');
          if (
            !audio ||
            !isAllowedJamendoNonCommercialLicense(sourceLicense)
          ) return null;

          let safeAudioUrl = '';
          let safePageUrl = '';
          try {
            const audioTarget = new URL(audio);
            const page = new URL(sourcePageUrl);
            if (
              audioTarget.protocol !== 'https:' ||
              !audioTarget.hostname.toLowerCase().endsWith('.jamendo.com') ||
              page.protocol !== 'https:' ||
              page.hostname !== 'www.jamendo.com' ||
              !page.pathname.startsWith('/track/')
            ) return null;
            safeAudioUrl = audioTarget.toString();
            safePageUrl = page.toString();
          } catch {
            return null;
          }

          const duration = Number(item.duration || 0);
          const score = scoreAuthenticTrackCandidate({
            itemTitle: item.name || '',
            itemArtist: item.artist_name || '',
            requestedTitle: cleanTitle,
            requestedArtist: primaryArtist,
            itemDurationSec: duration,
            targetDurationSec,
          });
          if (score === null) return null;
          return {
            url: safeAudioUrl,
            sourcePageUrl: safePageUrl,
            sourceLicense,
            score,
          };
        })
        .filter((item): item is JamendoResolvedStream & { score: number } => item !== null)
        .sort((a, b) => b.score - a.score);

      return scored[0]
        ? {
            url: scored[0].url,
            sourcePageUrl: scored[0].sourcePageUrl,
            sourceLicense: scored[0].sourceLicense,
          }
        : undefined;
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
          // Search both the combined query and title-only variants across both
          // JioSaavn's regional-IN catalogue and the public mirror so tracks
          // licensed in IN (such as J-Pop releases) still resolve full streams.
          const saavnQueries = [...new Set([
            query,
            `${primaryArtist} ${cleanTitle}`.trim(),
            cleanTitle,
          ].filter(Boolean))];
          const responses = await Promise.allSettled(
            saavnQueries.map((term) => fetchSaavnSongsCombined(term, 0, 12, 4200))
          );
          const seen = new Set<string>();
          const results: SaavnCandidateRaw[] = [];
          for (const response of responses) {
            if (response.status !== 'fulfilled') continue;
            for (const item of response.value) {
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
      if (Object.values(streamUrls).some(Boolean)) resolvedSourceProvider = 'JioSaavn';
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
          resolvedSourceProvider = 'Audius';
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
        resolvedSourceProvider = 'Internet Archive';
        internetArchiveSelected = true;
      }
    }

    if (!Object.values(streamUrls).some(Boolean)) {
      // Do not mix lower-priority fallback streams into a track that already
      // has an exact primary-catalogue match.
      const jamendoCandidate =
        jamendoSettled.status === 'fulfilled' ? jamendoSettled.value : undefined;
      const funkwhaleCandidate =
        funkwhaleSettled.status === 'fulfilled' ? funkwhaleSettled.value : undefined;
      if (jamendoCandidate) {
        streamUrls['160kbps'] = jamendoCandidate.url;
        fullAlternates.push(jamendoCandidate.url);
        resolvedSourceProvider = 'Jamendo';
        resolvedSourcePageUrl = jamendoCandidate.sourcePageUrl;
        resolvedSourceLicense = jamendoCandidate.sourceLicense;
        resolvedOfflineAvailable = false;
      } else if (funkwhaleCandidate) {
        streamUrls['160kbps'] = funkwhaleCandidate;
        fullAlternates.push(funkwhaleCandidate);
        resolvedSourceProvider = 'Funkwhale';
      } else {
        const scTracks = await fetchSoundCloudTracks(query, 6);
        const bestSc = scTracks
          .map((t) => ({
            t,
            score: scoreAuthenticTrackCandidate({
              itemTitle: t.name,
              itemArtist: t.artist,
              requestedTitle: cleanTitle,
              requestedArtist: primaryArtist,
              itemDurationSec: t.duration,
              targetDurationSec,
            }),
          }))
          .filter((x): x is { t: StoredTrack; score: number } => x.score !== null)
          .sort((a, b) => b.score - a.score)[0]?.t;
        if (bestSc?.streamUrls?.['160kbps']) {
          streamUrls['160kbps'] = bestSc.streamUrls['160kbps'];
          fullAlternates.push(bestSc.streamUrls['160kbps']);
          resolvedSourceProvider = 'SoundCloud';
          resolvedSourcePageUrl = bestSc.sourcePageUrl;
          resolvedOfflineAvailable = false;
        }
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
        if (!previewUrl) {
          previewUrl = bestDz.preview;
          previewSourceProvider = 'Deezer';
        }
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
        if (!previewUrl) {
          previewUrl = bestIt.previewUrl;
          previewSourceProvider = 'Apple Music';
        }
        previewAlternates.push(bestIt.previewUrl);
      }
    }

    // YouTube is offered only through the user-initiated video viewer.
    // Do not resolve YouTube IDs into the hidden audio engine: that would
    // rely on unofficial search endpoints and could enable background audio.

    const payload: StreamResolvePayload = {
      streamUrls,
      previewUrl,
      alternates: Array.from(new Set([...fullAlternates, ...previewAlternates])),
      sourceProvider: resolvedSourceProvider || previewSourceProvider,
      sourceAvailability: resolvedSourceProvider ? 'full' : previewUrl ? 'preview' : 'lookup',
      sourcePageUrl: resolvedSourcePageUrl,
      sourceLicense: resolvedSourceLicense,
      offlineAvailable: resolvedOfflineAvailable,
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
    if (Object.keys(streamUrls).length > 0 && resolvedSourceProvider !== 'Jamendo') {
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

  // Public YouTube playlist import via the official Data API. No user login is required.
  app.get('/api/music/youtube/playlist', async (req, res) => {
    const now = Date.now();
    const clientKey = req.get('cf-connecting-ip') || req.ip || req.socket.remoteAddress || 'unknown';
    let bucket = youtubePlaylistRateLimits.get(clientKey);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + 60_000 };
      youtubePlaylistRateLimits.set(clientKey, bucket);
    }
    bucket.count += 1;
    if (bucket.count > 20) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      res.status(429).json({ ok: false, error: 'Too many playlist import requests. Please retry shortly.' });
      return;
    }
    if (youtubePlaylistRateLimits.size > 10_000) {
      for (const [client, limit] of youtubePlaylistRateLimits) {
        if (limit.resetAt <= now) youtubePlaylistRateLimits.delete(client);
        if (youtubePlaylistRateLimits.size <= 8_000) break;
      }
    }
    const id = parseYouTubePlaylistId(String(req.query.url || req.query.id || ''));
    if (!id) {
      res.status(400).json({ ok: false, error: 'Invalid YouTube playlist link' });
      return;
    }
    const playlist = await fetchYouTubePlaylist(id);
    if (!playlist) {
      res.status(502).json({
        ok: false,
        error: 'YouTube did not provide readable public playlist data. The playlist may be private, unavailable, or temporarily blocked.',
      });
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({ ok: true, ...playlist });
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
          trackName?: string;
          artistName?: string;
          duration?: number;
          instrumental?: boolean;
          syncedLyrics?: string;
          plainLyrics?: string;
        };
        const exactMatch = isMatchingLyricsCandidate(data, title, artist, duration);
        if (exactMatch && data.instrumental) {
          res.json({ ok: true, hasLyrics: false, synced: false, lines: [] });
          return;
        }
        if (exactMatch && data.syncedLyrics) {
          const lines = parseLrcText(data.syncedLyrics);
          if (lines.length) {
            res.json({ ok: true, hasLyrics: true, synced: true, lines });
            return;
          }
        }
        if (exactMatch && data.plainLyrics) {
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
          trackName?: string;
          artistName?: string;
          duration?: number;
          instrumental?: boolean;
          syncedLyrics?: string;
          plainLyrics?: string;
        }>;
        const firstWithLyrics = list.find(
          (item) =>
            !item.instrumental &&
            isMatchingLyricsCandidate(item, title, artist, duration) &&
            (item.syncedLyrics || item.plainLyrics)
        );
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

  // Multi-source search: JioSaavn, Apple Music, Deezer, Audius,
  // Jamendo, Funkwhale, plus opt-in MusicBrainz catalogue metadata.
  app.get('/api/music/search', async (req, res) => {
    const type = String(req.query.type || 'songs');
    const query = String(req.query.query || '').trim();
    const region = String(req.query.region || 'IN').toUpperCase();
    const page = Math.max(0, Math.floor(Number(req.query.page || 0)));
    const limit = Math.min(30, Math.max(1, Number(req.query.limit || 20)));

    if (!query) {
      res.status(400).json({ ok: false, error: 'Missing query parameter' });
      return;
    }

    if (type === 'songs') {
      const country = region === 'JP' ? 'JP' : region === 'US' ? 'US' : region === 'GB' ? 'GB' : 'IN';
      const offset = page * limit;
      const catalogueRequested = String(req.query.catalogue || '') === '1';

      const audiusPromise = Promise.allSettled([
        fetchWithTimeout(
          'https://api.audius.co/v1/tracks/search?query=' + encodeURIComponent(query) +
          '&limit=' + limit + '&offset=' + offset,
          3200
        ).then((r) => r.ok ? r.json() : null),
        fetchWithTimeout(
          'https://discoveryprovider.audius.co/v1/tracks/search?query=' + encodeURIComponent(query) +
          '&limit=' + limit + '&offset=' + offset,
          3200
        ).then((r) => r.ok ? r.json() : null),
      ]).then((settled) => {
        const seen = new Set<string>();
        const tracks: AudiusTrackRaw[] = [];
        for (const result of settled) {
          if (result.status !== 'fulfilled' || !Array.isArray(result.value?.data)) continue;
          for (const track of result.value.data as AudiusTrackRaw[]) {
            const id = String(track.id || '');
            if (id && !seen.has(id)) {
              seen.add(id);
              tracks.push(track);
            }
          }
        }
        return tracks;
      });

      const [saavnResult, itunesResult, deezerResult, audiusResult, jamendoResult, funkwhaleResult, soundcloudResult, catalogueResult] =
        await Promise.allSettled([
          fetchSaavnSongsCombined(query, page, limit, 3400),
          fetchWithTimeout(
            'https://itunes.apple.com/search?term=' + encodeURIComponent(query) +
            '&country=' + country + '&media=music&entity=song&limit=' + limit + '&offset=' + offset,
            3200
          ).then((r) => r.ok ? r.json() : null),
          fetchWithTimeout(
            'https://api.deezer.com/search?q=' + encodeURIComponent(query) +
            '&index=' + offset + '&limit=' + limit,
            3200
          ).then((r) => r.ok ? r.json() : null),
          audiusPromise,
          fetchWithTimeout(
            'https://api.jamendo.com/v3.0/tracks/?client_id=5c361a6b&format=json&limit=' +
            limit + '&offset=' + offset + '&search=' + encodeURIComponent(query) +
            '&imagesize=300&audioformat=mp32&include=licenses&ccnc=true',
            3200
          ).then((r) => r.ok ? r.json() : null),
          Promise.allSettled(
            ['https://open.audio', 'https://demo.funkwhale.audio'].map(async (pod) => {
              const endpoint = pod + '/api/v1/tracks/?q=' + encodeURIComponent(query) +
                '&page_size=' + limit + '&page=' + (page + 1);
              const response = await fetchWithTimeout(endpoint, 3200);
              if (!response.ok) return [];
              const json = await response.json() as { results?: FunkwhaleSearchTrackRaw[] };
              return (json.results || []).map((track) => ({ track, pod }));
            })
          ).then((results) => results.flatMap((result) =>
            result.status === 'fulfilled' ? result.value : []
          )),
          fetchSoundCloudTracks(query, limit),
          catalogueRequested
            ? fetchMusicBrainzJson(
                'https://musicbrainz.org/ws/2/recording/?query=' + encodeURIComponent(query) +
                '&fmt=json&limit=' + limit + '&offset=' + offset + '&inc=releases'
              )
            : Promise.resolve(null),
        ]);

      const saavnRaw = (
        saavnResult.status === 'fulfilled' ? saavnResult.value : []
      ).filter((item) => {
        const primary = (item.artists?.primary || []).map((artist) => artist.name || '').join(', ');
        return !isRemixOrKnockoff(item.name || '', query, primary, query);
      });

      const itunesRaw = itunesResult.status === 'fulfilled' && itunesResult.value
        ? (itunesResult.value.results || []) as ItunesTrackRaw[]
        : [];
      const deezerRaw = deezerResult.status === 'fulfilled' && deezerResult.value
        ? (deezerResult.value.data || []) as DeezerTrackRaw[]
        : [];
      const audiusRaw = audiusResult.status === 'fulfilled' ? audiusResult.value : [];
      const jamendoRaw = jamendoResult.status === 'fulfilled' && jamendoResult.value
        ? (jamendoResult.value.results || []) as JamendoSearchTrackRaw[]
        : [];
      const funkwhaleRaw = funkwhaleResult.status === 'fulfilled' ? funkwhaleResult.value : [];
      const soundcloudTracks = (
        soundcloudResult.status === 'fulfilled' ? soundcloudResult.value : []
      ).filter((track) => {
        return (
          isPlausibleSongDuration(track.duration) &&
          isRelevantSongSearchCandidate(track.name, track.artist, query) &&
          !isRemixOrKnockoff(track.name + ' ' + track.albumName, query, track.artist, query)
        );
      });
      const musicBrainzRecordings = catalogueRequested && catalogueResult.status === 'fulfilled'
        ? (catalogueResult.value?.recordings || []) as MusicBrainzRecordingRaw[]
        : [];

      const itunesTracks = itunesRaw
        .map((item) => mapItunesTrack(item, country))
        .filter(
          (track) =>
            !isInstrumentalOrSpam(track.name, track.albumName) &&
            !isRemixOrKnockoff(track.name + ' ' + track.albumName, query, track.artist, query)
        );

      const deezerTracks = deezerRaw
        .filter(
          (item) =>
            !isInstrumentalOrSpam(item.title || item.title_short || '', item.album?.title || '') &&
            !isRemixOrKnockoff(
              (item.title || item.title_short || '') + ' ' + (item.album?.title || ''),
              query,
              item.artist?.name || '',
              query
            )
        )
        .map((item) => mapDeezerTrack(item, country));

      const audiusTracks = audiusRaw
        .filter((item) => (item.duration || 0) >= 75)
        .map((item) => mapAudiusTrack(item, country))
        .filter(
          (track) =>
            Boolean(track.image) &&
            !isInstrumentalOrSpam(track.name, track.albumName) &&
            !isRemixOrKnockoff(track.name + ' ' + track.albumName, query, track.artist, query)
        );

      const jamendoTracks = jamendoRaw
        .map((item): StoredTrack | null => {
          const title = String(item.name || '').trim();
          const artist = String(item.artist_name || '').trim();
          const duration = Number(item.duration || 0);
          const audio = String(item.audio || '').trim();
          const pageUrl = String(item.shareurl || '').trim().replace(/^http:/i, 'https:');
          const licenseUrl = String(item.license_ccurl || '').trim().replace(/^http:/i, 'https:');
          let safePageUrl = '';
          let safeAudioUrl = '';
          try {
            const page = new URL(pageUrl);
            const audioTarget = new URL(audio);
            if (
              page.protocol !== 'https:' ||
              page.hostname !== 'www.jamendo.com' ||
              !page.pathname.startsWith('/track/') ||
              audioTarget.protocol !== 'https:' ||
              !audioTarget.hostname.toLowerCase().endsWith('.jamendo.com')
            ) return null;
            safePageUrl = page.toString();
            safeAudioUrl = audioTarget.toString();
          } catch {
            return null;
          }
          if (
            !title ||
            !artist ||
            !safeAudioUrl ||
            !isPlausibleSongDuration(duration) ||
            !isAllowedJamendoNonCommercialLicense(licenseUrl)
          ) return null;
          if (
            !isRelevantSongSearchCandidate(title, artist, query) ||
            isRemixOrKnockoff(title, query, artist, query)
          ) return null;
          return {
            id: 'jamendo-' + String(item.id || title + '-' + artist),
            name: title,
            artist,
            albumName: String(item.album_name || 'Jamendo Release'),
            year: item.releasedate?.slice(0, 4),
            duration,
            image: String(item.album_image || item.image || ''),
            language: inferLanguage(title + ' ' + artist, ''),
            region: 'GLOBAL',
            genre: 'Jamendo',
            streamUrls: { '160kbps': safeAudioUrl },
            sourceProvider: 'Jamendo',
            sourceAvailability: 'full',
            sourcePageUrl: safePageUrl,
            sourceLicense: licenseUrl,
            offlineAvailable: false,
          };
        })
        .filter((track): track is StoredTrack => track !== null);

      const funkwhaleTracks = funkwhaleRaw
        .map(({ track, pod }): StoredTrack | null => {
          const title = String(track.title || track.name || '').trim();
          const artist = String(
            track.artist_name ||
            track.artists?.map((entry) => String(entry.name || '').trim()).filter(Boolean).join(', ') ||
            ''
          ).trim();
          const duration = Number(track.duration || 0);
          const listenPath =
            track.listen_url ||
            track.uploads?.find((entry) => entry.listen_url)?.listen_url ||
            track.uploads?.find((entry) => entry.audio_file?.listen_url)?.audio_file?.listen_url ||
            '';
          if (
            !title || !artist || !listenPath || track.is_playable === false ||
            !isPlausibleSongDuration(duration)
          ) return null;

          if (
            !isRelevantSongSearchCandidate(title, artist, query) ||
            isRemixOrKnockoff(title, query, artist, query)
          ) return null;

          let streamUrl = '';
          try {
            const parsed = new URL(listenPath, pod);
            if (parsed.protocol !== 'https:' || parsed.origin !== pod) return null;
            streamUrl = parsed.toString();
          } catch {
            return null;
          }

          return {
            id: 'funkwhale-' + String(track.id || title + '-' + artist),
            name: title,
            artist,
            albumName: String(track.album?.title || 'Funkwhale Release'),
            duration,
            image: String(track.album?.cover_url || track.album?.cover || track.cover || ''),
            language: inferLanguage(title + ' ' + artist, ''),
            region: 'GLOBAL',
            genre: 'Funkwhale',
            hasLyrics: true,
            streamUrls: { '160kbps': streamUrl },
            sourceProvider: 'Funkwhale',
            sourceAvailability: 'full',
          };
        })
        .filter((track): track is StoredTrack => track !== null);

      const hasDirectMatch =
        (/[^\x00-\x7f]/.test(query) &&
          (saavnRaw.length > 0 || itunesTracks.length > 0 || deezerTracks.length > 0)) ||
        saavnRaw.some((item) => {
          const primary = (item.artists?.primary || []).map((a) => a.name || '').join(', ');
          return isRelevantSongSearchCandidate(item.name || '', primary, query);
        }) ||
        itunesTracks.some((t) => isRelevantSongSearchCandidate(t.name, t.artist, query)) ||
        deezerTracks.some((t) => isRelevantSongSearchCandidate(t.name, t.artist, query)) ||
        audiusTracks.some((t) => isRelevantSongSearchCandidate(t.name, t.artist, query)) ||
        jamendoTracks.some((t) => isRelevantSongSearchCandidate(t.name, t.artist, query)) ||
        funkwhaleTracks.some((t) => isRelevantSongSearchCandidate(t.name, t.artist, query));

      let editionPlan: CanonicalEditionPlan | undefined;
      if (!hasDirectMatch && page === 0 && query.split(/\s+/).filter(Boolean).length >= 2) {
        let videoHints: ParsedVideoItem[] = [];
        try {
          const ytRes = await fetchWithTimeout(
            `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
            2200
          );
          if (ytRes.ok) {
            const ytHtml = await ytRes.text();
            videoHints = parseYouTubeSearchHtml(ytHtml, 6);
          }
        } catch {
          // Proceed with pure query-stripping fallback if YouTube is slow/unreachable.
        }

        editionPlan = buildCanonicalEditionPlan(query, videoHints);
        const canonicalTargets = editionPlan.canonicalQueries.slice(0, 2);
        if (canonicalTargets.length > 0) {
          const fallbackSettled = await Promise.allSettled(
            canonicalTargets.map(async (canonQuery) => {
              const [cSaavn, cItunes, cDeezer] = await Promise.allSettled([
                fetchSaavnSongsCombined(canonQuery, 0, Math.min(limit, 12), 2500),
                fetchWithTimeout(
                  'https://itunes.apple.com/search?term=' + encodeURIComponent(canonQuery) +
                  '&country=' + country + '&media=music&entity=song&limit=10',
                  2200
                ).then((r) => (r.ok ? r.json() : null)),
                fetchWithTimeout(
                  'https://api.deezer.com/search?q=' + encodeURIComponent(canonQuery) + '&limit=10',
                  2200
                ).then((r) => (r.ok ? r.json() : null)),
              ]);
              return {
                canonQuery,
                saavn: cSaavn.status === 'fulfilled' ? cSaavn.value : [],
                itunes:
                  cItunes.status === 'fulfilled' && cItunes.value
                    ? ((cItunes.value.results || []) as ItunesTrackRaw[])
                    : [],
                deezer:
                  cDeezer.status === 'fulfilled' && cDeezer.value
                    ? ((cDeezer.value.data || []) as DeezerTrackRaw[])
                    : [],
              };
            })
          );

          const seenSaavnIds = new Set(saavnRaw.map((s) => s.id).filter(Boolean));
          const seenItunesIds = new Set(itunesTracks.map((t) => t.id));
          const seenDeezerIds = new Set(deezerTracks.map((t) => t.id));

          for (const entry of fallbackSettled) {
            if (entry.status !== 'fulfilled') continue;
            const { canonQuery, saavn, itunes, deezer } = entry.value;
            for (const item of saavn) {
              if (!item.id || seenSaavnIds.has(item.id)) continue;
              const primary = (item.artists?.primary || []).map((a) => a.name || '').join(', ');
              if (isRemixOrKnockoff(item.name || '', canonQuery, primary, canonQuery)) continue;
              seenSaavnIds.add(item.id);
              saavnRaw.push(item);
            }
            for (const rawItem of itunes) {
              const mapped = mapItunesTrack(rawItem, country);
              if (seenItunesIds.has(mapped.id)) continue;
              if (
                isInstrumentalOrSpam(mapped.name, mapped.albumName) ||
                isRemixOrKnockoff(mapped.name + ' ' + mapped.albumName, canonQuery, mapped.artist, canonQuery)
              ) continue;
              seenItunesIds.add(mapped.id);
              itunesTracks.push(mapped);
            }
            for (const rawItem of deezer) {
              const mapped = mapDeezerTrack(rawItem, country);
              if (seenDeezerIds.has(mapped.id)) continue;
              if (
                isInstrumentalOrSpam(mapped.name, mapped.albumName) ||
                isRemixOrKnockoff(mapped.name + ' ' + mapped.albumName, canonQuery, mapped.artist, canonQuery)
              ) continue;
              seenDeezerIds.add(mapped.id);
              deezerTracks.push(mapped);
            }
          }
        }
      }

      res.setHeader('Cache-Control', 'no-store');
      res.json({
        ok:
          saavnRaw.length > 0 ||
          itunesTracks.length > 0 ||
          deezerTracks.length > 0 ||
          audiusTracks.length > 0 ||
          jamendoTracks.length > 0 ||
          funkwhaleTracks.length > 0 ||
          soundcloudTracks.length > 0 ||
          musicBrainzRecordings.length > 0,
        data: {
          results: saavnRaw,
          itunesTracks,
          deezerTracks,
          audiusTracks,
          jamendoTracks,
          funkwhaleTracks,
          soundcloudTracks,
          musicBrainzRecordings,
          ...(editionPlan ? { editionPlan } : {}),
        },
      });
      return;
    }

    const allowed = new Set(['albums', 'playlists', 'artists']);
    const safeType = allowed.has(type) ? type : 'albums';
    const dzEndpoint =
      safeType === 'artists' ? 'artist' : safeType === 'playlists' ? 'playlist' : 'album';

    const nativeSearchCall =
      safeType === 'artists'
        ? 'search.getArtistResults'
        : safeType === 'playlists'
          ? 'search.getPlaylistResults'
          : 'search.getAlbumResults';

    const [saavnSettled, nativeSaavnSettled, deezerSettled, musicBrainzSettled] = await Promise.allSettled([
      fetchWithTimeout(
        `${SAAVN_BASE}/api/search/${safeType}?query=${encodeURIComponent(query)}&page=${page}&limit=${limit}`,
        4500
      ).then((r) => (r.ok ? r.json() : null)),
      fetchWithTimeout(
        `${JIOSAAVN_API_BASE}?__call=${nativeSearchCall}&q=${encodeURIComponent(query)}&n=${limit}&p=${page + 1}&_format=json&_marker=0&api_version=4`,
        4000,
        JIOSAAVN_NATIVE_HEADERS
      ).then((r) => (r.ok ? r.json() : null)),
      fetchWithTimeout(
        `https://api.deezer.com/search/${dzEndpoint}?q=${encodeURIComponent(query)}&limit=8`,
        4000
      ).then((r) => (r.ok ? r.json() : null)),
      safeType === 'artists'
        ? fetchMusicBrainzJson('https://musicbrainz.org/ws/2/artist/?query=' + encodeURIComponent(query) + '&fmt=json&limit=8')
        : Promise.resolve(null),
    ]);

    const saavnMirrorData =
      saavnSettled.status === 'fulfilled' && saavnSettled.value
        ? (saavnSettled.value.data ?? saavnSettled.value)
        : { results: [] };
    const nativeResultsRaw =
      nativeSaavnSettled.status === 'fulfilled' && nativeSaavnSettled.value?.results
        ? (nativeSaavnSettled.value.results as Array<NativeSaavnAlbumRaw & NativeSaavnArtistRaw>)
        : [];
    const nativeMapped =
      safeType === 'artists'
        ? nativeResultsRaw.map(mapNativeSaavnArtist).filter(Boolean)
        : safeType === 'albums'
          ? nativeResultsRaw.map(mapNativeSaavnAlbum).filter(Boolean)
          : [];
    const saavnResultsMerged: Array<{ id?: string; [k: string]: unknown }> = [];
    const seenSaavnCollectionIds = new Set<string>();
    for (const item of [...(saavnMirrorData?.results || []), ...nativeMapped]) {
      if (!item || typeof item !== 'object') continue;
      const cid = String((item as { id?: string }).id || '');
      if (cid && seenSaavnCollectionIds.has(cid)) continue;
      if (cid) seenSaavnCollectionIds.add(cid);
      saavnResultsMerged.push(item as { id?: string; [k: string]: unknown });
    }
    const saavnData = { ...saavnMirrorData, results: saavnResultsMerged };
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
    const page = Math.max(0, Math.floor(Number(req.query.page || 0)));
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
        'https://musicbrainz.org/ws/2/recording/?query=' +
          encodeURIComponent('arid:' + mbid) +
          '&fmt=json&limit=' +
          limit +
          '&offset=' +
          page * limit
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
            ? `https://api.deezer.com/artist/${encodeURIComponent(dzId)}/top?limit=${limit}&index=${page * limit}`
            : `https://api.deezer.com/album/${encodeURIComponent(dzId)}`;
      try {
        const [dzRes, artistMetaRes, artistAlbumsRes, artistRelatedRes] = await Promise.all([
          fetchWithTimeout(dzUrl, 4500),
          type === 'artists'
            ? fetchWithTimeout(`https://api.deezer.com/artist/${encodeURIComponent(dzId)}`, 3500).catch(() => null)
            : Promise.resolve(null),
          type === 'artists' && page === 0
            ? fetchWithTimeout(`https://api.deezer.com/artist/${encodeURIComponent(dzId)}/albums?limit=16`, 3500).catch(() => null)
            : Promise.resolve(null),
          type === 'artists' && page === 0
            ? fetchWithTimeout(`https://api.deezer.com/artist/${encodeURIComponent(dzId)}/related?limit=10`, 3500).catch(() => null)
            : Promise.resolve(null),
        ]);
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
          const artistMeta =
            artistMetaRes && artistMetaRes.ok
              ? ((await artistMetaRes.json()) as {
                  name?: string;
                  picture_big?: string;
                  picture_medium?: string;
                  nb_fan?: number;
                  nb_album?: number;
                })
              : null;
          const dzAlbumsJson =
            artistAlbumsRes && artistAlbumsRes.ok
              ? ((await artistAlbumsRes.json()) as {
                  data?: Array<{
                    id?: number;
                    title?: string;
                    cover_big?: string;
                    cover_medium?: string;
                    release_date?: string;
                    record_type?: string;
                  }>;
                })
              : null;
          const dzRelatedJson =
            artistRelatedRes && artistRelatedRes.ok
              ? ((await artistRelatedRes.json()) as {
                  data?: Array<{
                    id?: number;
                    name?: string;
                    picture_big?: string;
                    picture_medium?: string;
                    nb_fan?: number;
                  }>;
                })
              : null;

          let rawTracks = dzJson.tracks?.data || dzJson.data || [];
          const artistName = artistMeta?.name || '';
          if (type === 'artists' && artistName && page === 0 && rawTracks.length < 15) {
            try {
              const extraRes = await fetchWithTimeout(
                `https://api.deezer.com/search?q=${encodeURIComponent(artistName)}&limit=${limit}`,
                4000
              );
              if (extraRes.ok) {
                const extraJson = (await extraRes.json()) as { data?: DeezerTrackRaw[] };
                const normalizedArtist = artistName.toLowerCase().trim();
                const seenIds = new Set(rawTracks.map((item) => String(item.id || '')));
                for (const item of extraJson.data || []) {
                  const itemId = String(item.id || '');
                  const itemArtistId = String(item.artist?.id || '');
                  const itemArtist = (item.artist?.name || '').toLowerCase().trim();
                  if (
                    itemId &&
                    !seenIds.has(itemId) &&
                    (itemArtistId === String(dzId) ||
                      itemArtist === normalizedArtist ||
                      itemArtist.includes(normalizedArtist))
                  ) {
                    seenIds.add(itemId);
                    rawTracks = [...rawTracks, item];
                  }
                }
              }
            } catch {
              // Keep primary top tracks if expanded artist search fails
            }
          }
          const albumCover =
            dzJson.cover_big ||
            dzJson.cover_medium ||
            dzJson.picture_big ||
            dzJson.picture_medium ||
            artistMeta?.picture_big ||
            artistMeta?.picture_medium ||
            '';
          let mapped = rawTracks
            .map((item) => {
              const t = mapDeezerTrack(item, 'GLOBAL');
              return !t.image && albumCover ? { ...t, image: albumCover } : t;
            })
            .filter(
              (t) =>
                !isInstrumentalOrSpam(t.name, t.albumName) &&
                !isRemixOrKnockoff(t.name, '', t.artist, '')
            );

          // Enrich Deezer artist discography tracks with full-length JioSaavn IN streams when available
          if (type === 'artists' && artistName && mapped.length > 0) {
            try {
              const saavnNative = await fetchSaavnNativeSongs(artistName, page, limit, 2800);
              const saavnByKey = new Map<string, SaavnNormalizedSong>();
              const normArtist = artistName.normalize('NFKC').toLowerCase().trim();
              const normTitle = (v: string) =>
                v
                  .normalize('NFKC')
                  .toLowerCase()
                  .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
                  .replace(/[^\p{L}\p{N}]+/gu, ' ')
                  .trim();
              for (const s of saavnNative) {
                const sPrimary = s.artists.primary.map((a) => (a.name || '').normalize('NFKC').toLowerCase()).join(', ');
                const sFeatured = s.artists.featured.map((a) => (a.name || '').normalize('NFKC').toLowerCase()).join(', ');
                if (!sPrimary.includes(normArtist) && !sFeatured.includes(normArtist)) continue;
                const k = normTitle(s.name);
                if (k && !saavnByKey.has(k) && s.downloadUrl.length > 0) {
                  saavnByKey.set(k, s);
                }
              }
              mapped = mapped.map((track) => {
                const match = saavnByKey.get(normTitle(track.name));
                if (!match) return track;
                const streamUrls: Record<string, string> = {};
                for (const d of match.downloadUrl) {
                  if (d.quality && d.url) streamUrls[d.quality] = d.url;
                }
                if (!Object.values(streamUrls).some(Boolean)) return track;
                return {
                  ...track,
                  duration: match.duration > 0 ? match.duration : track.duration,
                  streamUrls,
                  sourceProvider: 'JioSaavn',
                  sourceAvailability: 'full',
                  offlineAvailable: true,
                };
              });
            } catch {
              // Keep Deezer tracks if optional JioSaavn enrichment fails
            }
          }

          const mappedDzAlbums = (dzAlbumsJson?.data || [])
            .filter((alb) => alb.id && alb.title)
            .map((alb) => ({
              id: `dz-alb:${alb.id}`,
              name: decodeHtmlEntities(alb.title || 'Album'),
              artist: artistName || 'Artist',
              year: alb.release_date ? alb.release_date.slice(0, 4) : undefined,
              image: alb.cover_big || alb.cover_medium || albumCover || '',
              type:
                alb.record_type === 'single'
                  ? 'Single'
                  : alb.record_type === 'ep'
                    ? 'EP'
                    : 'Album',
              trackCount: alb.record_type === 'single' ? 1 : 0,
              tracks: [],
            }));

          const mappedDzRelated = (dzRelatedJson?.data || [])
            .filter((rel) => rel.id && rel.name)
            .map((rel) => ({
              id: `dz-art:${rel.id}`,
              name: decodeHtmlEntities(rel.name || 'Artist'),
              subtitle: rel.nb_fan ? `${Math.round(rel.nb_fan / 1000)}K fans` : 'Artist',
              image: rel.picture_big || rel.picture_medium || '',
            }));

          const fanCount = typeof artistMeta?.nb_fan === 'number' ? artistMeta.nb_fan : undefined;
          res.json({
            ok: mapped.length > 0 || mappedDzAlbums.length > 0,
            source: 'deezer',
            data: {
              name: dzJson.title || dzJson.name || artistName || 'Collection',
              image: albumCover || mapped[0]?.image || '',
              tracks: mapped,
              followerCount: fanCount,
              isVerified: Boolean(fanCount && fanCount > 5000),
              albums: mappedDzAlbums.length > 0 ? mappedDzAlbums : undefined,
              relatedArtists: mappedDzRelated.length > 0 ? mappedDzRelated : undefined,
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

    if (type === 'artists') {
      try {
        const [nativeArtistRes, mirrorArtistRes] = await Promise.allSettled([
          page === 0
            ? fetchWithTimeout(
                `${JIOSAAVN_API_BASE}?__call=artist.getArtistPageDetails&artistId=${encodeURIComponent(id)}&n_song=${limit}&n_album=20&_format=json&_marker=0&api_version=4`,
                4500,
                JIOSAAVN_NATIVE_HEADERS
              ).then((r) => (r.ok ? r.json() : null))
            : Promise.resolve(null),
          fetchWithTimeout(
            `${SAAVN_BASE}/api/artists/${encodeURIComponent(id)}/songs?page=${page}&limit=${limit}`,
            4500
          ).then((r) => (r.ok ? r.json() : null)),
        ]);
        const nativeArtistJson =
          nativeArtistRes.status === 'fulfilled' ? nativeArtistRes.value : null;
        const nativeRawSongs = Array.isArray(nativeArtistJson?.topSongs?.songs)
          ? (nativeArtistJson.topSongs.songs as NativeSaavnSongRaw[])
          : Array.isArray(nativeArtistJson?.topSongs)
            ? (nativeArtistJson.topSongs as NativeSaavnSongRaw[])
            : [];
        const nativeSongs = nativeRawSongs
          .map(mapNativeSaavnSong)
          .filter((s): s is SaavnNormalizedSong => s !== null);
        const mirrorData =
          mirrorArtistRes.status === 'fulfilled' && mirrorArtistRes.value
            ? (mirrorArtistRes.value.data ?? mirrorArtistRes.value)
            : null;
        const mirrorSongs = Array.isArray(mirrorData?.songs) ? mirrorData.songs : [];
        const mergedSongs: SaavnNormalizedSong[] = [];
        const seenSongIds = new Set<string>();
        for (const s of [...nativeSongs, ...mirrorSongs]) {
          const sid = String(s?.id || '');
          if (sid && seenSongIds.has(sid)) continue;
          if (sid) seenSongIds.add(sid);
          mergedSongs.push(s);
        }

        const rawNativeAlbums = [
          ...(Array.isArray(nativeArtistJson?.latest_release)
            ? (nativeArtistJson.latest_release as NativeSaavnAlbumRaw[])
            : []),
          ...(Array.isArray(nativeArtistJson?.topAlbums?.albums)
            ? (nativeArtistJson.topAlbums.albums as NativeSaavnAlbumRaw[])
            : Array.isArray(nativeArtistJson?.topAlbums)
              ? (nativeArtistJson.topAlbums as NativeSaavnAlbumRaw[])
              : []),
        ];
        const seenAlbIds = new Set<string>();
        const mappedAlbums: Array<{
          id: string;
          name: string;
          artist: string;
          year?: string;
          image: string;
          trackCount: number;
          type: 'Album' | 'Single' | 'EP';
          tracks: [];
        }> = [];
        for (const rawAlb of rawNativeAlbums) {
          const mappedAlb = mapNativeSaavnAlbum(rawAlb);
          if (!mappedAlb || seenAlbIds.has(mappedAlb.id)) continue;
          seenAlbIds.add(mappedAlb.id);
          const bestImg = mappedAlb.image.find((i) => i.quality === '500x500')?.url || mappedAlb.image[mappedAlb.image.length - 1]?.url || '';
          const artistTitle = mappedAlb.artists.primary.map((a) => a.name).filter(Boolean).join(', ') || nativeArtistJson?.name || 'Artist';
          mappedAlbums.push({
            id: `saavn-alb:${mappedAlb.id}`,
            name: decodeHtmlEntities(mappedAlb.name),
            artist: decodeHtmlEntities(artistTitle),
            year: mappedAlb.year,
            image: bestImg,
            trackCount: 0,
            type: 'Album',
            tracks: [],
          });
        }

        const rawRelated = Array.isArray(nativeArtistJson?.similarArtists)
          ? (nativeArtistJson.similarArtists as Array<NativeSaavnArtistRaw & { isVerified?: boolean }>)
          : [];
        const mappedRelated = rawRelated
          .map((rawRel) => {
            const rel = mapNativeSaavnArtist(rawRel);
            if (!rel) return null;
            const img = rel.image.find((i) => i.quality === '500x500')?.url || rel.image[rel.image.length - 1]?.url || '';
            return {
              id: `saavn-art:${rel.id}`,
              name: decodeHtmlEntities(rel.name),
              subtitle: 'Artist',
              image: img,
            };
          })
          .filter((item): item is NonNullable<typeof item> => Boolean(item));

        const extractBioText = (raw: unknown): string => {
          if (Array.isArray(raw)) {
            return raw
              .map((entry) => (typeof entry === 'string' ? entry : (entry as { text?: string })?.text || ''))
              .filter(Boolean)
              .join(' ')
              .trim();
          }
          if (typeof raw === 'string') {
            const trimmed = raw.trim();
            if (!trimmed) return '';
            if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
              try {
                const parsed = JSON.parse(trimmed);
                const extracted = extractBioText(Array.isArray(parsed) ? parsed : [parsed]);
                if (extracted) return extracted;
              } catch {
                // Fall back to raw text when bio is plain prose
              }
            }
            return trimmed;
          }
          if (raw && typeof raw === 'object' && 'text' in raw) {
            return String((raw as { text?: unknown }).text || '').trim();
          }
          return '';
        };
        const bioText = extractBioText(nativeArtistJson?.bio).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const followerNum = Number(nativeArtistJson?.follower_count || nativeArtistJson?.fan_count || 0) || undefined;

        if (mergedSongs.length > 0 || mappedAlbums.length > 0) {
          const artistImg =
            typeof nativeArtistJson?.image === 'string' &&
            !nativeArtistJson.image.includes('artist-default') &&
            !nativeArtistJson.image.includes('/_i/3.0/')
              ? nativeArtistJson.image
              : mirrorData?.image;
          res.json({
            ok: true,
            data: {
              name: nativeArtistJson?.name || mirrorData?.name || 'Artist',
              image: artistImg,
              subtitle: nativeArtistJson?.subtitle || undefined,
              bio: bioText ? decodeHtmlEntities(bioText) : undefined,
              followerCount: followerNum,
              isVerified: Boolean(nativeArtistJson?.isVerified || (followerNum && followerNum > 5000)),
              songs: mergedSongs,
              albums: mappedAlbums.length > 0 ? mappedAlbums : undefined,
              relatedArtists: mappedRelated.length > 0 ? mappedRelated : undefined,
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
    }

    try {
      const response = await fetchWithTimeout(upstream, 4500);
      if (response.ok) {
        const json = await response.json();
        const data = json.data ?? json;
        if (Array.isArray(data?.songs) && data.songs.length > 0) {
          res.json({ ok: true, data });
          return;
        }
      }
      if (type === 'albums') {
        const nativeAlbumRes = await fetchWithTimeout(
          `${JIOSAAVN_API_BASE}?__call=content.getAlbumDetails&albumid=${encodeURIComponent(id)}&_format=json&_marker=0&api_version=4`,
          4500,
          JIOSAAVN_NATIVE_HEADERS
        );
        if (nativeAlbumRes.ok) {
          const albumJson = (await nativeAlbumRes.json()) as {
            title?: string;
            image?: string;
            list?: NativeSaavnSongRaw[];
          };
          const songs = (albumJson.list || [])
            .map(mapNativeSaavnSong)
            .filter((s): s is SaavnNormalizedSong => s !== null);
          if (songs.length > 0) {
            res.json({
              ok: true,
              data: {
                name: albumJson.title || 'Album',
                image: albumJson.image,
                songs,
              },
            });
            return;
          }
        }
      }
      res.json({ ok: false, fallback: true });
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
