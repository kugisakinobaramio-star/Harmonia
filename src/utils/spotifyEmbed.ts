import type { Track } from '../types/music';

export interface SpotifyEmbedTrackEntry {
  uri?: string;
  title?: string;
  subtitle?: string;
  duration?: number;
  isPlayable?: boolean;
  audioPreview?: { url?: string };
}

/**
 * Convert every entry exposed by Spotify's embed payload without applying
 * discovery-quality filters. Playlist import is user-directed: instrumental,
 * remix, region-locked, and duplicate entries must remain in their source order.
 */
export function mapSpotifyEmbedTrackList(
  entries: SpotifyEmbedTrackEntry[],
  playlistId: string,
  albumTitle: string,
  cover: string,
  inferLanguage: (text: string) => Track['language']
): Track[] {
  return entries.map((entry, index) => {
    const sourceTrackId = (entry.uri || '').split(':').pop() || '';
    const name = entry.title?.trim() || 'Untitled Track';
    const artist = entry.subtitle?.trim() || 'Artist';
    const durationMs = Number(entry.duration || 0);
    const sourcePageUrl = sourceTrackId
      ? `https://open.spotify.com/track/${encodeURIComponent(sourceTrackId)}`
      : undefined;

    return {
      // Keep the canonical track ID. Duplicate source entries intentionally
      // remain duplicate array entries at their original positions.
      id: `sp-${sourceTrackId || `${playlistId}-entry-${index}`}`,
      name,
      artist,
      albumName: albumTitle,
      duration: Number.isFinite(durationMs) && durationMs > 0
        ? Math.max(30, Math.round(durationMs / 1000))
        : 195,
      image: cover,
      language: inferLanguage(`${name} ${artist} ${albumTitle}`),
      region: albumTitle.toLowerCase().includes('india') || albumTitle.toLowerCase().includes('hindi')
        ? 'IN'
        : albumTitle.toLowerCase().includes('japan')
          ? 'JP'
          : 'GLOBAL',
      genre: 'Spotify Streaming',
      sourceProvider: 'Spotify',
      sourceAvailability: entry.audioPreview?.url ? 'preview' : 'lookup',
      sourcePageUrl,
      previewUrl: entry.audioPreview?.url || undefined,
    };
  });
}
