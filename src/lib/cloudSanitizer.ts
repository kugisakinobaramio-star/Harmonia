import type {
  AudioQuality,
  CuratedPlaylist,
  EqPreset,
  FollowedArtist,
  MusicRegion,
  Track,
} from '../types/music';

export const SCHEMA_VERSION = 2;

const VALID_REGIONS = new Set<MusicRegion>(['IN', 'JP', 'US', 'GB', 'GLOBAL']);
const VALID_QUALITIES = new Set<AudioQuality>(['320kbps', '160kbps', '96kbps', 'auto']);
const VALID_EQ_PRESETS = new Set<EqPreset>(['flat', 'bass', 'vocal', 'latenight']);
const VALID_AVAILABILITY = new Set(['full', 'preview', 'lookup', 'metadata']);
const VALID_SYNTH_MOODS = new Set([
  'synthwave',
  'sunset',
  'lofi',
  'energetic',
  'ambient',
  'pop',
  'hindi',
  'jpop',
]);

export interface SanitizedTrack {
  id: string;
  name: string;
  artist: string;
  albumName: string;
  duration: number;
  image: string;
  year?: string;
  playCount?: number;
  language?: string;
  region?: MusicRegion;
  genre?: string;
  bpm?: number;
  energy?: number;
  moods?: string[];
  hasLyrics?: boolean;
  metadataOnly?: boolean;
  sourceProvider?: string;
  sourceAvailability?: 'full' | 'preview' | 'lookup' | 'metadata';
  sourcePageUrl?: string;
  sourceLicense?: string;
  offlineAvailable?: boolean;
  synthMood?: Track['synthMood'];
}

function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Converts any arbitrary MusicKK track or playlist ID into a deterministic,
 * collision-resistant Firestore document ID matching `^[a-zA-Z0-9_-]{1,128}$`.
 */
export function toFirestoreDocId(rawId: string): string {
  const input = String(rawId || '').trim() || 'item';
  if (/^[a-zA-Z0-9_-]{1,110}$/.test(input)) {
    return input;
  }
  const safePrefix = input
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100) || 'item';
  return `${safePrefix}_${fnv1aHex(input)}`;
}

export function clampString(value: unknown, maxLength: number, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, maxLength);
}

export function sanitizeImageOrUrl(value: unknown, maxLength = 500): string {
  const str = clampString(value, maxLength, '');
  if (!str) return '';
  if (
    str.startsWith('https://') ||
    str.startsWith('http://') ||
    str.startsWith('/') ||
    str.startsWith('data:image/')
  ) {
    return str;
  }
  return '';
}

export function sanitizeStringList(
  values: unknown,
  maxItems: number,
  maxItemLength = 120
): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of values) {
    const clean = clampString(item, maxItemLength, '');
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
    if (result.length >= maxItems) break;
  }
  return result;
}

export function sanitizeRegion(value: unknown): MusicRegion {
  return typeof value === 'string' && VALID_REGIONS.has(value as MusicRegion)
    ? (value as MusicRegion)
    : 'IN';
}

export function sanitizeQuality(value: unknown): AudioQuality {
  return typeof value === 'string' && VALID_QUALITIES.has(value as AudioQuality)
    ? (value as AudioQuality)
    : '320kbps';
}

export function sanitizeEqPreset(value: unknown): EqPreset {
  return typeof value === 'string' && VALID_EQ_PRESETS.has(value as EqPreset)
    ? (value as EqPreset)
    : 'flat';
}

/**
 * Strips all temporary stream URLs, preview URLs, YouTube IDs, lyrics, and
 * provider credentials so only durable track metadata is persisted to Firestore.
 */
