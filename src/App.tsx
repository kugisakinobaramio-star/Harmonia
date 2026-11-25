import { Compass, Home, Library, Search } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { MediaSession } from '@capgo/capacitor-media-session';
import { apiUrl } from './utils/apiUrl';
import { curateAIRecommendations } from './ai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CollectionView } from './components/CollectionView';
import { DiscoverView } from './components/DiscoverView';
import { ExpandedPlayer } from './components/ExpandedPlayer';
import { Header } from './components/Header';
import { HomeView } from './components/HomeView';
import { LibraryView } from './components/LibraryView';
import { OfflineDownloadsView } from './components/OfflineDownloadsView';
import { LyricsView } from './components/LyricsView';
import {
  AddToPlaylistModal,
  CreatePlaylistModal,
  PersonaliseModal,
  ProfileModal,
  SpotifyImportModal,
  VideoModal,
} from './components/Modals';
import { PlayerBar } from './components/PlayerBar';
import { RightPanel } from './components/RightPanel';
import { SearchView } from './components/SearchView';
import { WelcomeExperience } from './components/WelcomeExperience';
import { Sidebar } from './components/Sidebar';
import { ARTWORK, SEED_ARTISTS, SEED_PLAYLISTS, SEED_TRACKS } from './data/catalog';
import type {
  ArtistProfile,
  AudioQuality,
  CollectionTarget,
  CuratedPlaylist,
  EqPreset,
  LyricLine,
  MusicLanguage,
  MusicRegion,
  PersonalisationSettings,
  RepeatMode,
  RightPanelMode,
  SearchTab,
  Track,
  VideoResult,
  ViewName,
} from './types/music';
import {
  buildTasteProfile,
  fetchBackendUserState,
  fetchPlayableDiscoveries,
  fetchTrackLyrics,
  resolveSpotifyUrl,
  resolveTrackStreams,
  searchSongs,
  searchVideos,
  sendUserEvent,
  syncBackendPlaylists,
} from './utils/musicApi';
import {
  addTrackToPlaylist,
  cycleQuality,
  createShuffleBag,
  deriveDynamicTasteHighlights,
  hasFullAudioStream,
  hasFullPlaybackSource,
  isSpotifyLinkOrUri,
  isInstrumentalOrLowValueTrack,
  mapCoordsToRegion,
  REGION_LABELS,
  reorderQueueItem,
  removeQueueItem,
  resolveNextTrackIndex,
  scoreAuthenticTrackCandidate,
  toggleTrackInLiked,
} from './utils/playerEngine';
import { partitionStreamCandidates } from './utils/streamCandidates';
import { audioEngine } from './utils/webAudioSynth';
import {
  downloadTrackForOffline,
  getOfflineAudioUrl,
  isCollectionFullyDownloaded,
  listOfflineTracks,
  removeOfflineTrack,
} from './utils/offlineStore';

const SILENT_WAV_DATA_URI =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

function buildStreamCandidates(
  track: Track,
  quality: AudioQuality,
  extraAlternates: string[] = [],
  includePreviewFallback = false
): string[] {
  const { full, preview } = partitionStreamCandidates(track, quality, extraAlternates, apiUrl);
  if (full.length > 0) return full;
  return includePreviewFallback ? preview : [];
}

interface NavEntry {
  view: ViewName;
  collection: CollectionTarget | null;
}

const STORAGE_KEY = 'harmonia_spotify_state_v2';

function withoutPersistedProviderAudio(track: Track): Track {
  if (track.sourceProvider !== 'Jamendo') return track;
  // Jamendo terms permit online playback through the API but prohibit building
  // offline copies. Keep user library metadata, not provider stream URLs.
  return { ...track, streamUrls: undefined, previewUrl: undefined, offlineAvailable: false };
}

