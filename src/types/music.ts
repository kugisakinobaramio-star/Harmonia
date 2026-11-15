export type ViewName = 'home' | 'discover' | 'search' | 'library' | 'downloads' | 'lyrics' | 'collection';
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
  hasLyrics?: boolean;
  /** Catalogue-only entries; playback must be resolved through a separate audio provider. */
  metadataOnly?: boolean;
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
  kind: 'playlist' | 'artist' | 'album' | 'liked' | 'recent' | 'recommendations';
  id: string;
  title: string;
  subtitle: string;
  image: string;
  tracks: Track[];
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