export function sanitizeTrackForCloud(track: Track): SanitizedTrack {
  const id = clampString(track.id, 160, toFirestoreDocId(track.name || 'track'));
  const name = clampString(track.name, 240, 'Untitled Track');
  const artist = clampString(track.artist, 240, 'Unknown Artist');
  const albumName = clampString(track.albumName, 240, '');
  const durationRaw = Number(track.duration);
  const duration = Number.isFinite(durationRaw)
    ? Math.max(0, Math.min(86400, Math.round(durationRaw)))
    : 0;
  const image = sanitizeImageOrUrl(track.image, 500);

  const sanitized: SanitizedTrack = {
    id,
    name,
    artist,
    albumName,
    duration,
    image,
  };

  const year = clampString(track.year, 16, '');
  if (year) sanitized.year = year;

  if (typeof track.playCount === 'number' && Number.isFinite(track.playCount) && track.playCount >= 0) {
    sanitized.playCount = Math.round(track.playCount);
  }

  const language = clampString(track.language, 40, '');
  if (language) sanitized.language = language;

  if (track.region && VALID_REGIONS.has(track.region)) {
    sanitized.region = track.region;
  }

  const genre = clampString(track.genre, 120, '');
  if (genre) sanitized.genre = genre;

  if (typeof track.bpm === 'number' && Number.isFinite(track.bpm) && track.bpm >= 0 && track.bpm <= 400) {
    sanitized.bpm = Math.round(track.bpm);
  }

  if (typeof track.energy === 'number' && Number.isFinite(track.energy) && track.energy >= 0 && track.energy <= 1) {
    sanitized.energy = Number(track.energy.toFixed(4));
  }

  const moods = sanitizeStringList(track.moods, 12, 120);
  if (moods.length > 0) sanitized.moods = moods;

  if (typeof track.hasLyrics === 'boolean') sanitized.hasLyrics = track.hasLyrics;
  if (typeof track.metadataOnly === 'boolean') sanitized.metadataOnly = track.metadataOnly;

  const sourceProvider = clampString(track.sourceProvider, 80, '');
  if (sourceProvider) sanitized.sourceProvider = sourceProvider;

  if (track.sourceAvailability && VALID_AVAILABILITY.has(track.sourceAvailability)) {
    sanitized.sourceAvailability = track.sourceAvailability;
  }

  const sourcePageUrl = sanitizeImageOrUrl(track.sourcePageUrl, 500);
  if (sourcePageUrl) sanitized.sourcePageUrl = sourcePageUrl;

  const sourceLicense = clampString(track.sourceLicense, 500, '');
  if (sourceLicense) sanitized.sourceLicense = sourceLicense;

  if (typeof track.offlineAvailable === 'boolean') {
    sanitized.offlineAvailable = track.offlineAvailable;
  }

  if (track.synthMood && VALID_SYNTH_MOODS.has(track.synthMood)) {
    sanitized.synthMood = track.synthMood;
  }

  return sanitized;
}

export function restoreTrackFromCloud(raw: unknown): Track | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = clampString(r.id, 160, '');
  const name = clampString(r.name, 240, '');
  const artist = clampString(r.artist, 240, '');
  if (!id || !name || !artist) return null;

  const duration =
    typeof r.duration === 'number' && Number.isFinite(r.duration) && r.duration >= 0
      ? r.duration
      : 0;

  const restored: Track = {
    id,
    name,
    artist,
    albumName: clampString(r.albumName, 240, ''),
    duration,
    image: sanitizeImageOrUrl(r.image, 500),
  };

  if (typeof r.year === 'string' && r.year) restored.year = r.year;
  if (typeof r.playCount === 'number' && Number.isFinite(r.playCount)) restored.playCount = r.playCount;
  if (typeof r.language === 'string' && r.language) restored.language = r.language as Track['language'];
  if (typeof r.region === 'string' && VALID_REGIONS.has(r.region as MusicRegion)) {
    restored.region = r.region as MusicRegion;
  }
  if (typeof r.genre === 'string' && r.genre) restored.genre = r.genre;
  if (typeof r.bpm === 'number' && Number.isFinite(r.bpm)) restored.bpm = r.bpm;
  if (typeof r.energy === 'number' && Number.isFinite(r.energy)) restored.energy = r.energy;
  if (Array.isArray(r.moods)) restored.moods = sanitizeStringList(r.moods, 12, 120);
  if (typeof r.hasLyrics === 'boolean') restored.hasLyrics = r.hasLyrics;
  if (typeof r.metadataOnly === 'boolean') restored.metadataOnly = r.metadataOnly;
  if (typeof r.sourceProvider === 'string' && r.sourceProvider) restored.sourceProvider = r.sourceProvider;
  if (typeof r.sourceAvailability === 'string' && VALID_AVAILABILITY.has(r.sourceAvailability)) {
    restored.sourceAvailability = r.sourceAvailability as Track['sourceAvailability'];
  }
  if (typeof r.sourcePageUrl === 'string' && r.sourcePageUrl) restored.sourcePageUrl = r.sourcePageUrl;
  if (typeof r.sourceLicense === 'string' && r.sourceLicense) restored.sourceLicense = r.sourceLicense;
  if (typeof r.offlineAvailable === 'boolean') restored.offlineAvailable = r.offlineAvailable;
  if (typeof r.synthMood === 'string' && VALID_SYNTH_MOODS.has(r.synthMood)) {
    restored.synthMood = r.synthMood as Track['synthMood'];
  }

  return restored;
}

