import type { Track } from '../types/music';
import type { AIProviderStatus } from './types';

export interface MusicMetadataProvider {
  readonly id: string;
  searchRecordings(query: string, signal?: AbortSignal): Promise<Track[]>;
}

export const musicBrainzStatus: AIProviderStatus = {
  id: 'musicbrainz',
  available: true,
  requiresCredential: false,
  note: 'Public metadata lookup; rate-limited and never a streaming source.',
};

/** Public MusicBrainz recording lookup. A meaningful User-Agent is supplied. */
export const musicBrainzProvider: MusicMetadataProvider = {
  id: 'musicbrainz',
  async searchRecordings(query, signal) {
    const url = new URL('https://musicbrainz.org/ws/2/recording/');
    url.searchParams.set('query', query);
    url.searchParams.set('fmt', 'json');
    url.searchParams.set('limit', '8');
    const response = await fetch(url, {
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`MusicBrainz lookup failed (${response.status})`);
    const payload = await response.json() as { recordings?: Array<{
      id?: string; title?: string; length?: number;
      'artist-credit'?: Array<string | { name?: string; artist?: { name?: string } }>;
      releases?: Array<{ title?: string; date?: string }>;
    }> };
    return (payload.recordings || []).filter((item) => item.id && item.title).map((item) => {
      const artist = (item['artist-credit'] || []).map((entry) =>
        typeof entry === 'string' ? entry : entry.name || entry.artist?.name || ''
      ).filter(Boolean).join(', ');
      return {
        id: `mb-rec:${item.id}`,
        name: item.title || 'Unknown recording',
        artist: artist || 'Unknown artist',
        albumName: item.releases?.[0]?.title || 'Recording',
        year: item.releases?.[0]?.date?.slice(0, 4),
        duration: item.length ? Math.round(item.length / 1000) : 0,
        image: '',
        metadataOnly: true,
        sourceProvider: 'MusicBrainz',
        sourceAvailability: 'metadata' as const,
      };
    });
  },
};

/** Last.fm needs an API key. No key is embedded, persisted, or requested by this module. */
export function createLastFmProvider(apiKey: string) {
  return {
    id: 'lastfm',
    async similarTracks(artist: string, track: string, signal?: AbortSignal) {
      if (!apiKey.trim()) throw new Error('Last.fm API key is not configured.');
      const url = new URL('https://ws.audioscrobbler.com/2.0/');
      url.search = new URLSearchParams({
        method: 'track.getsimilar', artist, track, api_key: apiKey, format: 'json', limit: '12',
      }).toString();
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error(`Last.fm lookup failed (${response.status})`);
      const payload = await response.json() as { similartracks?: { track?: Array<{ name?: string; artist?: { name?: string } }> } };
      return (payload.similartracks?.track || []).map((item) => ({
        name: item.name || '',
        artist: item.artist?.name || '',
      })).filter((item) => item.name && item.artist);
    },
  };
}