function loadLocalSnapshot(): {
  displayName?: string;
  region?: MusicRegion;
  preferredLanguages?: MusicLanguage[];
  favoriteArtists?: string[];
  preferredMoods?: string[];
  prioritizeLyrics?: boolean;
  likedMap?: Record<string, Track>;
  playlists?: CuratedPlaylist[];
  recentlyPlayed?: Track[];
  artistAffinity?: Record<string, number>;
  languageAffinity?: Record<string, number>;
  genreAffinity?: Record<string, number>;
  playCounts?: Record<string, number>;
  listeningFeedback?: Record<string, { skips: number; completions: number }>;
  playedTracks?: Record<string, Track>;
  tasteResetActive?: boolean;
  tasteLikedMap?: Record<string, Track>;
  tasteRecentTracks?: Track[];
  volume?: number;
  quality?: AudioQuality;
  eqPreset?: EqPreset;
} {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export default function App() {
  const initialSnap = useMemo(() => loadLocalSnapshot(), []);
  const [welcomeSetupComplete] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem('musick_mood_setup_complete_v1') === 'true'
  );
  const [welcomeVisible, setWelcomeVisible] = useState(() => !welcomeSetupComplete);
  // Navigation & history stack
  const [navHistory, setNavHistory] = useState<NavEntry[]>([{ view: 'home', collection: null }]);
  const [navIndex, setNavIndex] = useState(0);
  const currentNav = navHistory[navIndex] || { view: 'home', collection: null };
  const activeView = currentNav.view;
  const activeCollection = currentNav.collection;

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>(() =>
    typeof window !== 'undefined' && window.innerWidth < 1280 ? 'closed' : 'nowplaying'
  );

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth < 1280) {
        setRightPanelMode('closed');
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTab, setSearchTab] = useState<SearchTab>('songs');
  const [drillCollection, setDrillCollection] = useState<{
    kind: 'albums' | 'playlists' | 'artists';
    id: string;
  } | null>(null);

  // Location, Language, Personalisation & User Taste state
  const [displayName, setDisplayName] = useState<string>(initialSnap.displayName || 'Listener');
  const [region, setRegion] = useState<MusicRegion>(initialSnap.region || 'IN');
  const [detectingLocation, setDetectingLocation] = useState(false);
  const [preferredLanguages, setPreferredLanguages] = useState<MusicLanguage[]>(
    initialSnap.preferredLanguages || []
  );
  const [favoriteArtists, setFavoriteArtists] = useState<string[]>(
    initialSnap.favoriteArtists || []
  );
  const [preferredMoods, setPreferredMoods] = useState<string[]>(
    initialSnap.preferredMoods || []
  );
  const [prioritizeLyrics, setPrioritizeLyrics] = useState<boolean>(
    typeof initialSnap.prioritizeLyrics === 'boolean' ? initialSnap.prioritizeLyrics : true
  );
  const [languageFilter, setLanguageFilter] = useState<MusicLanguage | 'All'>('All');
  const [regionalTracks, setRegionalTracks] = useState<Track[]>([]);
  const [personalizedFeedTracks, setPersonalizedFeedTracks] = useState<Track[]>([]);

  const [likedMap, setLikedMap] = useState<Record<string, Track>>(initialSnap.likedMap || {});
  const [userPlaylists, setUserPlaylists] = useState<CuratedPlaylist[]>(
    initialSnap.playlists || []
  );
  const [recentlyPlayed, setRecentlyPlayed] = useState<Track[]>(
    initialSnap.recentlyPlayed || []
  );
  const [artistAffinity, setArtistAffinity] = useState<Record<string, number>>(
    initialSnap.artistAffinity || {}
  );
  const [languageAffinity, setLanguageAffinity] = useState<Record<string, number>>(
    initialSnap.languageAffinity || {}
  );
  const [genreAffinity, setGenreAffinity] = useState<Record<string, number>>(
    initialSnap.genreAffinity || {}
  );
  const [playCounts, setPlayCounts] = useState<Record<string, number>>(
    initialSnap.playCounts || {}
  );
  const [listeningFeedback, setListeningFeedback] = useState<Record<string, { skips: number; completions: number }>>(initialSnap.listeningFeedback || {});
  const recordListeningFeedback = useCallback((trackId: string, signal: 'skip' | 'completion') => {
    setListeningFeedback((previous) => {
      const current = previous[trackId] || { skips: 0, completions: 0 };
      return { ...previous, [trackId]: { ...current, [signal === 'skip' ? 'skips' : 'completions']: current[signal === 'skip' ? 'skips' : 'completions'] + 1 } };
    });
  }, []);
  const [playedTracks, setPlayedTracks] = useState<Record<string, Track>>(
    initialSnap.playedTracks || {}
  );
  // Keep post-reset signals separate so old Library history cannot silently
  // repopulate a taste profile that the listener deliberately cleared.
  const [tasteResetActive, setTasteResetActive] = useState(Boolean(initialSnap.tasteResetActive));
  const [tasteLikedMap, setTasteLikedMap] = useState<Record<string, Track>>(initialSnap.tasteLikedMap || {});
  const [tasteRecentTracks, setTasteRecentTracks] = useState<Track[]>(initialSnap.tasteRecentTracks || []);
  const recommendationLikedMap = tasteResetActive ? tasteLikedMap : likedMap;
  const recommendationRecentTracks = tasteResetActive ? tasteRecentTracks : recentlyPlayed;

  // Audio playback state
  const [queue, setQueue] = useState<Track[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(0);
  const [volume, setVolume] = useState<number>(
    typeof initialSnap.volume === 'number' ? initialSnap.volume : 85
  );
  const [quality, setQuality] = useState<AudioQuality>(initialSnap.quality || '320kbps');
  const [eqPreset, setEqPreset] = useState<EqPreset>(initialSnap.eqPreset || 'flat');
  const [sleepMinutesLeft, setSleepMinutesLeft] = useState<number | null>(null);

  // Synced Lyrics state
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [lyricsSynced, setLyricsSynced] = useState(true);

  // User modals & toast
  const [expandedPlayerOpen, setExpandedPlayerOpen] = useState(false);
  const [createPlaylistOpen, setCreatePlaylistOpen] = useState(false);
  const [addToPlaylistTrack, setAddToPlaylistTrack] = useState<Track | null>(null);
  const [spotifyImportOpen, setSpotifyImportOpen] = useState(false);
  const [personaliseOpen, setPersonaliseOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [videos, setVideos] = useState<VideoResult[]>([]);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [videoSearchQuery, setVideoSearchQuery] = useState('');
  const [videoSearchLoading, setVideoSearchLoading] = useState(false);
  const [videoSearchError, setVideoSearchError] = useState('');
  const videoSearchRequestRef = useRef(0);
  const [toastMsg, setToastMsg] = useState<string>('');
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(() => new Set());
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(() => new Set());

  // Refs for audio control and main scroll reset
  const mainScrollRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioRef2 = useRef<HTMLAudioElement | null>(null);
  const activeAudioSlotRef = useRef<1 | 2>(1);
  const candidateUrlsRef = useRef<string[]>([]);
  const candidateIdxRef = useRef<number>(0);
  const candidateFailureRef = useRef<() => void>(() => {});
  const usingSynthRef = useRef<boolean>(false);
  const synthTimeRef = useRef<number>(0);
  const playbackSeqRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(false);
  const currentTrack = queue.length ? queue[currentIndex] || queue[0] || null : null;
  const currentTrackRef = useRef<Track | null>(currentTrack);
  // Retain the latest resolved object separately: queue state/effects can briefly
  // expose the pre-resolution track while the YouTube iframe reports an error.
  const resolvedPlaybackTrackRef = useRef<Track | null>(null);
  const activeEngineRef = useRef<'audio' | 'yt'>('audio');
  const ytPlayerRef = useRef<any>(null);
  const isYtReadyRef = useRef<boolean>(false);
  const pendingYtVideoIdRef = useRef<string | null>(null);
  const advanceTrackRef = useRef<(direction: 1 | -1, autoAdvance: boolean) => void>(() => {});
  // Track IDs, rather than queue positions, keep shuffle history stable when
  // users reorder or remove queue entries.
  const shuffleHistoryRef = useRef<string[]>([]);
  const shuffleFutureRef = useRef<string[]>([]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

  // Keep progress polling lightweight on mobile WebViews. The player UI only
  // needs whole-second updates; playback itself continues independently.
  useEffect(() => {
    if (!isPlaying) return;
    const interval = window.setInterval(() => {
      if (activeEngineRef.current !== 'yt') return;
      const player = ytPlayerRef.current;
      if (!player) return;
      try {
        const cur = player.getCurrentTime?.();
        const dur = player.getDuration?.();
        if (typeof cur === 'number' && Number.isFinite(cur) && cur >= 0) {
          currentTimeRef.current = cur;
          setCurrentTime(cur);
        }
        if (typeof dur === 'number' && Number.isFinite(dur) && dur > 30) {
          setDuration(dur);
        }
      } catch {
        // Non-fatal
      }
    }, expandedPlayerOpen || activeView === 'lyrics' ? 250 : 1000);
    return () => window.clearInterval(interval);
  }, [isPlaying, expandedPlayerOpen, activeView]);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
  }, []);

  useEffect(() => {
    let active = true;
    const refreshDownloads = () => {
      listOfflineTracks()
        .then((items) => {
          if (active) setDownloadedIds(new Set(items.map((item) => item.id)));
        })
        .catch(() => {
          if (active) showToast('Offline storage is unavailable in this browser.');
        });
    };
    refreshDownloads();
    window.addEventListener('harmonia-offline-library-change', refreshDownloads);
    return () => {
      active = false;
      window.removeEventListener('harmonia-offline-library-change', refreshDownloads);
    };
  }, [showToast]);

  const handleToggleDownload = useCallback(async (track: Track) => {
    if (track.offlineAvailable === false || track.sourceProvider === 'Jamendo') {
      showToast('This provider supports online listening only in MusicKK.');
      return;
    }
    if (downloadingIds.has(track.id)) return;
    setDownloadingIds((current) => new Set(current).add(track.id));
    try {
      if (downloadedIds.has(track.id)) {
        await removeOfflineTrack(track.id);
        setDownloadedIds((current) => {
          const next = new Set(current);
          next.delete(track.id);
          return next;
        });
        window.dispatchEvent(new Event('harmonia-offline-library-change'));
        showToast(`Removed ${track.name} from offline downloads.`);
      } else {
        await downloadTrackForOffline(track, quality);
        setDownloadedIds((current) => new Set(current).add(track.id));
        window.dispatchEvent(new Event('harmonia-offline-library-change'));
        showToast(`Saved ${track.name} for offline listening.`);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not update offline downloads.');
    } finally {
      setDownloadingIds((current) => {
        const next = new Set(current);
        next.delete(track.id);
        return next;
      });
    }
  }, [downloadedIds, downloadingIds, quality, showToast]);

  const handleDownloadAll = useCallback(async (tracks: Track[]) => {
    const downloadableTracks = tracks.filter(
      (track) => track.offlineAvailable !== false && track.sourceProvider !== 'Jamendo'
    );
    if (!downloadableTracks.length) {
      showToast('These tracks support online listening only in MusicKK.');
      return;
    }

    const removeAll = isCollectionFullyDownloaded(downloadableTracks, downloadedIds);
    const targets = downloadableTracks.filter((track) => {
      if (downloadingIds.has(track.id)) return false;
      return removeAll ? downloadedIds.has(track.id) : !downloadedIds.has(track.id);
    });
    if (!targets.length) return;

    setDownloadingIds((current) => {
      const next = new Set(current);
      targets.forEach((t) => next.add(t.id));
      return next;
    });

    let succeeded = 0;
    let failed = 0;
    let nextCursor = 0;
    const workerCount = removeAll ? 1 : Math.min(2, targets.length);

    const runWorker = async () => {
      while (nextCursor < targets.length) {
        const track = targets[nextCursor++];
        if (!track) continue;
        try {
          if (removeAll) {
            await removeOfflineTrack(track.id);
            setDownloadedIds((current) => {
              const next = new Set(current);
              next.delete(track.id);
              return next;
            });
          } else {
            await downloadTrackForOffline(track, quality);
            setDownloadedIds((current) => new Set(current).add(track.id));
          }
          succeeded += 1;
        } catch {
          failed += 1;
        } finally {
          setDownloadingIds((current) => {
            const next = new Set(current);
            next.delete(track.id);
            return next;
          });
        }
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
    window.dispatchEvent(new Event('harmonia-offline-library-change'));

    if (removeAll) {
      showToast(
        succeeded > 0
          ? `Removed ${succeeded} song${succeeded === 1 ? '' : 's'} from offline downloads.`
          : 'Could not remove offline downloads.'
      );
    } else if (failed === 0) {
      showToast(`Saved ${succeeded} song${succeeded === 1 ? '' : 's'} for offline listening.`);
    } else if (succeeded > 0) {
      showToast(
        `Saved ${succeeded} song${succeeded === 1 ? '' : 's'}; ${failed} unavailable offline.`
      );
    } else {
      showToast('Could not download these songs for offline listening.');
    }
  }, [downloadedIds, downloadingIds, quality, showToast]);

  useEffect(() => {
    if (!toastMsg) return;
    const t = window.setTimeout(() => setToastMsg(''), 2800);
    return () => window.clearTimeout(t);
  }, [toastMsg]);

  // Hydrate persistent state from Express backend on mount
  useEffect(() => {
    let active = true;
    fetchBackendUserState().then((state) => {
      if (!active || !state) return;
      if (state.displayName) setDisplayName(state.displayName);
      if (state.region) setRegion(state.region);
      if (state.preferredLanguages?.length) setPreferredLanguages(state.preferredLanguages);
      if (Array.isArray(state.favoriteArtists)) setFavoriteArtists(state.favoriteArtists);
      if (Array.isArray(state.preferredMoods)) setPreferredMoods(state.preferredMoods);
      if (typeof state.prioritizeLyrics === 'boolean') setPrioritizeLyrics(state.prioritizeLyrics);
      if (state.likedMap && Object.keys(state.likedMap).length > 0) setLikedMap(state.likedMap);
      if (state.playlists?.length) setUserPlaylists(state.playlists);
      if (state.recentlyPlayed?.length) setRecentlyPlayed(state.recentlyPlayed);
      if (state.artistAffinity) setArtistAffinity(state.artistAffinity);
      if (state.languageAffinity) setLanguageAffinity(state.languageAffinity);
      if (state.genreAffinity) setGenreAffinity(state.genreAffinity);
      if (state.playCounts) setPlayCounts(state.playCounts);
    });
    return () => {
      active = false;
    };
  }, []);

  // Persist local snapshot
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          displayName,
          region,
          preferredLanguages,
          favoriteArtists,
          preferredMoods,
          prioritizeLyrics,
          likedMap: Object.fromEntries(
            Object.entries(likedMap).map(([id, track]) => [id, withoutPersistedProviderAudio(track)])
          ),
          playlists: userPlaylists.map((playlist) => ({
            ...playlist,
            tracks: playlist.tracks.map(withoutPersistedProviderAudio),
          })),
          recentlyPlayed: recentlyPlayed.slice(0, 20).map(withoutPersistedProviderAudio),
          artistAffinity,
          languageAffinity,
          genreAffinity,
          playCounts,
          listeningFeedback: Object.fromEntries(Object.entries(listeningFeedback).slice(-1000)),
          playedTracks: Object.fromEntries(
            Object.entries(playedTracks).map(([id, track]) => [id, withoutPersistedProviderAudio(track)])
          ),
          tasteResetActive,
          tasteLikedMap: Object.fromEntries(
            Object.entries(tasteLikedMap).map(([id, track]) => [id, withoutPersistedProviderAudio(track)])
          ),
          tasteRecentTracks: tasteRecentTracks.map(withoutPersistedProviderAudio),
          volume,
          quality,
          eqPreset,
        })
      );
    } catch {
      // Ignore storage quota issues
    }
  }, [
    displayName,
    region,
    preferredLanguages,
    favoriteArtists,
    preferredMoods,
    prioritizeLyrics,
    likedMap,
    userPlaylists,
    recentlyPlayed,
    artistAffinity,
    languageAffinity,
    genreAffinity,
    playCounts,
    listeningFeedback,
    playedTracks,
    tasteResetActive,
    tasteLikedMap,
    tasteRecentTracks,
    volume,
    quality,
    eqPreset,
  ]);

  // Warm worldwide discovery in the background so the first Discover visit is not a cold fetch.
  const [globalTracks, setGlobalTracks] = useState<Track[]>([]);
  const [globalTracksLoaded, setGlobalTracksLoaded] = useState(false);
  const [globalTracksLoading, setGlobalTracksLoading] = useState(false);
  useEffect(() => {
    if (globalTracksLoaded) return;
    let cancelled = false;
    setGlobalTracksLoading(true);
    fetchPlayableDiscoveries('GLOBAL').then((tracks) => {
      if (cancelled) return;
      setGlobalTracks(tracks);
      setGlobalTracksLoaded(true);
    }).finally(() => {
      if (!cancelled) setGlobalTracksLoading(false);
    });
    return () => { cancelled = true; };
  }, [globalTracksLoaded]);

  // Fetch location-based tracks whenever region updates
  useEffect(() => {
    let cancelled = false;
    fetchPlayableDiscoveries(region).then((tracks) => {
      if (cancelled) return;
      // Keep tracks with missing lyric metadata discoverable; ranking handles the preference.
      setRegionalTracks(tracks);
    });
    return () => {
      cancelled = true;
    };
  }, [region]);

  // Build discovery queries only from explicit picks and the listener's own activity.
  useEffect(() => {
    let cancelled = false;
    const historyTracks = [...Object.values(recommendationLikedMap), ...recommendationRecentTracks];
    const artistSeeds = [
      ...favoriteArtists,
      ...Object.entries(artistAffinity)
        .filter(([, weight]) => weight > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([artist]) => artist),
      ...historyTracks.map((track) => track.artist.split(',')[0]?.trim()).filter(Boolean),
    ];
    const uniqueArtists = [...new Set(artistSeeds.map((artist) => artist.toLowerCase()))]
      .map((key) => artistSeeds.find((artist) => artist.toLowerCase() === key) || '')
      .filter(Boolean)
      .slice(0, 3);
    const topGenres = Object.entries(genreAffinity)
      .filter(([, weight]) => weight > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([genre]) => genre);
    // Blend several independent taste signals instead of letting one artist
    // dominate the entire discovery query set.
    const queries = [
      ...topGenres,
      ...uniqueArtists,
      ...preferredLanguages.slice(0, 2),
      ...preferredMoods.slice(0, 2),
    ].filter(Boolean).slice(0, 8);
    if (!queries.length) {
      setPersonalizedFeedTracks([]);
      return () => { cancelled = true; };
    }

    Promise.allSettled(
      queries.map((query) => searchSongs(query, { region, prioritizeLyrics }))
    ).then((settled) => {
      if (cancelled) return;
      const seen = new Set<string>();
      const combined: Track[] = [];
      for (const result of settled) {
        if (result.status !== 'fulfilled') continue;
        for (const track of result.value.tracks) {
          const key = `${track.name.toLowerCase()}::${track.artist.split(',')[0]?.trim().toLowerCase()}`;
          if (!seen.has(key)) {
            seen.add(key);
            combined.push(track);
          }
        }
      }
      setPersonalizedFeedTracks(combined.slice(0, 24));
    });

    return () => { cancelled = true; };
  }, [favoriteArtists, artistAffinity, genreAffinity, recommendationLikedMap, recommendationRecentTracks, region, prioritizeLyrics]);

  // Dynamic User-Based Recommendation Ranking
  const { recommendedTracks, recommendationReason } = useMemo(() => {
    const tasteProfile = buildTasteProfile({
      region,
      preferredLanguages,
      favoriteArtists,
      preferredMoods,
      prioritizeLyrics,
      artistAffinity,
      languageAffinity,
      genreAffinity,
      playCounts,
      likedMap: recommendationLikedMap,
      recentlyPlayed: recommendationRecentTracks,
    });

    const combined: Track[] = [];
    const seenKeys = new Set<string>();
    for (const track of [
      ...personalizedFeedTracks,
      ...Object.values(recommendationLikedMap),
      ...recommendationRecentTracks,
      ...regionalTracks,
    ]) {
      if (isInstrumentalOrLowValueTrack(track)) continue;
      const key = `${track.name.toLowerCase()}::${track.artist.split(',')[0]?.trim().toLowerCase()}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        combined.push(track);
      }
    }

    const curated = curateAIRecommendations(
      [...combined, ...SEED_TRACKS],
      Object.values(recommendationLikedMap),
      recommendationRecentTracks,
      80,
      { preferredMoods, favoriteArtists, preferredLanguages, genreAffinity, artistAffinity, playCounts, listeningFeedback },
    );
    const ranked = curated.map((item) => item.track);
    const strongestReason = curated.find((item) => item.confidence >= 0.25 && item.signals.length > 0)?.reason;
    const recommendationReason = strongestReason
      || 'MusicKK is exploring new sounds while learning from your listening.';

    return {
      recommendedTracks: ranked,
      recommendationReason,
    };
  }, [
    region,
    preferredLanguages,
    favoriteArtists,
    preferredMoods,
    prioritizeLyrics,
    artistAffinity,
    languageAffinity,
    genreAffinity,
    playCounts,
    recommendationLikedMap,
    recommendationRecentTracks,
    regionalTracks,
    personalizedFeedTracks,
  ]);

    const suggestionCandidates = useMemo(() => {
    const unique = new Map<string, Track>();
    for (const candidate of [
      ...recommendedTracks,
      ...personalizedFeedTracks,
      ...regionalTracks,
      ...Object.values(recommendationLikedMap),
      ...SEED_TRACKS,
    ]) {
      if (!candidate?.id || !candidate.name || !candidate.artist) continue;
      if (!unique.has(candidate.id)) unique.set(candidate.id, candidate);
    }
    return [...unique.values()];
  }, [recommendedTracks, personalizedFeedTracks, regionalTracks, recommendationLikedMap]);

// Keep Discover's input identity stable across unrelated player/time updates.
  const discoverTracks = useMemo(
    () => [...regionalTracks, ...personalizedFeedTracks, ...recommendedTracks],
    [regionalTracks, personalizedFeedTracks, recommendedTracks]
  );

  // Navigation helper with Forward/Back history
  const navigateTo = useCallback(
    (view: ViewName, collection: CollectionTarget | null = null) => {
      setNavHistory((prev) => {
        const sliced = prev.slice(0, navIndex + 1);
        const last = sliced[sliced.length - 1];
        if (last && last.view === view && last.collection?.id === collection?.id) {
          return prev;
        }
        return [...sliced, { view, collection }];
      });
      setNavIndex((prev) => prev + 1);
      mainScrollRef.current?.scrollTo({ top: 0 });
    },
    [navIndex]
  );

  const handleGoBack = useCallback(() => {
    setNavIndex((idx) => Math.max(0, idx - 1));
  }, []);

  const handleGoForward = useCallback(() => {
    setNavIndex((idx) => Math.min(navHistory.length - 1, idx + 1));
  }, [navHistory.length]);

  const loadAndPlayCandidate = useCallback(
    (idx: number, playSeq: number, onAllFailed: () => void, resumeAt = 0) => {
      const a1 = audioRef.current;
      const a2 = audioRef2.current;
      if (!a1 || !a2 || playSeq !== playbackSeqRef.current) return;
      if (idx >= candidateUrlsRef.current.length) {
        onAllFailed();
        return;
      }

      candidateIdxRef.current = idx;
      const url = candidateUrlsRef.current[idx];

      const outgoing = activeAudioSlotRef.current === 1 ? a1 : a2;
      const incoming = activeAudioSlotRef.current === 1 ? a2 : a1;
      activeAudioSlotRef.current = activeAudioSlotRef.current === 1 ? 2 : 1;

      // Keep native HTMLAudioElement playback outside the Web Audio CORS security
      // boundary. Cross-origin media can play normally without CORS, but setting
      // crossOrigin='anonymous' and routing it through MediaElementAudioSourceNode
      // makes browsers output silence when the host omits Access-Control-Allow-Origin.
      incoming.removeAttribute('crossOrigin');
      incoming.src = url;
      if (resumeAt > 0) {
        const restorePosition = () => {
          if (playSeq !== playbackSeqRef.current || candidateIdxRef.current !== idx) return;
          try {
            const seekableEnd = Number.isFinite(incoming.duration) ? incoming.duration : resumeAt;
            incoming.currentTime = Math.max(0, Math.min(resumeAt, seekableEnd || resumeAt));
          } catch {
            // Some providers do not expose a seekable range immediately after metadata.
          }
        };
        incoming.addEventListener('loadedmetadata', restorePosition, { once: true });
      }
      incoming.volume = 0;
      incoming.muted = volume === 0;

      // Some hosts leave a media request stalled without firing an error.
      // Advance only if this candidate is still active and playback never began.
      const candidateSlot: 1 | 2 = incoming === a1 ? 1 : 2;
      let candidateFailed = false;
      let hasStartedPlaying = false;
      let startupTimer = 0;
      let stallTimer = 0;
      const clearCandidateWatch = () => {
        if (startupTimer) window.clearTimeout(startupTimer);
        if (stallTimer) window.clearTimeout(stallTimer);
        incoming.removeEventListener('playing', onCandidatePlaying);
        incoming.removeEventListener('error', onCandidateError);
        incoming.removeEventListener('waiting', onCandidateWaiting);
        incoming.removeEventListener('stalled', onCandidateWaiting);
      };
      const onCandidatePlaying = () => {
        hasStartedPlaying = true;
        if (startupTimer) window.clearTimeout(startupTimer);
        if (stallTimer) window.clearTimeout(stallTimer);
        startupTimer = 0;
        stallTimer = 0;
        setIsPlaying(true);
        // Keep listening after startup: seeking can emit waiting/stalled followed by
        // playing. That resumed playing event must cancel the stall-recovery timer.
      };
      const onCandidateWaiting = () => {
        // A stream can begin successfully and then stall indefinitely. Give it
        // a recovery window, then move to the next verified source if it stays stuck.
        if (!hasStartedPlaying || candidateFailed || stallTimer) return;
        stallTimer = window.setTimeout(() => {
          stallTimer = 0;
          onCandidateError();
        }, 12_000);
      };
      const onCandidateError = () => {
        if (candidateFailed) return;
        candidateFailed = true;
        clearCandidateWatch();
        if (playSeq !== playbackSeqRef.current) return;
        incoming.pause();
        const resumePosition = Math.max(
          Number.isFinite(incoming.currentTime) ? incoming.currentTime : 0,
          currentTimeRef.current || 0
        );
        incoming.removeAttribute('src');
        incoming.load();
        loadAndPlayCandidate(idx + 1, playSeq, onAllFailed, resumePosition);
      };
      incoming.addEventListener('playing', onCandidatePlaying);
      incoming.addEventListener('error', onCandidateError, { once: true });
      incoming.addEventListener('waiting', onCandidateWaiting);
      incoming.addEventListener('stalled', onCandidateWaiting);
      startupTimer = window.setTimeout(() => {
        if (
          playSeq !== playbackSeqRef.current ||
          activeAudioSlotRef.current !== candidateSlot ||
          candidateIdxRef.current !== idx
        ) {
          clearCandidateWatch();
          return;
        }
        // A fulfilled play() promise does not guarantee that audio ever reaches
        // the playing state (some providers stall indefinitely). Fail over unless
        // the browser emitted a real playing event.
        if (!hasStartedPlaying) onCandidateError();
        else clearCandidateWatch();
      }, 12_000);

      incoming.play().then(() => {
        if (
          candidateFailed ||
          playSeq !== playbackSeqRef.current ||
          activeAudioSlotRef.current !== candidateSlot ||
          incoming.getAttribute('src') !== url
        ) return;
        // Use a hard handoff instead of a timed crossfade. A stale fade interval
        // could otherwise keep an older slot audible after rapid track changes.
        incoming.volume = volume / 100;
        incoming.muted = volume === 0;
        try {
          outgoing.pause();
          outgoing.removeAttribute('src');
          outgoing.load();
        } catch {}
      }).catch(() => {
        if (!candidateFailed) onCandidateError();
      });
    },
    [volume]
  );

  // Sync initial volume & cleanup on unmount
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = volume / 100;
    return () => {
      audio?.pause();
      try {
        ytPlayerRef.current?.pauseVideo?.();
      } catch {}
      audioEngine.stopSynthLoop();
    };
  }, []);

  // Initialize invisible YouTube background player for zero-preview full-length studio tracks
  useEffect(() => {
    const initYt = () => {
      if (!window.YT || !window.YT.Player) return;
      if (ytPlayerRef.current) return;
      try {
        ytPlayerRef.current = new window.YT.Player('harmonia-bg-yt-player', {
          height: '200',
          width: '200',
          videoId: 'J7p4bzqLvCw',
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            fs: 0,
            playsinline: 1,
            rel: 0,
          },
          events: {
            onReady: (event: any) => {
              isYtReadyRef.current = true;
              try {
                event.target.setVolume(volume);
                if (volume === 0) event.target.mute();
                if (pendingYtVideoIdRef.current) {
                  const vid = pendingYtVideoIdRef.current;
                  pendingYtVideoIdRef.current = null;
                  event.target.loadVideoById(vid);
                  event.target.playVideo();
                  setIsPlaying(true);
                }
              } catch {}
            },
            onStateChange: (event: any) => {
              const state = event.data;
              // The hidden YouTube player is initialized with a placeholder video.
              // Its ENDED event must never advance a track playing on the native audio engine.
              if (activeEngineRef.current !== 'yt') return;
              if (state === 0) {
                const endedTrack = currentTrackRef.current;
                if (endedTrack?.id) recordListeningFeedback(endedTrack.id, 'completion');
                advanceTrackRef.current(1, true);
              } else if (state === 1) {
                setIsPlaying(true);
              }
            },
            onError: (event: any) => {
              // Error 150/101 means this video cannot be embedded. Never retry the
              // same YouTube ID; refresh independent audio providers instead.
              if (activeEngineRef.current !== 'yt') return;
              const errorCode = Number(event?.data) || 0;
              const cur =
                resolvedPlaybackTrackRef.current?.id === currentTrackRef.current?.id
                  ? resolvedPlaybackTrackRef.current
                  : currentTrackRef.current;
              if (!cur) return;

              // A verified result can still reject embedding (101/150) or be unavailable.
              // Try the next independently matched video before refreshing audio providers.
              const nextYoutubeId = (cur.youtubeAlternates || []).find(
                (candidate) => Boolean(candidate) && candidate !== cur.youtubeId
              );
              if (nextYoutubeId && ytPlayerRef.current) {
                const remainingYoutubeIds = (cur.youtubeAlternates || []).filter(
                  (candidate) => candidate !== nextYoutubeId && candidate !== cur.youtubeId
                );
                const nextTrack = {
                  ...cur,
                  youtubeId: nextYoutubeId,
                  youtubeAlternates: remainingYoutubeIds,
                };
                currentTrackRef.current = nextTrack;
                resolvedPlaybackTrackRef.current = nextTrack;
                setQueue((prev) => prev.map((item) => item.id === cur.id ? nextTrack : item));
                try {
                  ytPlayerRef.current.loadVideoById(nextYoutubeId);
                  ytPlayerRef.current.playVideo();
                  setIsPlaying(true);
                  return;
                } catch {
                  // Continue to independent audio fallback below.
                }
              }

              const playRefreshedAudio = (failedUrls: Set<string>) => {
                resolveTrackStreams(cur, { forceRefresh: true })
                  .then((refreshed) => {
                    if (!refreshed || cur.id !== currentTrackRef.current?.id) return;
                    const refreshedTrack = {
                      ...cur,
                      ...refreshed,
                      alternates: refreshed.alternates || [],
                    } as Track;
                    currentTrackRef.current = refreshedTrack;
                    resolvedPlaybackTrackRef.current = refreshedTrack;
                    setQueue((prev) =>
                      prev.map((item) =>
                        item.id === cur.id
                          ? {
                              ...item,
                              streamUrls: refreshed.streamUrls || item.streamUrls,
                              previewUrl: refreshed.previewUrl || item.previewUrl,
                              alternates: refreshed.alternates || [],
                              youtubeId: refreshed.youtubeId || item.youtubeId,
                              youtubeAlternates: refreshed.youtubeAlternates || item.youtubeAlternates,
                              sourceProvider: refreshed.sourceProvider || item.sourceProvider,
                              sourceAvailability: refreshed.sourceAvailability || item.sourceAvailability,
                              sourcePageUrl: refreshed.sourcePageUrl || item.sourcePageUrl,
                              sourceLicense: refreshed.sourceLicense || item.sourceLicense,
                              offlineAvailable: typeof refreshed.offlineAvailable === 'boolean'
                                ? refreshed.offlineAvailable
                                : item.offlineAvailable,
                            } as Track
                          : item
                      )
                    );
                    const fresh = buildStreamCandidates(
                      refreshedTrack,
                      quality,
                      refreshed.alternates || []
                    ).filter((url) => !failedUrls.has(url));
                    if (!fresh.length) {
                      setIsPlaying(false);
                      showToast(
                        `YouTube error ${errorCode || 'unknown'}; no independent audio source is currently playable.`
                      );
                      return;
                    }
                    activeEngineRef.current = 'audio';
                    candidateFailureRef.current = () => {
                      setIsPlaying(false);
                      showToast('All refreshed audio sources failed. Try again later.');
                    };
                    candidateUrlsRef.current = fresh;
                    loadAndPlayCandidate(0, playbackSeqRef.current, candidateFailureRef.current);
                  })
                  .catch(() => {
                    setIsPlaying(false);
                    showToast('YouTube is unavailable and audio sources could not be refreshed.');
                  });
              };

              const candidates = buildStreamCandidates(cur, quality);
              const failed = new Set(candidates);
              if (candidates.length) {
                activeEngineRef.current = 'audio';
                candidateFailureRef.current = () => playRefreshedAudio(failed);
                candidateUrlsRef.current = candidates;
                loadAndPlayCandidate(0, playbackSeqRef.current, candidateFailureRef.current);
              } else {
                activeEngineRef.current = 'audio';
                playRefreshedAudio(failed);
              }
            },
          },
        });
      } catch {}
    };

    if (window.YT && window.YT.Player) {
      initYt();
    } else {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof prev === 'function') prev();
        initYt();
      };
    }
  }, [loadAndPlayCandidate, quality, volume]);

  // Pre-resolve current + next track FULL stream URLs so Play / Next starts instantaneously
  useEffect(() => {
    const targets = [queue[currentIndex] || currentTrack, queue[currentIndex + 1]].filter(
      (t): t is Track => Boolean(t && !hasFullPlaybackSource(t))
    );
    if (!targets.length) return;
    let cancelled = false;
    targets.forEach((target) => {
      resolveTrackStreams(target).then((resolved) => {
        if (cancelled) return;
        if (
          (resolved.streamUrls && Object.keys(resolved.streamUrls).length > 0) ||
          resolved.previewUrl
        ) {
          setQueue((prev) =>
            prev.map((qItem) =>
              qItem.id === target.id && !hasFullPlaybackSource(qItem)
                ? {
                    ...qItem,
                    streamUrls: resolved.streamUrls || qItem.streamUrls,
                    previewUrl: resolved.previewUrl || qItem.previewUrl,
                    sourceProvider: resolved.sourceProvider || qItem.sourceProvider,
                    sourceAvailability: resolved.sourceAvailability || qItem.sourceAvailability,
                    sourcePageUrl: resolved.sourcePageUrl || qItem.sourcePageUrl,
                    sourceLicense: resolved.sourceLicense || qItem.sourceLicense,
                    offlineAvailable: typeof resolved.offlineAvailable === 'boolean'
                      ? resolved.offlineAvailable
                      : qItem.offlineAvailable,
                    youtubeAlternates: resolved.youtubeAlternates || qItem.youtubeAlternates,
                  }
                : qItem
            )
          );
        }
      });
    });
    return () => {
      cancelled = true;
    };
  }, [currentTrack?.id, currentIndex, quality]);

  useEffect(() => {
    [audioRef.current, audioRef2.current].forEach((audio) => {
      if (audio) {
        audio.volume = volume / 100;
        audio.muted = volume === 0;
      }
    });
    if (ytPlayerRef.current) {
      try {
        ytPlayerRef.current.setVolume?.(volume);
        if (volume === 0) ytPlayerRef.current.mute?.();
        else ytPlayerRef.current.unMute?.();
      } catch {}
    }
    audioEngine.setVolume(volume / 100);
  }, [volume]);

  useEffect(() => {
    audioEngine.applyEqPreset(eqPreset);
  }, [eqPreset]);

  // Sleep Timer countdown
  useEffect(() => {
    if (sleepMinutesLeft === null) return;
    if (sleepMinutesLeft <= 0) {
      setIsPlaying(false);
      audioRef.current?.pause();
      audioRef2.current?.pause();
      try {
        ytPlayerRef.current?.pauseVideo?.();
      } catch {}
      audioEngine.stopSynthLoop();
      setSleepMinutesLeft(null);
      showToast('Sleep timer ended — playback paused.');
      return;
    }
    const timer = window.setTimeout(() => {
      setSleepMinutesLeft((m) => (m !== null ? m - 1 : null));
    }, 60_000);
    return () => window.clearTimeout(timer);
  }, [sleepMinutesLeft, showToast]);

  // Fetch synced lyrics whenever current track changes
  useEffect(() => {
    if (!currentTrack) {
      setLyrics([]);
      setLyricsSynced(false);
      return;
    }
    if (currentTrack.lyrics?.length) {
      setLyrics(currentTrack.lyrics);
      setLyricsSynced(true);
    } else {
      setLyrics([]);
      setLyricsSynced(false);
    }

    let cancelled = false;
    fetchTrackLyrics(currentTrack).then((res) => {
      if (cancelled || !res.lines.length) return;
      if (currentTrack.lyrics?.length && !res.synced) return;
      setLyrics(res.lines);
      setLyricsSynced(res.synced);
    });
    return () => {
      cancelled = true;
    };
  }, [currentTrack?.id]);

  // Dual-Engine Playback: Native <audio> (JioSaavn 320k) + Invisible YouTube Studio Engine (Full Length)
  const startTrackPlayback = useCallback(
    (track: Track) => {
      const audio = audioRef.current;
      const playSeq = ++playbackSeqRef.current;
      // Stop both native slots before starting a new track so an outgoing stream
      // cannot remain audible when the next track resolves or switches engines.
      [audioRef.current, audioRef2.current].forEach((slot) => {
        if (!slot) return;
        slot.pause();
        slot.removeAttribute('src');
        slot.load();
      });
      // Keep the active track ref in sync immediately; React state updates below are async.
      // YouTube can fail before the queue update effect runs, and its fallback needs this
      // track's freshly resolved preview/alternate URLs.
      currentTrackRef.current = track;
      resolvedPlaybackTrackRef.current = track;
      audioEngine.stopSynthLoop();
      usingSynthRef.current = false;

      // Update local affinity + recently played + backend event
      setRecentlyPlayed((prev) => [track, ...prev.filter((t) => t.id !== track.id)].slice(0, 20));
      if (tasteResetActive) {
        setTasteRecentTracks((prev) => [track, ...prev.filter((item) => item.id !== track.id)].slice(0, 20));
      }
      setPlayCounts((prev) => ({ ...prev, [track.id]: (prev[track.id] || 0) + 1 }));
      setPlayedTracks((prev) => ({ ...prev, [track.id]: track }));
      const primaryArtist = track.artist.split(',')[0]?.trim();
      if (primaryArtist) {
        setArtistAffinity((prev) => ({
          ...prev,
          [primaryArtist]: (prev[primaryArtist] || 0) + 1,
        }));
      }
      if (track.language && track.language !== 'Other') {
        const lang = track.language;
        setLanguageAffinity((prev) => ({ ...prev, [lang]: (prev[lang] || 0) + 1 }));
      }
      if (track.genre) {
        const genre = track.genre.split(',')[0].trim();
        if (genre) setGenreAffinity((prev) => ({ ...prev, [genre]: (prev[genre] || 0) + 1 }));
      }
      sendUserEvent({ type: 'play', track }).then((nextState) => {
        if (nextState) {
          setArtistAffinity(nextState.artistAffinity);
          setLanguageAffinity(nextState.languageAffinity);
          setGenreAffinity(nextState.genreAffinity);
          setPlayCounts(nextState.playCounts);
        }
      });

      setCurrentTime(0);
      currentTimeRef.current = 0;
      lastProgressUiUpdateRef.current = 0;
      synthTimeRef.current = 0;
      setDuration(track.duration || 200);
      // Do not label a native track as playing until the active media element
      // emits its actual playing event. YouTube paths set this when started.
      setIsPlaying(false);

      let didForceRefresh = false;
      const playNativeAudioCandidates = (urls: string[]) => {
        if (playSeq !== playbackSeqRef.current || !audio) return;
        activeEngineRef.current = 'audio';
        try {
          ytPlayerRef.current?.pauseVideo?.();
        } catch {}
        candidateUrlsRef.current = urls;
        candidateIdxRef.current = 0;
        if (!urls.length) {
          setIsPlaying(false);
          showToast(`No playable audio source found for "${track.name}" — try another track`);
          return;
        }
        usingSynthRef.current = false;
        const onCandidatesExhausted = () => {
          if (playSeq !== playbackSeqRef.current) return;
          if (didForceRefresh) {
            setIsPlaying(false);
            showToast('No playable audio source found for this track');
            return;
          }
          didForceRefresh = true;
          const failedUrls = new Set(urls);
          resolveTrackStreams(track, { forceRefresh: true }).then((refreshed) => {
            if (playSeq !== playbackSeqRef.current) return;
            const refreshedTrack = {
              ...track,
              ...refreshed,
              alternates: refreshed.alternates || [],
            } as Track;
            currentTrackRef.current = refreshedTrack;
            resolvedPlaybackTrackRef.current = refreshedTrack;
            setQueue((prev) =>
              prev.map((item) =>
                item.id === track.id
                  ? {
                      ...item,
                      streamUrls: refreshed.streamUrls,
                      previewUrl: refreshed.previewUrl,
                      youtubeId: refreshed.youtubeId,
                      sourceProvider: refreshed.sourceProvider || item.sourceProvider,
                      sourceAvailability: refreshed.sourceAvailability || item.sourceAvailability,
                      sourcePageUrl: refreshed.sourcePageUrl || item.sourcePageUrl,
                      sourceLicense: refreshed.sourceLicense || item.sourceLicense,
                      offlineAvailable: typeof refreshed.offlineAvailable === 'boolean'
                        ? refreshed.offlineAvailable
                        : item.offlineAvailable,
                    }
                  : item
              )
            );
            const { full, preview } = partitionStreamCandidates(
              refreshedTrack,
              quality,
              refreshed.alternates || [],
              apiUrl
            );
            const freshFull = full.filter((url) => !failedUrls.has(url));
            const freshPreview = preview.filter((url) => !failedUrls.has(url));
            if (freshFull.length) {
              playNativeAudioCandidates(freshFull);
            } else if (freshPreview.length) {
              showToast(`Playing 30s preview · ${refreshedTrack.sourceProvider || 'Catalogue'}`);
              playNativeAudioCandidates(freshPreview);
            } else {
              setIsPlaying(false);
              showToast('No playable audio source found for this track');
            }
          }).catch(() => {
            if (playSeq === playbackSeqRef.current) {
              setIsPlaying(false);
              showToast('No playable audio source found for this track');
            }
          });
        };
        candidateFailureRef.current = onCandidatesExhausted;
        loadAndPlayCandidate(0, playSeq, onCandidatesExhausted);
      };


      const startOnlinePlayback = () => {
        if (playSeq !== playbackSeqRef.current) return;
        // 1. Direct full-length audio stream (e.g. JioSaavn 320k or Audius verified)
        if (hasFullAudioStream(track)) {
          const fullCandidates = buildStreamCandidates(track, quality);
          if (fullCandidates.length > 0) {
            playNativeAudioCandidates(fullCandidates);
            return;
          }
        }

        // Preserve the user gesture while authorized audio sources resolve.
        if (audio) {
          audio.src = SILENT_WAV_DATA_URI;
          audio.play().catch(() => {});
        }

        resolveTrackStreams(track).then((resolved) => {
          if (playSeq !== playbackSeqRef.current) return;
          const resolvedTrack = {
            ...track,
            ...resolved,
            alternates: resolved.alternates || [],
          } as Track;
          if (
            (resolved.streamUrls && Object.keys(resolved.streamUrls).length > 0) ||
            resolved.previewUrl
          ) {
            // Keep the resolved track in sync before native audio starts.
            currentTrackRef.current = resolvedTrack;
            resolvedPlaybackTrackRef.current = resolvedTrack;
            setQueue((prev) =>
              prev.map((qItem) =>
                qItem.id === track.id
                  ? {
                      ...qItem,
                      streamUrls: resolved.streamUrls || qItem.streamUrls,
                      previewUrl: resolved.previewUrl || qItem.previewUrl,
                      sourceProvider: resolved.sourceProvider || qItem.sourceProvider,
                      sourceAvailability: resolved.sourceAvailability || qItem.sourceAvailability,
                      sourcePageUrl: resolved.sourcePageUrl || qItem.sourcePageUrl,
                      sourceLicense: resolved.sourceLicense || qItem.sourceLicense,
                      offlineAvailable: typeof resolved.offlineAvailable === 'boolean'
                        ? resolved.offlineAvailable
                        : qItem.offlineAvailable,
                    }
                  : qItem
              )
            );
          }

          const { full, preview } = partitionStreamCandidates(
            resolvedTrack,
            quality,
            resolved.alternates || [],
            apiUrl
          );
          if (full.length > 0) {
            playNativeAudioCandidates(full);
          } else if (preview.length > 0) {
            showToast(`Playing 30s preview · ${resolvedTrack.sourceProvider || 'Catalogue'}`);
            playNativeAudioCandidates(preview);
          } else {
            playNativeAudioCandidates([]);
          }
        }).catch(() => {
          if (playSeq !== playbackSeqRef.current) return;
          const fallbackPreview = buildStreamCandidates(track, quality, [], true);
          if (fallbackPreview.length > 0) {
            showToast(`Playing 30s preview · ${track.sourceProvider || 'Catalogue'}`);
            playNativeAudioCandidates(fallbackPreview);
            return;
          }
          setIsPlaying(false);
          showToast('Could not resolve an authorized audio source for this recording. Try another match.');
        });
      };

      if (downloadedIds.has(track.id)) {
        if (audio) {
          audio.src = SILENT_WAV_DATA_URI;
          audio.play().catch(() => {});
        }
        getOfflineAudioUrl(track.id)
          .then((offlineUrl) => {
            if (playSeq !== playbackSeqRef.current) return;
            if (offlineUrl) {
              playNativeAudioCandidates([offlineUrl]);
            } else {
              startOnlinePlayback();
            }
          })
          .catch(() => {
            if (playSeq === playbackSeqRef.current) startOnlinePlayback();
          });
        return;
      }

      startOnlinePlayback();
    },
    [downloadedIds, quality, showToast, loadAndPlayCandidate, volume, tasteResetActive]
  );

  const playTrackList = useCallback(
    (tracks: Track[], startIndex: number, useShuffle = false) => {
      if (!tracks.length) return;
      const safeIndex = Math.max(0, Math.min(tracks.length - 1, startIndex));
      const shouldShuffle = useShuffle || shuffle;
      shuffleHistoryRef.current = [];
      shuffleFutureRef.current = shouldShuffle
        ? createShuffleBag(tracks, tracks[safeIndex]?.id)
        : [];
      setShuffle(shouldShuffle);
      setQueue(tracks);
      setCurrentIndex(safeIndex);
      startTrackPlayback(tracks[safeIndex]);
    },
    [startTrackPlayback, shuffle]
  );

  const handleToggleShuffle = useCallback(() => {
    if (shuffle) {
      shuffleHistoryRef.current = [];
      shuffleFutureRef.current = [];
      setShuffle(false);
      showToast('Shuffle off');
      return;
    }
    shuffleHistoryRef.current = [];
    shuffleFutureRef.current = createShuffleBag(queue, currentTrack?.id);
    setShuffle(true);
    showToast('Shuffle on — no repeats until the queue cycles');
  }, [shuffle, queue, currentTrack?.id, showToast]);

  const advanceTrack = useCallback(
    (direction: 1 | -1, autoAdvance: boolean) => {
      let nextIdx: number | null;
      const currentTrackForFeedback = queue[currentIndex];
      const currentId = currentTrackForFeedback?.id;
      if (direction === 1 && !autoAdvance && currentTrackForFeedback) {
        const totalDuration = duration || currentTrackForFeedback.duration || 0;
        if (totalDuration > 0 && currentTimeRef.current / totalDuration < 0.65) {
          recordListeningFeedback(currentTrackForFeedback.id, 'skip');
        }
      }

      if (shuffle && queue.length > 1) {
        if (autoAdvance && direction === 1 && repeatMode === 2) {
          nextIdx = currentIndex;
        } else if (direction === -1) {
          let previousId: string | undefined;
          while (shuffleHistoryRef.current.length && !previousId) {
            const candidate = shuffleHistoryRef.current.pop()!;
            if (queue.some((item) => item.id === candidate)) previousId = candidate;
          }
          if (previousId) {
            if (currentId) shuffleFutureRef.current.unshift(currentId);
            nextIdx = queue.findIndex((item) => item.id === previousId);
          } else {
            nextIdx = resolveNextTrackIndex({
              queueLength: queue.length, currentIndex, direction,
              shuffle: false, repeatMode, autoAdvance: false,
            });
            // If shuffle was enabled mid-queue, make the manually selected
            // previous track part of history so Next returns to this track.
            if (nextIdx !== null && currentId) shuffleFutureRef.current.unshift(currentId);
          }
        } else {
          let nextId: string | undefined;
          while (shuffleFutureRef.current.length && !nextId) {
            const candidate = shuffleFutureRef.current.shift()!;
            if (candidate !== currentId && queue.some((item) => item.id === candidate)) {
              nextId = candidate;
            }
          }
          if (!nextId && (repeatMode === 1 || !autoAdvance)) {
            shuffleFutureRef.current = createShuffleBag(queue, currentId);
            nextId = shuffleFutureRef.current.shift();
          }
          if (nextId) {
            if (currentId) shuffleHistoryRef.current.push(currentId);
            nextIdx = queue.findIndex((item) => item.id === nextId);
          } else {
            nextIdx = null;
          }
        }
      } else {
        nextIdx = resolveNextTrackIndex({
          queueLength: queue.length,
          currentIndex,
          direction,
          shuffle: false,
          repeatMode,
          autoAdvance,
        });
      }

      if (nextIdx === null || nextIdx < 0) {
        setIsPlaying(false);
        audioRef.current?.pause();
        audioRef2.current?.pause();
        try {
          ytPlayerRef.current?.pauseVideo?.();
        } catch {}
        audioEngine.stopSynthLoop();
        return;
      }
      setCurrentIndex(nextIdx);
      const nextTrack = queue[nextIdx];
      if (nextTrack) startTrackPlayback(nextTrack);
    },
    [queue, currentIndex, shuffle, repeatMode, startTrackPlayback, duration, recordListeningFeedback]
  );
  advanceTrackRef.current = advanceTrack;

  // External streams remain native HTMLAudioElements. Routing cross-origin media
  // through Web Audio can silently mute playback when a provider omits CORS headers.
  // Keep the shared Web Audio graph for generated audio/visualisation only.

  // Listen to both crossfade slots, but only the currently active slot may
  // update playback state or advance the queue.
  useEffect(() => {
    const audios = [audioRef.current, audioRef2.current].filter(
      (audio): audio is HTMLAudioElement => Boolean(audio)
    );
    if (!audios.length) return;

    const isActiveAudio = (audio: HTMLAudioElement) =>
      activeAudioSlotRef.current === (audio === audioRef.current ? 1 : 2);

    const cleanups = audios.map((audio) => {
      const onTime = () => {
        if (activeEngineRef.current !== 'audio' || !isActiveAudio(audio)) return;
        if (audio.src === SILENT_WAV_DATA_URI) return;
        if (Number.isFinite(audio.currentTime)) {
          // Keep an exact playback position for recovery/Media Session, but avoid
          // re-rendering the entire app for every native timeupdate event.
          currentTimeRef.current = audio.currentTime;
          const now = Date.now();
          if (now - lastProgressUiUpdateRef.current >= (expandedPlayerOpen || activeView === 'lyrics' ? 250 : 1000)) {
            lastProgressUiUpdateRef.current = now;
            setCurrentTime(audio.currentTime);
          }
          if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
        }
      };
      const onEnded = () => {
        if (activeEngineRef.current !== 'audio' || !isActiveAudio(audio)) return;
        if (audio.src === SILENT_WAV_DATA_URI) return;
        const endedTrack = currentTrackRef.current;
        if (endedTrack?.id) recordListeningFeedback(endedTrack.id, 'completion');
        advanceTrack(1, true);
      };
      audio.addEventListener('timeupdate', onTime);
      audio.addEventListener('ended', onEnded);
      // Candidate-specific error handling lives in loadAndPlayCandidate.
      // A second global error handler caused the same failure to advance twice.
      return () => {
        audio.removeEventListener('timeupdate', onTime);
        audio.removeEventListener('ended', onEnded);
      };
    });
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [advanceTrack, loadAndPlayCandidate, showToast, expandedPlayerOpen, activeView, recordListeningFeedback]);

  const handleTogglePlay = useCallback(() => {
    if (!currentTrack) return;
    const audio = activeAudioSlotRef.current === 1 ? audioRef.current : audioRef2.current;
    if (isPlaying) {
      setIsPlaying(false);
      if (activeEngineRef.current === 'yt') {
        try {
          ytPlayerRef.current?.pauseVideo?.();
        } catch {}
      } else {
        audio?.pause();
        audioEngine.stopSynthLoop();
      }
      return;
    }

    if (activeEngineRef.current === 'yt') {
      try {
        ytPlayerRef.current?.playVideo?.();
        setIsPlaying(true);
      } catch {
        startTrackPlayback(currentTrack);
      }
    } else {
      if (audio && audio.src && audio.src !== SILENT_WAV_DATA_URI && !audio.error) {
        audio
          .play()
          .then(() => setIsPlaying(true))
          .catch(() => startTrackPlayback(currentTrack));
      } else {
        startTrackPlayback(currentTrack);
      }
    }
  }, [currentTrack, isPlaying, startTrackPlayback]);

  const handleSeek = useCallback(
    (seconds: number) => {
      const clamped = Math.max(0, Math.min(duration || 200, seconds));
      currentTimeRef.current = clamped;
      lastProgressUiUpdateRef.current = 0;
      setCurrentTime(clamped);
      synthTimeRef.current = clamped;
      if (activeEngineRef.current === 'yt') {
        try {
          ytPlayerRef.current?.seekTo?.(clamped, true);
        } catch {}
      } else if (!usingSynthRef.current) {
        const activeAudio =
          activeAudioSlotRef.current === 1 ? audioRef.current : audioRef2.current;
        if (activeAudio && Number.isFinite(activeAudio.duration) && activeAudio.duration > 0) {
          try {
            activeAudio.currentTime = clamped;
          } catch {
            // Some streams are not seekable until their media metadata is ready.
          }
        }
      }
    },
    [duration]
  );

  const currentTimeRef = useRef(currentTime);
  const durationRef = useRef(duration);
  const lastProgressUiUpdateRef = useRef(0);
  useEffect(() => {
    currentTimeRef.current = currentTime;
    durationRef.current = duration;
  }, [currentTime, duration]);

  // Expose playback to Android's lock screen, notification shade, and headset controls.
  // Media Session is optional, so unsupported browsers keep the normal in-app player.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    if (typeof MediaMetadata !== 'undefined' && currentTrack) {
      let artwork: Array<{ src: string; sizes?: string; type?: string }> = [];
      if (currentTrack.image) {
        try {
          artwork = [{ src: new URL(currentTrack.image, window.location.href).href }];
        } catch {
          artwork = [];
        }
      }
      session.metadata = new MediaMetadata({
        title: currentTrack.name,
        artist: currentTrack.artist,
        album: currentTrack.albumName,
        artwork,
      });
    } else {
      session.metadata = null;
    }
  }, [currentTrack?.id, currentTrack?.name, currentTrack?.artist, currentTrack?.albumName, currentTrack?.image]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    const register = (
      action: MediaSessionAction,
      handler: MediaSessionActionHandler | null
    ) => {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // Some browsers expose Media Session but do not support every action.
      }
    };

    register('play', handleTogglePlay);
    register('pause', () => {
      if (isPlayingRef.current) handleTogglePlay();
    });
    register('stop', () => {
      if (isPlayingRef.current) handleTogglePlay();
    });
    register('previoustrack', () => advanceTrack(-1, false));
    register('nexttrack', () => advanceTrack(1, false));
    register('seekbackward', (details) => {
      const offset = details.seekOffset ?? 10;
      handleSeek(Math.max(0, currentTimeRef.current - offset));
    });
    register('seekforward', (details) => {
      const offset = details.seekOffset ?? 10;
      handleSeek(Math.min(durationRef.current || 200, currentTimeRef.current + offset));
    });
    register('seekto', (details) => {
      if (typeof details.seekTime === 'number') handleSeek(details.seekTime);
    });

    return () => {
      register('play', null);
      register('pause', null);
      register('stop', null);
      register('previoustrack', null);
      register('nexttrack', null);
      register('seekbackward', null);
      register('seekforward', null);
      register('seekto', null);
    };
  }, [handleTogglePlay, advanceTrack, handleSeek]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    session.playbackState = currentTrack ? (isPlaying ? 'playing' : 'paused') : 'none';
    if (!currentTrack) {
      try { session.setPositionState(); } catch {}
      return;
    }
    if (duration > 0 && Number.isFinite(duration)) {
      try {
        session.setPositionState({
          duration,
          playbackRate: 1,
          position: Math.max(0, Math.min(duration, currentTime)),
        });
      } catch {
        // Position state is not implemented consistently across mobile browsers.
      }
    }
  }, [isPlaying, currentTime, duration]);

  // Keep native notification handlers registered for the app lifetime.
  // Their ref is refreshed with current React callbacks without unregistering
  // the Android media session on every queue/progress update.
  const nativeMediaActionsRef = useRef({ handleTogglePlay, advanceTrack, handleSeek });
  useEffect(() => {
    nativeMediaActionsRef.current = { handleTogglePlay, advanceTrack, handleSeek };
  }, [handleTogglePlay, advanceTrack, handleSeek]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const register = (
      action: 'play' | 'pause' | 'stop' | 'previoustrack' | 'nexttrack' | 'seekbackward' | 'seekforward' | 'seekto',
      handler: ((details: { seekTime?: number | null }) => void) | null
    ) => {
      void MediaSession.setActionHandler({ action }, handler).catch(() => {
        // Keep in-app playback available if Android declines a media action.
      });
    };
    register('play', () => nativeMediaActionsRef.current.handleTogglePlay());
    register('pause', () => {
      if (isPlayingRef.current) nativeMediaActionsRef.current.handleTogglePlay();
    });
    register('stop', () => {
      if (isPlayingRef.current) nativeMediaActionsRef.current.handleTogglePlay();
    });
    register('previoustrack', () => nativeMediaActionsRef.current.advanceTrack(-1, false));
    register('nexttrack', () => nativeMediaActionsRef.current.advanceTrack(1, false));
    register('seekbackward', () => nativeMediaActionsRef.current.handleSeek(Math.max(0, currentTimeRef.current - 10)));
    register('seekforward', () => nativeMediaActionsRef.current.handleSeek(Math.min(durationRef.current || 200, currentTimeRef.current + 10)));
    register('seekto', (details) => {
      if (typeof details.seekTime === 'number') nativeMediaActionsRef.current.handleSeek(details.seekTime);
    });
    return () => {
      register('play', null);
      register('pause', null);
      register('stop', null);
      register('previoustrack', null);
      register('nexttrack', null);
      register('seekbackward', null);
      register('seekforward', null);
      register('seekto', null);
      void MediaSession.setPlaybackState({ playbackState: 'none' }).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const updateNativeMetadata = async () => {
      try {
        if (!currentTrack) {
          await MediaSession.setMetadata({ title: '', artist: '', album: '', artwork: [] });
          return;
        }
        const artwork = currentTrack.image
          ? [{ src: new URL(currentTrack.image, window.location.href).href }]
          : [];
        await MediaSession.setMetadata({
          title: currentTrack.name,
          artist: currentTrack.artist,
          album: currentTrack.albumName || '',
          artwork,
        });
      } catch {
        // Metadata failures must never interrupt playback.
      }
    };
    void updateNativeMetadata();
  }, [currentTrack?.id, currentTrack?.name, currentTrack?.artist, currentTrack?.albumName, currentTrack?.image]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    void MediaSession.setPlaybackState({
      playbackState: currentTrack ? (isPlaying ? 'playing' : 'paused') : 'none',
    }).catch(() => {
      // Native media UI is optional; in-app playback remains available.
    });
  }, [currentTrack?.id, isPlaying]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !currentTrack || duration <= 0 || !Number.isFinite(duration)) return;
    void MediaSession.setPositionState({
      duration,
      playbackRate: 1,
      position: Math.max(0, Math.min(duration, currentTime)),
    }).catch(() => {
      // Position reporting is optional on older Android versions.
    });
  }, [currentTrack?.id, currentTime, duration]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        handleTogglePlay();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleSeek(currentTime + 10);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleSeek(currentTime - 10);
      } else if (e.key.toLowerCase() === 'm') {
        setVolume((v) => (v === 0 ? 85 : 0));
      } else if (e.key.toLowerCase() === 'l') {
        if (activeView === 'lyrics') handleGoBack();
        else navigateTo('lyrics', null);
      } else if (e.key === 'Escape') {
        setExpandedPlayerOpen(false);
        setCreatePlaylistOpen(false);
        setAddToPlaylistTrack(null);
        setSpotifyImportOpen(false);
        setPersonaliseOpen(false);
        setVideoModalOpen(false);
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleTogglePlay, handleSeek, currentTime, activeView, handleGoBack, navigateTo]);

  // Likes, Playlists, Queue Actions
  const handleToggleLike = useCallback(
    (track: Track) => {
      const { nextMap, added } = toggleTrackInLiked(likedMap, track);
      setLikedMap(nextMap);
      if (tasteResetActive) {
        setTasteLikedMap((previous) => {
          const next = { ...previous };
          if (added) next[track.id] = track;
          else delete next[track.id];
          return next;
        });
      }
      sendUserEvent({ type: added ? 'like' : 'unlike', track }).then((st) => {
        if (st) {
          setArtistAffinity(st.artistAffinity);
          setLanguageAffinity(st.languageAffinity);
        }
      });
      showToast(added ? `Saved "${track.name}" to Liked Songs` : `Removed from Liked Songs`);
    },
    [likedMap, showToast, tasteResetActive]
  );

  const handleEnqueue = useCallback(
    (track: Track) => {
      setQueue((prev) => [...prev, track]);
      if (shuffle && !shuffleFutureRef.current.includes(track.id) && !shuffleHistoryRef.current.includes(track.id)) {
        shuffleFutureRef.current.push(track.id);
      }
      showToast(`Added "${track.name}" to Queue`);
    },
    [showToast, shuffle]
  );

  const handleCreatePlaylist = useCallback(
    (name: string, includeQueue: boolean, initialTrack?: Track) => {
      const tracks = initialTrack
        ? [initialTrack]
        : includeQueue
          ? queue.slice()
          : [];
      const newPl: CuratedPlaylist = {
        id: `user-pl-${Date.now()}`,
        name,
        description: 'Created by you on MusicKK',
        image: tracks[0]?.image || ARTWORK.englishVinyl,
        language: 'Mixed',
        tracks,
        isUserCreated: true,
      };
      setUserPlaylists((prev) => {
        const next = [newPl, ...prev];
        syncBackendPlaylists(next);
        return next;
      });
      showToast(`Created playlist "${name}"`);
    },
    [queue, showToast]
  );

  const handleAddTrackToPlaylist = useCallback(
    (playlistId: string, track: Track) => {
      setUserPlaylists((prev) => {
        const { playlists, added } = addTrackToPlaylist(prev, playlistId, track);
        syncBackendPlaylists(playlists);
        showToast(added ? `Added "${track.name}" to playlist` : `Already in playlist`);
        return playlists;
      });
    },
    [showToast]
  );

  const handleDeletePlaylist = useCallback(
    (playlistId: string) => {
      setUserPlaylists((prev) => {
        const next = prev.filter((p) => p.id !== playlistId);
        syncBackendPlaylists(next);
        return next;
      });
      showToast('Playlist deleted');
    },
    [showToast]
  );

  // Location & Language handlers
  const handleChangeRegion = useCallback(
    (nextRegion: MusicRegion) => {
      setRegion(nextRegion);
      sendUserEvent({ type: 'region', region: nextRegion });
      showToast(`Location set to ${REGION_LABELS[nextRegion]}`);
    },
    [showToast]
  );

  const handleDetectLocation = useCallback(() => {
    if (!navigator.geolocation) {
      showToast('Geolocation not supported in this browser.');
      return;
    }
    setDetectingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const mapped = mapCoordsToRegion(pos.coords.latitude, pos.coords.longitude);
        setDetectingLocation(false);
        handleChangeRegion(mapped);
      },
      () => {
        setDetectingLocation(false);
        showToast('GPS permission declined — pick your region from the list.');
      },
      { timeout: 6000 }
    );
  }, [handleChangeRegion, showToast]);

  const handleTogglePreferredLanguage = useCallback(
    (lang: MusicLanguage) => {
      setPreferredLanguages((prev) => {
        const exists = prev.includes(lang);
        const next = exists
          ? prev.length > 1
            ? prev.filter((l) => l !== lang)
            : prev
          : [...prev, lang];
        sendUserEvent({ type: 'languages', languages: next });
        return next;
      });
    },
    []
  );

  const handleSavePersonalisation = useCallback(
    (settings: PersonalisationSettings) => {
      setDisplayName(settings.displayName);
      setRegion(settings.region);
      setPreferredLanguages(settings.preferredLanguages);
      setFavoriteArtists(settings.favoriteArtists);
      setPreferredMoods(settings.preferredMoods);
      setPrioritizeLyrics(settings.prioritizeLyrics);

      showToast(`Personalised feed updated for ${settings.displayName}`);
    },
    [showToast]
  );

  const handleResetPersonalisation = useCallback(() => {
    setDisplayName('Listener');
    setRegion('IN');
    setPreferredLanguages([]);
    setFavoriteArtists([]);
    setPreferredMoods([]);
    setArtistAffinity({});
    setLanguageAffinity({});
    setGenreAffinity({});
    setPlayCounts({});
    setPrioritizeLyrics(true);
    setTasteResetActive(true);
    setTasteLikedMap({});
    setTasteRecentTracks([]);
    showToast('Local taste profile reset. Your Library was kept intact.');
  }, [showToast]);

  // Collection openers
  const openPlaylistCollection = useCallback(
    (pl: CuratedPlaylist) => {
      navigateTo('collection', {
        kind: 'playlist',
        id: pl.id,
        title: pl.name,
        subtitle: pl.description,
        image: pl.image || pl.tracks[0]?.image || ARTWORK.englishVinyl,
        tracks: pl.tracks,
        sourcePageUrl: pl.sourcePageUrl,
        sourceEntriesReceived: pl.sourceEntriesReceived,
        matchedTrackCount: pl.matchedTrackCount,
        unmatchedTrackCount: pl.unmatchedTrackCount,
        spotifyEmbedUrl: pl.id.startsWith('spotify-pl-')
          ? `https://open.spotify.com/embed/playlist/${pl.id.slice('spotify-pl-'.length)}`
          : undefined,
      });
    },
    [navigateTo]
  );

  const openLikedCollection = useCallback(() => {
    const likedTracks = Object.values(likedMap);
    navigateTo('collection', {
      kind: 'liked',
      id: 'liked-songs',
      title: 'Liked Songs',
      subtitle: 'Your saved vocal tracks and synced favorites',
      image: likedTracks[0]?.image || SEED_PLAYLISTS[4].image,
      tracks: likedTracks,
    });
  }, [likedMap, navigateTo]);

  const openRecentCollection = useCallback(() => {
    navigateTo('collection', {
      kind: 'recent',
      id: 'recently-played',
      title: 'Recently Played',
      subtitle: 'Songs you listened to recently',
      image: recentlyPlayed[0]?.image || SEED_TRACKS[8]?.image || SEED_PLAYLISTS[0].image,
      tracks: recentlyPlayed,
    });
  }, [recentlyPlayed, navigateTo]);

  const openArtistCollection = useCallback(
    (artist: ArtistProfile) => {
      const tracks = artist.topTrackIds
        .map((id) => SEED_TRACKS.find((t) => t.id === id))
        .filter((t): t is Track => Boolean(t));
      navigateTo('collection', {
        kind: 'artist',
        id: artist.id,
        title: artist.name,
        subtitle: `${artist.genre} · ${artist.monthlyListeners}`,
        image: artist.image,
        tracks,
      });
    },
    [navigateTo]
  );

  // Zero-API Spotify link streaming handler
  const handleImportSpotifyUrl = useCallback(
    async (rawUrl: string): Promise<{ ok: boolean; error?: string }> => {
      const res = await resolveSpotifyUrl(rawUrl);
      if (!res.ok || res.kind !== 'playlist' || !res.tracks?.length) {
        return { ok: false, error: res.error || 'This link did not return an importable Spotify playlist.' };
      }
      const importedTracks: Track[] = [];
      for (let offset = 0; offset < res.tracks.length; offset += 4) {
        const batch = res.tracks.slice(offset, offset + 4);
        const matchedBatch = await Promise.all(batch.map(async (spotifyTrack, batchIndex) => {
          try {
            const found = await searchSongs(`${spotifyTrack.name} ${spotifyTrack.artist}`, { region, prioritizeLyrics: false });
            const candidates = found.tracks
              .map((candidate) => ({
                track: candidate,
                score: scoreAuthenticTrackCandidate({
                  itemTitle: candidate.name,
                  itemArtist: candidate.artist,
                  requestedTitle: spotifyTrack.name,
                  requestedArtist: spotifyTrack.artist,
                  itemDurationSec: candidate.duration,
                  targetDurationSec: spotifyTrack.duration,
                }),
              }))
              .filter((item): item is { track: Track; score: number } => item.score !== null)
              .sort((a, b) =>
                (b.score + (hasFullAudioStream(b.track) ? 40 : 0)) -
                (a.score + (hasFullAudioStream(a.track) ? 40 : 0))
              );
            if (candidates[0]) return candidates[0].track;
          } catch {
            // Preserve the Spotify metadata if a provider search fails.
          }
          return {
            ...spotifyTrack,
            id: `spotify-meta-${res.id || 'playlist'}-${offset + batchIndex}-${spotifyTrack.id}`,
            metadataOnly: true,
            sourceProvider: 'Spotify',
            sourceAvailability: 'metadata' as const,
            streamUrls: undefined,
            previewUrl: undefined,
          };
        }));
        importedTracks.push(...matchedBatch);
      }
      const playlistId = `spotify-import-${res.id || Date.now()}`;
      const importedPlaylist: CuratedPlaylist = {
        id: playlistId,
        name: res.title || 'Imported Spotify Playlist',
        description: `Imported from Spotify · ${importedTracks.length} entries received · ${importedTracks.filter((track) => !track.metadataOnly).length} matched · ${importedTracks.filter((track) => track.metadataOnly).length} unmatched`,
        image: res.image || res.tracks[0]?.image || ARTWORK.englishVinyl,
        language: 'Mixed',
        tracks: importedTracks,
        isUserCreated: true,
        sourceEntriesReceived: res.tracks.length,
        matchedTrackCount: importedTracks.filter((track) => !track.metadataOnly).length,
        unmatchedTrackCount: importedTracks.filter((track) => track.metadataOnly).length,
        importedAt: new Date().toISOString(),
        sourcePageUrl: res.id ? `https://open.spotify.com/playlist/${res.id}` : undefined,
      };
      setUserPlaylists((previous) => {
        const alreadyImported = previous.some((playlist) => playlist.id === playlistId);
        const next = alreadyImported
          ? previous.map((playlist) => playlist.id === playlistId ? importedPlaylist : playlist)
          : [importedPlaylist, ...previous];
        syncBackendPlaylists(next);
        showToast(alreadyImported
          ? `Updated “${importedPlaylist.name}” · ${importedTracks.length} source entries`
          : `Added “${importedPlaylist.name}” to your Library`);
        return next;
      });
      const matchedCount = importedTracks.filter((track) => !track.metadataOnly).length;
      const unmatchedCount = importedTracks.length - matchedCount;
      showToast(`Imported “${importedPlaylist.name}” · ${matchedCount} matched · ${unmatchedCount} kept as metadata`);
      return { ok: true };
    },
    [region, showToast]
  );

  // Video search uses request sequencing so slower older searches cannot overwrite newer results.
  const openVideosForQuery = useCallback(
    async (queryText: string) => {
      const query = queryText.trim();
      const requestId = ++videoSearchRequestRef.current;
      setVideoModalOpen(true);
      setVideoSearchQuery(query);
      setVideoSearchLoading(true);
      setVideoSearchError('');
      setVideos([]);
      setSelectedVideoId(null);
      if (!query) {
        setVideoSearchLoading(false);
        setVideoSearchError('Enter a song, artist, or video title to search.');
        return;
      }
      try {
        const found = await searchVideos(query);
        if (requestId !== videoSearchRequestRef.current) return;
        setVideos(found);
        setSelectedVideoId(found[0]?.id || null);
        if (!found.length) setVideoSearchError('No relevant videos found. Try the song title and artist, or a different search phrase.');
      } catch {
        if (requestId === videoSearchRequestRef.current) {
          setVideoSearchError('Video search is temporarily unavailable. Please try again.');
        }
      } finally {
        if (requestId === videoSearchRequestRef.current) setVideoSearchLoading(false);
      }
    },
    []
  );

  const likedTracks = useMemo(() => Object.values(likedMap), [likedMap]);
  const playedTracksForHome = useMemo(() => Object.values(playedTracks), [playedTracks]);
  // Keep the modal's initial settings reference stable across unrelated app renders.
  // Otherwise playback progress updates can reset the modal's in-progress selections.
  const personalisationSettings = useMemo<PersonalisationSettings>(
    () => ({ displayName, region, preferredLanguages, favoriteArtists, preferredMoods, prioritizeLyrics }),
    [displayName, region, preferredLanguages, favoriteArtists, preferredMoods, prioritizeLyrics]
  );
  const openPersonalise = useCallback(() => setPersonaliseOpen(true), []);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-black text-white">
      <audio ref={audioRef} preload="metadata" className="hidden" />
      <audio ref={audioRef2} preload="metadata" className="hidden" />
      <div
        id="harmonia-bg-yt-container"
        aria-hidden="true"
        style={{
          position: 'fixed',
          bottom: -9999,
          right: -9999,
          width: 200,
          height: 200,
          opacity: 0.001,
          pointerEvents: 'none',
        }}
      >
        <div id="harmonia-bg-yt-player" />
      </div>
      {/* Spotify Full-Width Global Top Bar */}
      <Header
        activeView={activeView}
        canGoBack={navIndex > 0}
        canGoForward={navIndex < navHistory.length - 1}
        onGoBack={handleGoBack}
        onGoForward={handleGoForward}
        onGoHome={() => navigateTo('home', null)}
        onOpenSearch={() => navigateTo('search', null)}
        onOpenMobileMenu={() => setMobileMenuOpen(true)}
        searchQuery={searchQuery}
        onQuickSearchChange={(q) => {
          setSearchQuery(q);
          if (q.trim() && activeView !== 'search' && !isSpotifyLinkOrUri(q)) {
            navigateTo('search', null);
          }
        }}
        onSubmitSearch={() => {
          if (isSpotifyLinkOrUri(searchQuery)) {
            handleImportSpotifyUrl(searchQuery);
            return;
          }
          if (activeView !== 'search') navigateTo('search', null);
        }}
        region={region}
        onChangeRegion={handleChangeRegion}
        onDetectLocation={handleDetectLocation}
        detectingLocation={detectingLocation}
        preferredLanguages={preferredLanguages}
        onTogglePreferredLanguage={handleTogglePreferredLanguage}
        eqPreset={eqPreset}
        onChangeEqPreset={(preset) => {
          setEqPreset(preset);
          showToast(`Equalizer: ${preset}`);
        }}
        sleepMinutesLeft={sleepMinutesLeft}
        onSetSleepTimer={(mins) => {
          setSleepMinutesLeft(mins);
          showToast(mins ? `Sleep timer set for ${mins} minutes` : 'Sleep timer off');
        }}
        recentDrops={recommendedTracks}
        onPlayTrack={(t) => playTrackList([t, ...recommendedTracks.filter((x) => x.id !== t.id)], 0)}
        displayName={displayName}
        onOpenProfile={() => setProfileOpen(true)}
      />

      {/* Main 3-Pane Spotify Desktop Shell */}
      <div className="flex min-h-0 flex-1 gap-2 px-2">
        <Sidebar
          activeView={activeView}
          activeCollectionId={activeCollection?.id}
          onSelectView={(v) => navigateTo(v, null)}
          onOpenPlaylist={openPlaylistCollection}
          onOpenLiked={openLikedCollection}
          onOpenArtist={openArtistCollection}
          onOpenCreatePlaylist={() => setCreatePlaylistOpen(true)}
          onOpenSpotifyImport={() => setSpotifyImportOpen(true)}
          onOpenVideos={() =>
            openVideosForQuery(
              currentTrack ? `${currentTrack.name} ${currentTrack.artist} official video` : 'Kesariya Arijit Singh'
            )
          }
          likedTracks={likedTracks}
          userPlaylists={userPlaylists}
          mobileOpen={mobileMenuOpen}
          onCloseMobile={() => setMobileMenuOpen(false)}
        />

        <main className="harmonia-main-panel relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl">
          <div ref={mainScrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 pt-2 sm:px-6">
            {activeView === 'home' && (
              <HomeView
                displayName={displayName}
                personalizedFeedTracks={personalizedFeedTracks}
                region={region}
                languageFilter={languageFilter}
                onLanguageFilterChange={setLanguageFilter}
                recommendedTracks={recommendedTracks}
                recommendationReason={recommendationReason}
                regionalTracks={regionalTracks}
                recentlyPlayed={recentlyPlayed}
                likedCount={likedTracks.length}
                likedTracks={likedTracks}
                playCounts={playCounts}
                playedTracks={playedTracksForHome}
                downloadedIds={downloadedIds}
                downloadingIds={downloadingIds}
                onPlayTrackList={playTrackList}
                onToggleDownload={handleToggleDownload}
                onOpenLiked={openLikedCollection}
                onOpenRecent={openRecentCollection}
                onOpenPersonalise={openPersonalise}
              />
            )}

            {activeView === 'discover' && (
              <DiscoverView
                tracks={discoverTracks}
                globalTracks={globalTracks}
                globalTracksLoading={globalTracksLoading}
                regionalTracks={regionalTracks}
                recentlyPlayed={recommendationRecentTracks}
                downloadedIds={downloadedIds}
                downloadingIds={downloadingIds}
                onPlayTrackList={playTrackList}
                onToggleDownload={handleToggleDownload}
                onRefresh={async () => {
                  const [freshGlobal, freshRegional] = await Promise.all([
                    fetchPlayableDiscoveries('GLOBAL', true),
                    fetchPlayableDiscoveries(region, true),
                  ]);
                  setGlobalTracks(freshGlobal);
                  setGlobalTracksLoaded(true);
                  setRegionalTracks(freshRegional);
                }}
                likedTracks={Object.values(recommendationLikedMap)}
                playCounts={playCounts}
                listeningFeedback={listeningFeedback}
                artistAffinity={artistAffinity}
                genreAffinity={genreAffinity}
                preferredLanguages={preferredLanguages}
                favoriteArtists={favoriteArtists}
                preferredMoods={preferredMoods}
              />
            )}

            {activeView === 'search' && (
              <SearchView
                query={searchQuery}
                onQueryChange={setSearchQuery}
                activeTab={searchTab}
                onTabChange={setSearchTab}
                region={region}
                languageFilter={languageFilter}
                onLanguageFilterChange={setLanguageFilter}
                drillCollection={drillCollection}
                onClearDrill={() => setDrillCollection(null)}
                onOpenDrill={(kind, id) => setDrillCollection({ kind, id })}
                currentTrackId={currentTrack?.id}
                isPlaying={isPlaying}
                likedIds={likedMap}
                downloadedIds={downloadedIds}
                downloadingIds={downloadingIds}
                onToggleDownload={handleToggleDownload}
                onPlayList={playTrackList}
                onEnqueue={handleEnqueue}
                onToggleLike={handleToggleLike}
                onAddToPlaylist={(t) => setAddToPlaylistTrack(t)}
                onOpenVideoQuery={openVideosForQuery}
                onOpenVideoModal={(vids, selectedId) => {
                  setVideos(vids);
                  setSelectedVideoId(selectedId);
                  setVideoModalOpen(true);
                }}
              />
            )}

            {activeView === 'library' && (
              <LibraryView
                likedMap={likedMap}
                playlists={userPlaylists}
                recentlyPlayed={recentlyPlayed}
                currentTrackId={currentTrack?.id}
                isPlaying={isPlaying}
                downloadedIds={downloadedIds}
                downloadingIds={downloadingIds}
                onToggleDownload={handleToggleDownload}
                onPlayList={playTrackList}
                onOpenPlaylist={openPlaylistCollection}
                onEnqueue={handleEnqueue}
                onToggleLike={handleToggleLike}
                onAddToPlaylist={(t) => setAddToPlaylistTrack(t)}
                onOpenCreatePlaylist={() => setCreatePlaylistOpen(true)}
                onDeletePlaylist={handleDeletePlaylist}
                onOpenVideoQuery={openVideosForQuery}
              />
            )}

            {activeView === 'collection' && activeCollection && (
              <CollectionView
                collection={
                  activeCollection.kind === 'liked'
                    ? { ...activeCollection, tracks: likedTracks }
                    : activeCollection
                }
                currentTrackId={currentTrack?.id}
                isPlaying={isPlaying}
                likedMap={likedMap}
                downloadedIds={downloadedIds}
                downloadingIds={downloadingIds}
                onPlayList={playTrackList}
                onToggleLike={handleToggleLike}
                onToggleDownload={handleToggleDownload}
                onDownloadAll={handleDownloadAll}
                onEnqueue={handleEnqueue}
                onAddToPlaylist={(t) => setAddToPlaylistTrack(t)}
                onOpenVideo={(t) => openVideosForQuery(`${t.name} ${t.artist} official video`)}
                suggestionCandidates={suggestionCandidates}
              />
            )}

            {activeView === 'downloads' && <OfflineDownloadsView onPlayList={playTrackList} onToast={showToast} />}

            {activeView === 'lyrics' && (
              <LyricsView
                track={currentTrack}
                lyrics={lyrics}
                lyricsSynced={lyricsSynced}
                currentTime={currentTime}
                duration={duration}
                onSeekTo={handleSeek}
              />
            )}
          </div>
        </main>

        <RightPanel
          mode={rightPanelMode}
          onChangeMode={setRightPanelMode}
          currentTrack={currentTrack}
          queue={queue}
          currentIndex={currentIndex}
          lyrics={lyrics}
          currentTime={currentTime}
          duration={duration}
          downloadedIds={downloadedIds}
          downloadingIds={downloadingIds}
          onToggleDownload={handleToggleDownload}
          onOpenFullLyrics={() => navigateTo('lyrics', null)}
          onPlayIndex={(idx) => {
            if (queue[idx]) {
              setCurrentIndex(idx);
              startTrackPlayback(queue[idx]);
            }
          }}
          onRemoveIndex={(idx) => {
            const result = removeQueueItem(queue, currentIndex, idx);
            if (result.queue === queue) return;
            setQueue(result.queue);
            setCurrentIndex(result.currentIndex);
            if (!result.removedCurrent) return;

            const nextTrack = result.queue[result.currentIndex] || null;
            if (nextTrack) {
              startTrackPlayback(nextTrack);
              return;
            }

            // Invalidate pending resolver/playback callbacks and stop every engine
            // when the final queued track is removed.
            playbackSeqRef.current += 1;
            currentTrackRef.current = null;
            resolvedPlaybackTrackRef.current = null;
            pendingYtVideoIdRef.current = null;
            candidateUrlsRef.current = [];
            candidateIdxRef.current = 0;
            candidateFailureRef.current = () => {};
            activeEngineRef.current = 'audio';
            activeAudioSlotRef.current = 1;
            [audioRef.current, audioRef2.current].forEach((audio) => {
              if (!audio) return;
              audio.pause();
              audio.removeAttribute('src');
              audio.load();
            });
            try {
              ytPlayerRef.current?.pauseVideo?.();
              ytPlayerRef.current?.stopVideo?.();
            } catch {}
            audioEngine.stopSynthLoop();
            usingSynthRef.current = false;
            setIsPlaying(false);
            setCurrentTime(0);
            setDuration(0);
          }}
          onMoveItem={(fromIdx, toIdx) => {
            const res = reorderQueueItem(queue, currentIndex, fromIdx, toIdx);
            setQueue(res.queue);
            setCurrentIndex(res.currentIndex);
          }}
          onClearQueue={() => {
            setQueue(currentTrack ? [currentTrack] : []);
            setCurrentIndex(0);
          }}
        />
      </div>

      {/* Bottom Edge-to-Edge Spotify Playback Bar */}
      <PlayerBar
        currentTrack={currentTrack}
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        shuffle={shuffle}
        repeatMode={repeatMode}
        isLiked={Boolean(currentTrack && likedMap[currentTrack.id])}
        isDownloaded={Boolean(currentTrack && downloadedIds.has(currentTrack.id))}
        isDownloading={Boolean(currentTrack && downloadingIds.has(currentTrack.id))}
        volume={volume}
        quality={quality}
        lyricsOpen={activeView === 'lyrics'}
        rightPanelMode={rightPanelMode}
        onTogglePlay={handleTogglePlay}
        onPrev={() => advanceTrack(-1, false)}
        onNext={() => advanceTrack(1, false)}
        onToggleShuffle={handleToggleShuffle}
        onCycleRepeat={() => setRepeatMode((r) => ((r + 1) % 3) as RepeatMode)}
        onToggleLike={() => currentTrack && handleToggleLike(currentTrack)}
        onShare={() => {
          if (!currentTrack) return;
          const text = `${currentTrack.name} — ${currentTrack.artist} on MusicKK`;
          navigator.clipboard?.writeText(text).catch(() => {});
          showToast('Track info copied to clipboard');
        }}
        onToggleLyrics={() => {
          if (activeView === 'lyrics') handleGoBack();
          else navigateTo('lyrics', null);
        }}
        onToggleRightPanel={(target) => {
          setRightPanelMode((prev) => (prev === target ? 'closed' : target));
        }}
        onOpenExpanded={() => setExpandedPlayerOpen(true)}
        onOpenVideo={() =>
          openVideosForQuery(
            currentTrack ? `${currentTrack.name} ${currentTrack.artist} official video` : 'Kesariya Arijit Singh'
          )
        }
        onSeek={handleSeek}
        onVolumeChange={setVolume}
        onCycleQuality={() => {
          const nextQ = cycleQuality(quality);
          setQuality(nextQ);
          showToast(`Audio quality: ${nextQ}`);
        }}
        onDownload={() => currentTrack && void handleToggleDownload(currentTrack)}
      />

      {/* Expandable Full-Screen Spotify Now Playing Overlay */}
      <ExpandedPlayer
        open={expandedPlayerOpen}
        track={currentTrack}
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        shuffle={shuffle}
        repeatMode={repeatMode}
        isLiked={Boolean(currentTrack && likedMap[currentTrack.id])}
        isDownloaded={Boolean(currentTrack && downloadedIds.has(currentTrack.id))}
        isDownloading={Boolean(currentTrack && downloadingIds.has(currentTrack.id))}
        quality={quality}
        lyrics={lyrics}
        lyricsSynced={lyricsSynced}
        onClose={() => setExpandedPlayerOpen(false)}
        onTogglePlay={handleTogglePlay}
        onPrev={() => advanceTrack(-1, false)}
        onNext={() => advanceTrack(1, false)}
        onToggleShuffle={() => setShuffle((s) => !s)}
        onCycleRepeat={() => setRepeatMode((r) => ((r + 1) % 3) as RepeatMode)}
        onToggleLike={() => currentTrack && handleToggleLike(currentTrack)}
        onToggleDownload={() => currentTrack && handleToggleDownload(currentTrack)}
        onSeek={handleSeek}
        onOpenQueue={() => {
          setRightPanelMode('queue');
        }}
        onOpenVideo={() =>
          openVideosForQuery(
            currentTrack ? `${currentTrack.name} ${currentTrack.artist} official video` : 'Kesariya Arijit Singh'
          )
        }
        onShare={() => {
          if (!currentTrack) return;
          const text = `${currentTrack.name} — ${currentTrack.artist} on MusicKK`;
          navigator.clipboard?.writeText(text).catch(() => {});
          showToast('Track info copied to clipboard');
        }}
        onCycleQuality={() => {
          const nextQ = cycleQuality(quality);
          setQuality(nextQ);
          showToast(`Audio quality: ${nextQ}`);
        }}
        suggestionCandidates={suggestionCandidates}
        onPlaySuggested={(track) => {
          playTrackList([track], 0);
          setExpandedPlayerOpen(true);
        }}
        onEnqueueSuggested={handleEnqueue}
        onAddSuggestedToPlaylist={(track) => setAddToPlaylistTrack(track)}
      />

      {/* Mobile Bottom Navigation Bar */}
      <nav
        aria-label="Mobile navigation"
        className="grid grid-cols-4 border-t border-white/[0.08] bg-black py-1.5 lg:hidden"
      >
        <button
          type="button"
          onClick={() => navigateTo('home', null)}
          className={`flex flex-col items-center gap-0.5 py-1 text-[11px] font-semibold ${
            activeView === 'home' ? 'text-white' : 'text-zinc-400'
          }`}
        >
          <Home className="h-5 w-5" />
          <span>Home</span>
        </button>
        <button type="button" onClick={() => navigateTo('discover', null)} className={`flex flex-col items-center gap-0.5 py-1 text-[11px] font-semibold ${activeView === 'discover' ? 'text-white' : 'text-zinc-400'}`}>
          <Compass className="h-5 w-5" /><span>Discover</span>
        </button>
        <button
          type="button"
          onClick={() => navigateTo('search', null)}
          className={`flex flex-col items-center gap-0.5 py-1 text-[11px] font-semibold ${
            activeView === 'search' ? 'text-white' : 'text-zinc-400'
          }`}
        >
          <Search className="h-5 w-5" />
          <span>Search</span>
        </button>
        <button
          type="button"
          onClick={() => navigateTo('library', null)}
          className={`flex flex-col items-center gap-0.5 py-1 text-[11px] font-semibold ${
            activeView === 'library' ? 'text-white' : 'text-zinc-400'
          }`}
        >
          <Library className="h-5 w-5" />
          <span>Your Library</span>
        </button>
      </nav>

      {/* Modals */}
      <CreatePlaylistModal
        open={createPlaylistOpen}
        defaultName={`My Mix #${userPlaylists.length + 1}`}
        queueCount={queue.length}
        onClose={() => setCreatePlaylistOpen(false)}
        onCreate={(name, includeQueue) => handleCreatePlaylist(name, includeQueue)}
      />

      <AddToPlaylistModal
        track={addToPlaylistTrack}
        playlists={userPlaylists}
        onClose={() => setAddToPlaylistTrack(null)}
        onAdd={handleAddTrackToPlaylist}
        onCreateAndAdd={(name, track) => handleCreatePlaylist(name, false, track)}
      />

      <SpotifyImportModal
        open={spotifyImportOpen}
        onClose={() => setSpotifyImportOpen(false)}
        onImportSpotifyUrl={handleImportSpotifyUrl}
      />

      <VideoModal
        open={videoModalOpen}
        videos={videos}
        selectedId={selectedVideoId}
        query={videoSearchQuery}
        loading={videoSearchLoading}
        error={videoSearchError}
        onSearch={openVideosForQuery}
        onSelectVideo={setSelectedVideoId}
        onClose={() => setVideoModalOpen(false)}
      />

      <ProfileModal
        open={profileOpen}
        displayName={displayName}
        region={region}
        preferredLanguages={preferredLanguages}
        favoriteArtists={favoriteArtists}
        preferredMoods={preferredMoods}
        totalPlays={Object.values(playCounts).reduce((sum, count) => sum + count, 0)}
        uniqueTracks={Object.keys(playCounts).length}
        likedCount={likedTracks.length}
        onClose={() => setProfileOpen(false)}
        onEditPreferences={() => {
          setProfileOpen(false);
          setPersonaliseOpen(true);
        }}
      />

      <PersonaliseModal
        open={personaliseOpen}
        initialSettings={personalisationSettings}
        detectingLocation={detectingLocation}
        onDetectLocation={handleDetectLocation}
        onClose={() => setPersonaliseOpen(false)}
        onSave={handleSavePersonalisation}
        onReset={handleResetPersonalisation}
      />

      {welcomeVisible && (
        <WelcomeExperience
          hasCompletedSetup={welcomeSetupComplete}
          initialMoods={preferredMoods}
          onComplete={(moods) => {
            setPreferredMoods(moods);
            try {
              localStorage.setItem('musick_mood_setup_complete_v1', 'true');
            } catch {
              // Continue into the app even when local storage is unavailable.
            }
            setWelcomeVisible(false);
          }}
        />
      )}

      {/* Subtle Toast */}
      {toastMsg && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed bottom-32 left-1/2 z-50 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-full bg-[#1DB954] px-4 py-1.5 text-center text-xs font-extrabold text-black shadow-2xl lg:bottom-24"
        >
          {toastMsg}
        </div>
      )}
    </div>
  );
}