export function sanitizeAffinityMap(
  input: Record<string, number> | undefined,
  maxEntries: number
): Record<string, number> {
  if (!input || typeof input !== 'object') return {};
  return Object.fromEntries(
    Object.entries(input)
      .filter(([key, val]) => Boolean(key.trim()) && typeof val === 'number' && Number.isFinite(val) && val >= 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxEntries)
      .map(([key, val]) => [key.trim().slice(0, 120), Math.min(1_000_000, Math.round(val))])
  );
}

export function sanitizeFeedbackMap(
  input: Record<string, { skips: number; completions: number }> | undefined,
  maxEntries: number
): Record<string, { skips: number; completions: number }> {
  if (!input || typeof input !== 'object') return {};
  return Object.fromEntries(
    Object.entries(input)
      .filter(
        ([key, val]) =>
          Boolean(key.trim()) &&
          val &&
          typeof val === 'object' &&
          (val.skips > 0 || val.completions > 0)
      )
      .sort((a, b) => (b[1].completions + b[1].skips) - (a[1].completions + a[1].skips))
      .slice(0, maxEntries)
      .map(([key, val]) => [
        key.trim().slice(0, 120),
        {
          skips: Math.max(0, Math.min(1_000_000, Math.round(Number(val.skips) || 0))),
          completions: Math.max(0, Math.min(1_000_000, Math.round(Number(val.completions) || 0))),
        },
      ])
  );
}

export function sanitizePlaylistMetaForCloud(
  playlist: CuratedPlaylist,
  uid: string,
  orderIndex: number,
  updatedAtMs: number
) {
  const doc: Record<string, unknown> = {
    uid,
    id: clampString(playlist.id, 160, toFirestoreDocId(playlist.name)),
    schemaVersion: SCHEMA_VERSION,
    name: clampString(playlist.name, 120, 'Untitled Playlist'),
    description: clampString(playlist.description, 300, ''),
    image: sanitizeImageOrUrl(playlist.image, 500),
    isUserCreated: typeof playlist.isUserCreated === 'boolean' ? playlist.isUserCreated : true,
    trackCount: Math.max(0, Math.min(5000, playlist.tracks.length)),
    orderIndex: Math.max(0, Math.min(5000, orderIndex)),
    updatedAtMs: Math.max(0, Math.round(updatedAtMs)),
  };

  const language = clampString(playlist.language, 40, '');
  if (language) doc.language = language;
  if (playlist.region && VALID_REGIONS.has(playlist.region)) doc.region = playlist.region;
  const sourcePageUrl = sanitizeImageOrUrl(playlist.sourcePageUrl, 500);
  if (sourcePageUrl) doc.sourcePageUrl = sourcePageUrl;

  return doc;
}

export function sanitizeFollowedArtistForCloud(
  artist: FollowedArtist,
  fallbackId = 'artist'
): FollowedArtist {
  const id = clampString(artist.id, 160, toFirestoreDocId(artist.name || fallbackId));
  const name = clampString(artist.name, 160, 'Artist');
  const image = sanitizeImageOrUrl(artist.image, 500);
  const followedAtMsRaw = Number(artist.followedAtMs);
  const followedAtMs =
    Number.isFinite(followedAtMsRaw) && followedAtMsRaw >= 0
      ? Math.round(followedAtMsRaw)
      : Date.now();

  const clean: FollowedArtist = {
    id,
    name,
    image,
    followedAtMs,
  };

  const genre = clampString(artist.genre, 120, '');
  if (genre) clean.genre = genre;
  const language = clampString(artist.language, 40, '');
  if (language) clean.language = language;
  const monthlyListeners = clampString(artist.monthlyListeners, 100, '');
  if (monthlyListeners) clean.monthlyListeners = monthlyListeners;
  const bio = clampString(artist.bio, 500, '');
  if (bio) clean.bio = bio;

  return clean;
}

export function restoreFollowedArtistFromCloud(raw: unknown): FollowedArtist | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = clampString(r.id, 160, '');
  const name = clampString(r.name, 160, '');
  if (!id || !name) return null;

  const artist: FollowedArtist = {
    id,
    name,
    image: sanitizeImageOrUrl(r.image, 500),
    followedAtMs:
      typeof r.followedAtMs === 'number' && Number.isFinite(r.followedAtMs) && r.followedAtMs >= 0
        ? Math.round(r.followedAtMs)
        : 0,
  };

  const genre = clampString(r.genre, 120, '');
  if (genre) artist.genre = genre;
  const language = clampString(r.language, 40, '');
  if (language) artist.language = language;
  const monthlyListeners = clampString(r.monthlyListeners, 100, '');
  if (monthlyListeners) artist.monthlyListeners = monthlyListeners;
  const bio = clampString(r.bio, 500, '');
  if (bio) artist.bio = bio;

  return artist;
}

