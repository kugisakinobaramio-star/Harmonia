export type ViewName = 'home' | 'discover' | 'search' | 'library' | 'downloads' | 'lyrics' | 'collection' | 'artist';
export type SearchTab = 'songs' | 'albums' | 'playlists' | 'artists' | 'videos';
export type AudioQuality = '320kbps' | '160kbps' | '96kbps' | 'auto';
export type RepeatMode = 0 | 1 | 2; // 0 = off, 1 = all, 2 = one
export type MusicRegion = 'IN' | 'JP' | 'US' | 'GB' | 'GLOBAL';
export type MusicLanguage =
  | 'Hindi' | 'Punjabi' | 'Haryanvi' | 'Marathi' | 'Bengali' | 'Tamil' | 'Telugu'
  | 'Kannada' | 'Malayalam' | 'Gujarati' | 'Bhojpuri' | 'Urdu'
  | 'English' | 'French' | 'Spanish' | 'Korean' | 'Japanese' | 'J-Pop'
  | 'Chinese' | 'Arabic' | 'Portuguese' | 'German' | 'Italian' | 'Turkish'
  | 'Thai' | 'Indonesian';
export type EqPreset = 'flat' | 'bass' | 'vocal' | 'latenight';
export type RightPanelMode = 'closed' | 'nowplaying' | 'queue';

export interface LyricLine {
  time: number; // seconds from track start
  text: string;
}

export interface Track {
  id: string;
  name: string;
  artist: string;
  albumName: string;
  year?: string;
  duration: number; // seconds
  playCount?: number;
  image: string;
  language?: MusicLanguage | 'Other';
  region?: MusicRegion;
  genre?: string;
  bpm?: number;
  /** Normalized energy score from 0 to 1, when supplied by the catalogue. */
  energy?: number;
  /** Explicit mood tags supplied by track metadata; never inferred from title text. */
  moods?: string[];
  hasLyrics?: boolean;
  /** Catalogue-only entries; playback must be resolved through a separate audio provider. */
  metadataOnly?: boolean;
  /** Provider that supplied this catalogue entry or its confirmed stream. */
  sourceProvider?: string;
  /** Stream availability advertised by the source; playback can still fail if a provider withdraws a URL. */
  sourceAvailability?: 'full' | 'preview' | 'lookup' | 'metadata';
  /** Canonical provider page, when the provider supplies one. */
  sourcePageUrl?: string;
  /** Recording licence URI supplied by the source catalogue. */
  sourceLicense?: string;
  /** False when the source does not permit Harmonia offline copies. */
  offlineAvailable?: boolean;
  synthMood?: 'synthwave' | 'sunset' | 'lofi' | 'energetic' | 'ambient' | 'pop' | 'hindi' | 'jpop';
  previewUrl?: string;
  streamUrls?: Partial<Record<'320kbps' | '160kbps' | '96kbps' | '48kbps' | '12kbps', string>>;
  lyrics?: LyricLine[];
  youtubeId?: string;
  youtubeAlternates?: string[];
}

export interface AlbumSummary {
  id: string;
  name: string;
  artist: string;
  year: string;
  image: string;
  language?: MusicLanguage;
  trackIds: string[];
}

export interface CuratedPlaylist {
  id: string;
  name: string;
  description: string;
  image: string;
  language?: MusicLanguage | 'Mixed';
  region?: MusicRegion;
  tracks: Track[];
  isUserCreated?: boolean;
  /** Original playlist page for attribution when imported. */
  sourcePageUrl?: string;
  /** Number of entries exposed by the source resolver during import (not necessarily the source's full total). */
  sourceEntriesReceived?: number;
  /** Entries successfully matched to a MusicKK catalogue/playback candidate. */
  matchedTrackCount?: number;
  /** Entries retained as metadata because no confident MusicKK match was found. */
  unmatchedTrackCount?: number;
  importedAt?: string;
}

export interface ArtistProfile {
  id: string;
  name: string;
  genre: string;
  language?: MusicLanguage;
  monthlyListeners: string;
  image: string;
  bio: string;
  topTrackIds: string[];
}

export interface FollowedArtist {
  id: string;
  name: string;
  image: string;
  genre?: string;
  language?: string;
  monthlyListeners?: string;
  bio?: string;
  followedAtMs: number;
}

export interface ArtistTarget {
  id: string;
  name: string;
  image?: string;
  genre?: string;
  language?: string;
  monthlyListeners?: string;
  bio?: string;
}

export interface ArtistAlbumSummary {
  id: string;
  name: string;
  artist: string;
  year?: string;
  image: string;
  trackCount?: number;
  type: 'Album' | 'Single' | 'EP';
  tracks: Track[];
}

export interface RelatedArtistSummary {
  id: string;
  name: string;
  subtitle: string;
  image: string;
  genre?: string;
  language?: string;
}

export interface ArtistPageData {
  artist: ArtistProfile & {
    bannerImage?: string;
    followerCount?: number;
    isVerified?: boolean;
  };
  latestRelease: ArtistAlbumSummary | null;
  popularTracks: Track[];
  allSongs: Track[];
  albums: ArtistAlbumSummary[];
  relatedArtists: RelatedArtistSummary[];
}

export interface VideoResult {
  id: string;
  title: string;
  channel: string;
  dur: string;
  thumbnail?: string;
}

export interface PersonalisationSettings {
  displayName: string;
  region: MusicRegion;
  preferredLanguages: MusicLanguage[];
  favoriteArtists: string[];
  preferredMoods: string[];
  prioritizeLyrics: boolean;
}

export interface UserTasteProfile {
  region: MusicRegion;
  preferredLanguages: MusicLanguage[];
  favoriteArtists?: string[];
  preferredMoods?: string[];
  prioritizeLyrics?: boolean;
  artistAffinity: Record<string, number>;
  languageAffinity: Record<string, number>;
  genreAffinity: Record<string, number>;
  playCounts: Record<string, number>;
  likedIds: string[];
  recentIds: string[];
}

export interface RecommendationShelf {
  id: string;
  title: string;
  reason: string;
  tracks: Track[];
}

export interface CollectionTarget {
  /** Official Spotify iframe player URL for Spotify-backed collections. */
  spotifyEmbedUrl?: string;
  /** Original source page for imported playlist attribution. */
  sourcePageUrl?: string;
  kind: 'playlist' | 'artist' | 'album' | 'liked' | 'recent' | 'recommendations';
  id: string;
  title: string;
  subtitle: string;
  image: string;
  tracks: Track[];
  sourceEntriesReceived?: number;
  matchedTrackCount?: number;
  unmatchedTrackCount?: number;
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        elementId: string | HTMLElement,
        options: {
          height?: string | number;
          width?: string | number;
          videoId?: string;
          playerVars?: Record<string, unknown>;
          events?: {
            onReady?: (event: { target: any }) => void;
            onStateChange?: (event: { data: number }) => void;
            onError?: (event: { data: number }) => void;
          };
        }
      ) => any;
      PlayerState?: {
        ENDED: number;
        PLAYING: number;
        PAUSED: number;
        BUFFERING: number;
        CUED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

