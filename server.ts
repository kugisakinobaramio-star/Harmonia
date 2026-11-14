import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { Readable } from 'node:stream';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';
import {
  isRemixOrKnockoff,
  scoreAuthenticTrackCandidate,
} from './src/utils/playerEngine.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
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
  previewUrl?: string;
  streamUrls?: Record<string, string>;
  lyrics?: StoredLyricLine[];
}

// Only public HTTPS destinations may be fetched through user-controlled proxy URLs.
// Every redirect is revalidated to prevent redirect-based SSRF.
function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const p = address.split('.').map(Number);
    const [a, b] = p;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0) return false;
    if (a === 192 && b === 0 && p[2] === 2) return false;
    if (a === 198 && (b === 18 || b === 19 || b === 51)) return false;
    if (a === 203 && b === 0 && p[2] === 113) return false;
    return true;
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    // Permit only globally-routable 2000::/3 IPv6 addresses; reject mapped/private/local ranges.
    return /^[23][0-9a-f]{3}:/.test(normalized) && !normalized.startsWith('2001:db8:');
  }
  return false;
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
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
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

// Simple LRU image buffer cache so album covers load instantaneously and never break
const imageCache = new Map<string, { buf: Buffer; contentType: string }>();
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

function inferLanguage(text: string, hintLang?: string): 'Hindi' | 'English' | 'J-Pop' | 'Other' {
  if (hintLang === 'Hindi' || hintLang === 'English' || hintLang === 'J-Pop') return hintLang;
  if (/[\u3040-\u30ff\u4e00-\u9faf]/.test(text)) return 'J-Pop';
  const low = text.toLowerCase();
  if (
    /arijit|pritam|bollywood|hindi|shreya|jubin|atif|sonu|badshah|diljit|kesariya|pasoori|sachin-jigar/.test(
      low
    )
  ) {
    return 'Hindi';
  }
  if (/yoasobi|kenshi|yonezu|fujii kaze|hige|ado|lisa|aimyon|radwimps|j-pop|tokyo/.test(low)) {
    return 'J-Pop';
  }
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
  // Require verified original artist account on Audius so community DJ re-uploads never sneak through
  if (audItem.user?.is_verified !== true) return null;

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

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

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
        const ct = upstream.headers.get('content-type') || 'image/jpeg';
        if (!ct.startsWith('image/')) return false;
        const arr = await upstream.arrayBuffer();
        const buf = Buffer.from(arr);

        if (imageCache.size >= 200) {
          const firstKey = imageCache.keys().next().value;
          if (firstKey) imageCache.delete(firstKey);
        }
        imageCache.set(targetUrl, { buf, contentType: ct });

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
  const streamResolveCache = new Map<
    string,
    {
      streamUrls: Record<string, string>;
      previewUrl?: string;
      alternates: string[];
      youtubeId?: string;
    }
  >();

  async function resolveYouTubeAudioId(
    cleanTitle: string,
    primaryArtist: string,
    targetDurationSec = 0
  ): Promise<string | undefined> {
    const query = `${cleanTitle} ${primaryArtist}`.trim();
    const pipedEndpoints = [
      `https://api.piped.private.coffee/search?q=${encodeURIComponent(query)}&filter=music_songs`,
      `https://pipedapi.kavin.rocks/search?q=${encodeURIComponent(query)}&filter=music_songs`,
      `https://api.piped.projectsegfau.lt/search?q=${encodeURIComponent(query)}&filter=music_songs`,
    ];

    for (const ep of pipedEndpoints) {
      try {
        const res = await fetchWithTimeout(ep, 3500);
        if (!res.ok) continue;
        const data = (await res.json()) as {
          items?: Array<{
            url?: string;
            title?: string;
            uploaderName?: string;
            duration?: number;
            type?: string;
          }>;
        };
        if (Array.isArray(data.items) && data.items.length > 0) {
          const scored = data.items
            .map((item) => {
              const rawId = item.url?.replace('/watch?v=', '') || '';
              if (!rawId || rawId.length !== 11) return null;
              const dur = typeof item.duration === 'number' ? item.duration : 0;
              if (dur > 0 && (dur < 45 || dur > 720)) return null;

              const score = scoreAuthenticTrackCandidate({
                itemTitle: item.title || '',
                itemArtist: item.uploaderName || primaryArtist,
                requestedTitle: cleanTitle,
                requestedArtist: primaryArtist,
                itemDurationSec: dur,
                targetDurationSec,
              });
              return { id: rawId, score };
            })
            .filter((x): x is { id: string; score: number } => x !== null && x.score !== null)
            .sort((a, b) => b.score - a.score);

          if (scored[0]?.id) {
            return scored[0].id;
          }

          for (const item of data.items) {
            const rawId = item.url?.replace('/watch?v=', '') || '';
            if (
              rawId &&
              rawId.length === 11 &&
              !isRemixOrKnockoff(item.title || '', '', item.uploaderName || '', '')
            ) {
              return rawId;
            }
          }
        }
      } catch {
        // Try next endpoint
      }
    }

    // Direct scrape fallback
    try {
      const ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(
        `${query} Official Audio`
      )}`;
      const ytRes = await fetchWithTimeout(ytUrl, 4000);
      if (ytRes.ok) {
        const html = await ytRes.text();
        const items = parseYouTubeSearchHtml(html, 6);
        for (const item of items) {
          if (!isRemixOrKnockoff(item.title, '', item.channel, '')) {
            return item.id;
          }
        }
      }
    } catch {
      // Ignore
    }

    return undefined;
  }

  app.get('/api/music/resolve', async (req, res) => {
    const title = String(req.query.title || '').trim();
    const artist = String(req.query.artist || '').trim();
    const targetDurationSec = Number(req.query.duration || 0);
    if (!title) {
      res.json({ ok: false, streamUrls: {}, alternates: [] });
      return;
    }

    const cacheKey = `${title.toLowerCase()}::${artist.toLowerCase()}`;
    const cached = streamResolveCache.get(cacheKey);
    if (cached && (Object.keys(cached.streamUrls).length > 0 || cached.youtubeId)) {
      res.json({ ok: true, ...cached });
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

  async function resolveArchiveAudioStream(
    cleanTitle: string,
    primaryArtist: string
  ): Promise<string | undefined> {
    try {
      const q = `${cleanTitle} ${primaryArtist}`.trim();
      const searchRes = await fetchWithTimeout(
        `https://archive.org/advancedsearch.php?q=${encodeURIComponent(
          q
        )}%20AND%20mediatype:(audio)&fl[]=identifier,title,creator&rows=3&output=json`,
        3500
      );
      if (!searchRes.ok) return undefined;
      const data = (await searchRes.json()) as {
        response?: { docs?: Array<{ identifier?: string }> };
      };
      const docs = data.response?.docs;
      if (!Array.isArray(docs) || docs.length === 0) return undefined;

      for (const doc of docs) {
        const identifier = doc.identifier;
        if (!identifier) continue;
        const metaRes = await fetchWithTimeout(`https://archive.org/metadata/${identifier}`, 3000);
        if (!metaRes.ok) continue;
        const meta = (await metaRes.json()) as {
          files?: Array<{ name?: string; format?: string }>;
        };
        const files = meta.files;
        if (!Array.isArray(files)) continue;

        const mp3File = files.find(
          (f) =>
            f.name &&
            (f.name.endsWith('.mp3') || f.name.endsWith('.flac')) &&
            !f.name.toLowerCase().includes('thumb')
        );
        if (mp3File?.name) {
          return `https://archive.org/download/${identifier}/${mp3File.name}`;
        }
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

    const [saavnSettled, audiusSettled, deezerSettled, itunesSettled, jamendoSettled, archiveSettled] =
      await Promise.allSettled([
        fetchWithTimeout(
          `${SAAVN_BASE}/api/search/songs?query=${encodeURIComponent(query)}&page=0&limit=12`,
          5000
        ).then((r) => (r.ok ? r.json() : null)),
        fetchWithTimeout(
          `https://discoveryprovider.audius.co/v1/tracks/search?query=${encodeURIComponent(query)}&limit=8`,
          4000
        ).then((r) => (r.ok ? r.json() : null)),
        fetchWithTimeout(
          `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=6`,
          4000
        ).then((r) => (r.ok ? r.json() : null)),
        fetchWithTimeout(
          `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=6`,
          4000
        ).then((r) => (r.ok ? r.json() : null)),
        resolveJamendoStream(cleanTitle, primaryArtist, targetDurationSec),
        resolveArchiveAudioStream(cleanTitle, primaryArtist),
      ]);

    if (jamendoSettled.status === 'fulfilled' && jamendoSettled.value) {
      const jamUrl = jamendoSettled.value;
      if (!streamUrls['160kbps']) streamUrls['160kbps'] = jamUrl;
      fullAlternates.push(jamUrl);
    }

    if (archiveSettled.status === 'fulfilled' && archiveSettled.value) {
      const arcUrl = archiveSettled.value;
      if (!streamUrls['160kbps']) streamUrls['160kbps'] = arcUrl;
      fullAlternates.push(arcUrl);
    }

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
          score: scoreAuthenticAudiusMatch(a, cleanTitle, artist || primaryArtist, targetDurationSec),
        }))
        .filter((x): x is { a: AudiusTrackRaw; score: number } => x.score !== null)
        .sort((x, y) => y.score - x.score)[0]?.a;
      if (bestAud?.id) {
        const audStream = `https://discoveryprovider.audius.co/v1/tracks/${encodeURIComponent(
          bestAud.id
        )}/stream`;
        if (!streamUrls['160kbps']) streamUrls['160kbps'] = audStream;
        if (!streamUrls['96kbps']) streamUrls['96kbps'] = audStream;
        fullAlternates.push(audStream);
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

    // Always resolve YouTube ID if no full 320k stream exists, ensuring full playback length
    let youtubeId: string | undefined;
    if (!streamUrls['320kbps']) {
      youtubeId = await resolveYouTubeAudioId(cleanTitle, primaryArtist, targetDurationSec);
    }

    const payload = {
      streamUrls,
      previewUrl,
      alternates: Array.from(new Set([...fullAlternates, ...previewAlternates])),
      youtubeId,
    };
    if (Object.keys(streamUrls).length > 0 || youtubeId) {
      if (streamResolveCache.size >= 300) {
        const first = streamResolveCache.keys().next().value;
        if (first) streamResolveCache.delete(first);
      }
      streamResolveCache.set(cacheKey, payload);
    }

    res.json({
      ok: Object.keys(streamUrls).length > 0 || Boolean(previewUrl) || Boolean(youtubeId),
      ...payload,
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
      const [saavnResult, itunesResult, deezerResult, audiusResult] = await Promise.allSettled([
        fetchWithTimeout(
          `${SAAVN_BASE}/api/search/songs?query=${encodeURIComponent(query)}&page=${page}&limit=${limit}`,
          4500
        ).then((r) => (r.ok ? r.json() : null)),
        fetchWithTimeout(
          `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&country=${country}&media=music&entity=song&limit=10`,
          4500
        ).then((r) => (r.ok ? r.json() : null)),
        fetchWithTimeout(
          `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=10`,
          4500
        ).then((r) => (r.ok ? r.json() : null)),
        fetchWithTimeout(
          `https://discoveryprovider.audius.co/v1/tracks/search?query=${encodeURIComponent(query)}&limit=6`,
          4500
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
        .filter((r) => r.user?.is_verified === true && (r.duration || 0) >= 75)
        .map((r) => mapAudiusTrack(r, country))
        .filter(
          (t) =>
            Boolean(t.image) &&
            !isInstrumentalOrSpam(t.name, t.albumName) &&
            !isRemixOrKnockoff(`${t.name} ${t.albumName}`, query, t.artist, query)
        );

      res.json({
        ok:
          saavnRaw.length > 0 ||
          itunesTracks.length > 0 ||
          deezerTracks.length > 0 ||
          audiusTracks.length > 0,
        data: { results: saavnRaw, itunesTracks, deezerTracks, audiusTracks },
      });
      return;
    }

    const allowed = new Set(['albums', 'playlists', 'artists']);
    const safeType = allowed.has(type) ? type : 'albums';
    const dzEndpoint =
      safeType === 'artists' ? 'artist' : safeType === 'playlists' ? 'playlist' : 'album';

    const [saavnSettled, deezerSettled] = await Promise.allSettled([
      fetchWithTimeout(
        `${SAAVN_BASE}/api/search/${safeType}?query=${encodeURIComponent(query)}&page=${page}&limit=${limit}`,
        4500
      ).then((r) => (r.ok ? r.json() : null)),
      fetchWithTimeout(
        `https://api.deezer.com/search/${dzEndpoint}?q=${encodeURIComponent(query)}&limit=8`,
        4000
      ).then((r) => (r.ok ? r.json() : null)),
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

    res.json({
      ok: Boolean((saavnData?.results?.length || 0) > 0 || deezerItems.length > 0),
      data: {
        ...saavnData,
        deezerItems,
      },
    });
  });

  const discoverCache = new Map<string, { expiresAt: number; tracks: StoredTrack[] }>();

  // Location-based regional charts & multi-language discovery across Deezer + iTunes + Audius
  app.get('/api/music/discover', async (req, res) => {
    const region = String(req.query.region || 'IN').toUpperCase();
    const cached = discoverCache.get(region);
    if (cached && cached.expiresAt > Date.now()) {
      res.json({ ok: true, region, tracks: cached.tracks });
      return;
    }

    const countryCode = region === 'JP' ? 'jp' : region === 'GB' ? 'gb' : region === 'US' ? 'us' : 'in';

    const queriesByRegion: Record<string, Array<{ term: string; country: string; lang: string }>> = {
      IN: [
        { term: 'Arijit Singh Hindi', country: 'in', lang: 'Hindi' },
        { term: 'YOASOBI', country: 'jp', lang: 'J-Pop' },
        { term: 'The Weeknd', country: 'us', lang: 'English' },
      ],
      JP: [
        { term: 'YOASOBI Kenshi Yonezu', country: 'jp', lang: 'J-Pop' },
        { term: 'Arijit Singh', country: 'in', lang: 'Hindi' },
        { term: 'The Weeknd', country: 'us', lang: 'English' },
      ],
      US: [
        { term: 'The Weeknd Glass Animals', country: 'us', lang: 'English' },
        { term: 'Arijit Singh', country: 'in', lang: 'Hindi' },
        { term: 'YOASOBI', country: 'jp', lang: 'J-Pop' },
      ],
      GB: [
        { term: 'Dua Lipa Glass Animals', country: 'gb', lang: 'English' },
        { term: 'Arijit Singh', country: 'in', lang: 'Hindi' },
        { term: 'YOASOBI', country: 'jp', lang: 'J-Pop' },
      ],
      GLOBAL: [
        { term: 'Arijit Singh', country: 'in', lang: 'Hindi' },
        { term: 'YOASOBI', country: 'jp', lang: 'J-Pop' },
        { term: 'The Weeknd', country: 'us', lang: 'English' },
      ],
    };

    const specs = queriesByRegion[region] || queriesByRegion.IN;

    try {
      const settled = await Promise.allSettled([
        ...specs.map((spec) =>
          fetchWithTimeout(
            `https://api.deezer.com/search?q=${encodeURIComponent(spec.term)}&limit=5`,
            4000
          )
            .then((r) => (r.ok ? r.json() : { data: [] }))
            .then((json: { data?: DeezerTrackRaw[] }) =>
              (json.data || [])
                .map((item) => mapDeezerTrack(item, countryCode.toUpperCase(), spec.lang))
                .filter(
                  (t) =>
                    Boolean(t.image) &&
                    !isInstrumentalOrSpam(t.name, t.albumName) &&
                    !isRemixOrKnockoff(t.name, '', t.artist, '')
                )
            )
        ),
        ...specs.map((spec) =>
          fetchWithTimeout(
            `https://itunes.apple.com/search?term=${encodeURIComponent(spec.term)}&country=${spec.country}&media=music&entity=song&limit=4`,
            4000
          )
            .then((r) => (r.ok ? r.json() : { results: [] }))
            .then((json: { results?: ItunesTrackRaw[] }) =>
              (json.results || [])
                .map((item) => mapItunesTrack(item, countryCode.toUpperCase(), spec.lang))
                .filter(
                  (t) =>
                    Boolean(t.image) &&
                    !isInstrumentalOrSpam(t.name, t.albumName) &&
                    !isRemixOrKnockoff(t.name, '', t.artist, '')
                )
            )
        ),
      ]);

      const tracks: StoredTrack[] = [];
      const seen = new Set<string>();
      for (const s of settled) {
        if (s.status === 'fulfilled') {
          for (const t of s.value) {
            const key = `${t.name.toLowerCase()}::${t.artist.toLowerCase()}`;
            if (!seen.has(key)) {
              seen.add(key);
              tracks.push(t);
            }
          }
        }
      }

      if (tracks.length > 0) {
        discoverCache.set(region, { expiresAt: Date.now() + 15 * 60_000, tracks });
      }
      res.json({ ok: tracks.length > 0, region, tracks });
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

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Harmonia full-stack server running on http://localhost:${PORT}`);
  });
}

startServer();
