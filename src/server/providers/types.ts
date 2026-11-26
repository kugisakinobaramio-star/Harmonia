/**
 * Shared types for MusicKK music providers.
 * All catalogue and playback sources must remain available; this module only
 * standardises interfaces so providers can be isolated, timed, and diagnosed.
 */

export type SourceAvailability = 'full' | 'preview' | 'lookup' | 'metadata';

export interface StoredLyricLine {
  time: number;
  text: string;
}

export interface StoredTrack {
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
  sourceAvailability?: SourceAvailability;
  sourcePageUrl?: string;
  sourceLicense?: string;
  offlineAvailable?: boolean;
  previewUrl?: string;
  streamUrls?: Record<string, string>;
  lyrics?: StoredLyricLine[];
  energy?: number;
  bpm?: number;
  moods?: string[];
  synthMood?: string;
}

export type ProviderId =
  | 'jiosaavn'
  | 'apple'
  | 'deezer'
  | 'audius'
  | 'jamendo'
  | 'funkwhale'
  | 'soundcloud'
  | 'musicbrainz'
  | 'internet-archive'
  | 'youtube'
  | 'spotify'
  | 'other';

export interface ProviderSearchContext {
  query: string;
  region: string;
  country: string;
  page: number;
  limit: number;
  offset: number;
  catalogueRequested?: boolean;
}

export interface ProviderSearchResult {
  provider: ProviderId;
  tracks: StoredTrack[];
  /** Milliseconds the provider call took */
  durationMs: number;
  ok: boolean;
  error?: string;
}

export interface ProviderDescriptor {
  id: ProviderId;
  label: string;
  /** What the provider typically contributes */
  contributes: Array<'search' | 'preview' | 'full' | 'metadata' | 'artwork' | 'lyrics'>;
  notes?: string;
}

/** Canonical inventory — never remove entries; only add or mark status. */
export const PROVIDER_INVENTORY: ProviderDescriptor[] = [
  {
    id: 'jiosaavn',
    label: 'JioSaavn (community)',
    contributes: ['search', 'full', 'metadata'],
    notes: 'Third-party / community endpoints; availability can change.',
  },
  {
    id: 'apple',
    label: 'Apple iTunes Search',
    contributes: ['search', 'preview', 'metadata'],
    notes: 'Preview URLs only; not full-length streaming.',
  },
  {
    id: 'deezer',
    label: 'Deezer',
    contributes: ['search', 'preview', 'metadata'],
    notes: 'Short previews; not full-track access.',
  },
  {
    id: 'audius',
    label: 'Audius / Open Audio Protocol',
    contributes: ['search', 'full', 'metadata'],
    notes: 'Rights depend on each upload.',
  },
  {
    id: 'jamendo',
    label: 'Jamendo',
    contributes: ['search', 'full', 'metadata'],
    notes: 'Licence terms apply; non-commercial filters used where possible.',
  },
  {
    id: 'funkwhale',
    label: 'Funkwhale',
    contributes: ['search', 'full', 'metadata'],
    notes: 'Federated; pod availability varies.',
  },
  {
    id: 'soundcloud',
    label: 'SoundCloud',
    contributes: ['search', 'full', 'metadata'],
    notes: 'Best-effort; subject to upstream changes.',
  },
  {
    id: 'musicbrainz',
    label: 'MusicBrainz',
    contributes: ['metadata'],
    notes: 'Catalogue metadata only; no audio.',
  },
  {
    id: 'internet-archive',
    label: 'Internet Archive',
    contributes: ['search', 'full', 'metadata'],
    notes: 'Licence metadata varies by item.',
  },
  {
    id: 'youtube',
    label: 'YouTube',
    contributes: ['search', 'full'],
    notes: 'Embed permissions and regional restrictions apply.',
  },
  {
    id: 'spotify',
    label: 'Spotify',
    contributes: ['metadata'],
    notes: 'Public playlist / embed metadata only; no Spotify playback rights granted.',
  },
];
