import { Home, Library, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CollectionView } from './components/CollectionView';
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
import { Sidebar } from './components/Sidebar';
import { ARTWORK, SEED_ARTISTS, SEED_PLAYLISTS, SEED_TRACKS, SEED_VIDEOS } from './data/catalog';
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
  fetchRegionalDiscovery,
  fetchSpotifyPlaylists,
  fetchTrackLyrics,
  resolveSpotifyUrl,
  resolveTrackStreams,
  searchSongs,
  searchVideos,
  sendPersonalisation,
  sendUserEvent,
  syncBackendPlaylists,
} from './utils/musicApi';
import {
  addTrackToPlaylist,
  cycleQuality,
  deriveDynamicTasteHighlights,
  hasFullAudioStream,
  hasFullPlaybackSource,
  isShortPreviewUrl,
  isSpotifyLinkOrUri,
  isUnnecessaryNoLyricsTrack,
  mapCoordsToRegion,
  REGION_LABELS,
  reorderQueueItem,
  resolveNextTrackIndex,
  scoreTrackForUser,
  selectStreamUrl,
  toggleTrackInLiked,
} from './utils/playerEngine';
import { audioEngine } from './utils/webAudioSynth';

const SILENT_WAV_DATA_URI =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

function buildStreamCandidates(
  track: Track,
  quality: AudioQuality,
  extraAlternates: string[] = []
): string[] {
  const fullRaw: string[] = [];

  // Never silently treat a 30-second catalogue preview as a full track.
  const pushClassified = (u?: string) => {
    if (!u || isShortPreviewUrl(u)) return;
    fullRaw.push(u);
  };

  pushClassified(selectStreamUrl(track, quality));
  if (track.streamUrls) {
    for (const q of ['320kbps', '160kbps', '96kbps', '48kbps', '12kbps'] as const) {
      pushClassified(track.streamUrls[q]);
    }
  }
  for (const alt of extraAlternates) {
    pushClassified(alt);
  }
  pushClassified(track.previewUrl);
  // The resolver returns alternates alongside previewUrl/streamUrls. Keep these
  // attached to the Track object usable by the iframe error handler too.
  const trackAlternates = (track as Track & { alternates?: string[] }).alternates || [];
  for (const alt of trackAlternates) {
    pushClassified(alt);
  }

  const out: string[] = [];
  const seen = new Set<string>();
  const pushUnique = (u: string) => {
    if (!seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  };

  for (const raw of fullRaw) {
    if (raw.startsWith('/') || raw.startsWith('data:') || raw.startsWith('blob:')) {
      pushUnique(raw);
    } else if (/^https?:\/\//i.test(raw)) {
      pushUnique(`/api/music/audio?url=${encodeURIComponent(raw)}`);
      if (raw.startsWith('https://')) pushUnique(raw);
    }
  }
  return out;
}

interface NavEntry {
  view: ViewName;
  collection: CollectionTarget | null;
}

const STORAGE_KEY = 'harmonia_spotify_state_v2';

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
  playedTracks?: Record<string, Track>;
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
  const [playedTracks, setPlayedTracks] = useState<Record<string, Track>>(
    initialSnap.playedTracks || {}
  );

  // Audio playback state
  const [queue, setQueue] = useState<Track[]>(SEED_PLAYLISTS[0].tracks);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(SEED_PLAYLISTS[0].tracks[0]?.duration || 268);
  const [shuffle, setShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(0);
  const [volume, setVolume] = useState<number>(
    typeof initialSnap.volume === 'number' ? initialSnap.volume : 85
  );
  const [quality, setQuality] = useState<AudioQuality>(initialSnap.quality || '320kbps');
  const [eqPreset, setEqPreset] = useState<EqPreset>(initialSnap.eqPreset || 'flat');
  const [sleepMinutesLeft, setSleepMinutesLeft] = useState<number | null>(null);

  // Synced Lyrics state
  const [lyrics, setLyrics] = useState<LyricLine[]>(SEED_PLAYLISTS[0].tracks[0]?.lyrics || []);
  const [lyricsSynced, setLyricsSynced] = useState(true);

  // Spotify Free curated playlists + user modals & toast
  const [spotifyPlaylists, setSpotifyPlaylists] = useState<CuratedPlaylist[]>([]);
  const [expandedPlayerOpen, setExpandedPlayerOpen] = useState(false);
  const [createPlaylistOpen, setCreatePlaylistOpen] = useState(false);
  const [addToPlaylistTrack, setAddToPlaylistTrack] = useState<Track | null>(null);
  const [spotifyImportOpen, setSpotifyImportOpen] = useState(false);
  const [personaliseOpen, setPersonaliseOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [videos, setVideos] = useState<VideoResult[]>(SEED_VIDEOS);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(SEED_VIDEOS[0]?.id || null);
  const [toastMsg, setToastMsg] = useState<string>('');

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
  const currentTrack = queue[currentIndex] || queue[0] || SEED_TRACKS[0] || null;
  const currentTrackRef = useRef<Track | null>(currentTrack);
  // Retain the latest resolved object separately: queue state/effects can briefly
  // expose the pre-resolution track while the YouTube iframe reports an error.
  const resolvedPlaybackTrackRef = useRef<Track | null>(null);
  const activeEngineRef = useRef<'audio' | 'yt'>('audio');
  const ytPlayerRef = useRef<any>(null);
  const isYtReadyRef = useRef<boolean>(false);
  const pendingYtVideoIdRef = useRef<string | null>(null);
  const advanceTrackRef = useRef<(direction: 1 | -1, autoAdvance: boolean) => void>(() => {});

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

  // High-precision time sync for background YouTube studio player
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
          setCurrentTime(cur);
        }
        if (typeof dur === 'number' && Number.isFinite(dur) && dur > 30) {
          setDuration(dur);
        }
      } catch {
        // Non-fatal
      }
    }, 250);
    return () => window.clearInterval(interval);
  }, [isPlaying]);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
  }, []);

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
          likedMap,
          playlists: userPlaylists,
          recentlyPlayed: recentlyPlayed.slice(0, 20),
          artistAffinity,
          languageAffinity,
          genreAffinity,
          playCounts,
          playedTracks,
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
    playedTracks,
    volume,
    quality,
    eqPreset,
  ]);

  // Fetch live Spotify Free editorial playlists on mount (zero API keys, zero ads)
  useEffect(() => {
    let active = true;
    fetchSpotifyPlaylists().then((pls) => {
      if (active && pls.length) setSpotifyPlaylists(pls);
    });
    return () => {
      active = false;
    };
  }, []);

  // Fetch location-based tracks whenever region updates
  useEffect(() => {
    let cancelled = false;
    fetchRegionalDiscovery(region).then((tracks) => {
      if (cancelled) return;
      const vocalOnly = prioritizeLyrics
        ? tracks.filter((t) => !isUnnecessaryNoLyricsTrack(t))
        : tracks;
      setRegionalTracks(vocalOnly);
    });
    return () => {
      cancelled = true;
    };
  }, [region, prioritizeLyrics]);

  // Build discovery queries only from explicit picks and the listener's own activity.
  useEffect(() => {
    let cancelled = false;
    const historyTracks = [...Object.values(likedMap), ...recentlyPlayed];
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
      .slice(0, 1)
      .map(([genre]) => genre);
    const queries = [...uniqueArtists, ...topGenres].slice(0, 3);
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
  }, [favoriteArtists, artistAffinity, genreAffinity, likedMap, recentlyPlayed, region, prioritizeLyrics]);

  // Dynamic User-Based Recommendation Ranking
  const { recommendedTracks, recommendationReason, tasteHighlights } = useMemo(() => {
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
      likedMap,
      recentlyPlayed,
    });

    const combined: Track[] = [];
    const seenKeys = new Set<string>();
    for (const track of [
      ...personalizedFeedTracks,
      ...Object.values(likedMap),
      ...recentlyPlayed,
      ...regionalTracks,
    ]) {
      if (prioritizeLyrics && isUnnecessaryNoLyricsTrack(track)) continue;
      const key = `${track.name.toLowerCase()}::${track.artist.split(',')[0]?.trim().toLowerCase()}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        combined.push(track);
      }
    }

    const ranked = combined
      .map((track) => ({ track, score: scoreTrackForUser(track, tasteProfile) }))
      .sort((a, b) => b.score - a.score)
      .map((item) => item.track);

    const highlights = deriveDynamicTasteHighlights(tasteProfile);

    return {
      recommendedTracks: ranked,
      recommendationReason: highlights.reason,
      tasteHighlights: highlights,
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
    likedMap,
    recentlyPlayed,
    regionalTracks,
    personalizedFeedTracks,
  ]);

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
    (idx: number, playSeq: number, onAllFailed: () => void) => {
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
      incoming.volume = 0;
      incoming.muted = volume === 0;

      // Some hosts leave a media request stalled without firing an error.
      // Advance only if this candidate is still active and playback never began.
      const candidateSlot: 1 | 2 = incoming === a1 ? 1 : 2;
      let candidateFailed = false;
      let hasStartedPlaying = false;
      let startupTimer = 0;
      const clearCandidateWatch = () => {
        if (startupTimer) window.clearTimeout(startupTimer);
        incoming.removeEventListener('playing', onCandidatePlaying);
        incoming.removeEventListener('error', onCandidateError);
      };
      const onCandidatePlaying = () => {
        hasStartedPlaying = true;
        if (startupTimer) window.clearTimeout(startupTimer);
        startupTimer = 0;
        setIsPlaying(true);
        // Keep the error listener attached after startup so a later decode/network
        // failure can still advance to the next candidate.
        incoming.removeEventListener('playing', onCandidatePlaying);
      };
      const onCandidateError = () => {
        if (candidateFailed) return;
        candidateFailed = true;
        clearCandidateWatch();
        if (playSeq !== playbackSeqRef.current) return;
        incoming.pause();
        incoming.removeAttribute('src');
        incoming.load();
        loadAndPlayCandidate(idx + 1, playSeq, onAllFailed);
      };
      incoming.addEventListener('playing', onCandidatePlaying, { once: true });
      incoming.addEventListener('error', onCandidateError, { once: true });
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
          resolved.previewUrl ||
          resolved.youtubeId
        ) {
          setQueue((prev) =>
            prev.map((qItem) =>
              qItem.id === target.id && !hasFullPlaybackSource(qItem)
                ? {
                    ...qItem,
                    streamUrls: resolved.streamUrls || qItem.streamUrls,
                    previewUrl: resolved.previewUrl || qItem.previewUrl,
                    youtubeId: resolved.youtubeId || qItem.youtubeId,
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
    if (!currentTrack) return;
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
          showToast(`No stream found for "${track.name}" — try another track`);
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
                    }
                  : item
              )
            );
            const freshCandidates = buildStreamCandidates(
              refreshed,
              quality,
              refreshed.alternates || []
            ).filter((url) => !failedUrls.has(url));
            if (freshCandidates.length) {
              playNativeAudioCandidates(freshCandidates);
            } else if (refreshed.youtubeId) {
              playYouTubeAudio(refreshed.youtubeId);
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

      const playYouTubeAudio = (youtubeId: string) => {
        if (playSeq !== playbackSeqRef.current) return;
        activeEngineRef.current = 'yt';
        try {
          audio?.pause();
        } catch {}
        if (ytPlayerRef.current && isYtReadyRef.current) {
          try {
            ytPlayerRef.current.loadVideoById(youtubeId);
            ytPlayerRef.current.setVolume(volume);
            if (volume === 0) ytPlayerRef.current.mute();
            else ytPlayerRef.current.unMute();
            ytPlayerRef.current.playVideo();
            setIsPlaying(true);
          } catch {}
        } else {
          pendingYtVideoIdRef.current = youtubeId;
          setIsPlaying(true);
        }
      };

      // 1. Direct full-length audio stream (e.g. JioSaavn 320k or Audius verified)
      if (hasFullAudioStream(track)) {
        const fullCandidates = buildStreamCandidates(track, quality);
        if (fullCandidates.length > 0) {
          playNativeAudioCandidates(fullCandidates);
          return;
        }
      }

      // 2. Full-length studio track via official YouTube audio ID
      if (track.youtubeId) {
        playYouTubeAudio(track.youtubeId);
        return;
      }

      // 3. User gesture preservation while resolving
      if (audio) {
        audio.src = SILENT_WAV_DATA_URI;
        audio.play().catch(() => {});
      }

      resolveTrackStreams(track).then((resolved) => {
        if (playSeq !== playbackSeqRef.current) return;
        if (
          (resolved.streamUrls && Object.keys(resolved.streamUrls).length > 0) ||
          resolved.previewUrl ||
          resolved.youtubeId
        ) {
          // Update synchronously before starting YouTube: its iframe may emit onError
          // before the queue state update commits and the ref-sync effect runs.
          const resolvedTrack = {
            ...track,
            ...resolved,
            alternates: resolved.alternates || [],
          } as Track;
          currentTrackRef.current = resolvedTrack;
          resolvedPlaybackTrackRef.current = resolvedTrack;
          setQueue((prev) =>
            prev.map((qItem) =>
              qItem.id === track.id
                ? {
                    ...qItem,
                    streamUrls: resolved.streamUrls || qItem.streamUrls,
                    previewUrl: resolved.previewUrl || qItem.previewUrl,
                    youtubeId: resolved.youtubeId || qItem.youtubeId,
                  }
                : qItem
            )
          );
        }

        if (hasFullAudioStream(resolved)) {
          const resolvedCandidates = buildStreamCandidates(
            resolved,
            quality,
            resolved.alternates || []
          );
          playNativeAudioCandidates(resolvedCandidates);
        } else if (resolved.youtubeId) {
          playYouTubeAudio(resolved.youtubeId);
        } else {
          const resolvedCandidates = buildStreamCandidates(
            resolved,
            quality,
            resolved.alternates || []
          );
          playNativeAudioCandidates(resolvedCandidates);
        }
      });
    },
    [quality, showToast, loadAndPlayCandidate, volume]
  );

  const playTrackList = useCallback(
    (tracks: Track[], startIndex: number, useShuffle = false) => {
      if (!tracks.length) return;
      const safeIndex = Math.max(0, Math.min(tracks.length - 1, startIndex));
      if (useShuffle) setShuffle(true);
      setQueue(tracks);
      setCurrentIndex(safeIndex);
      startTrackPlayback(tracks[safeIndex]);
    },
    [startTrackPlayback]
  );

  const advanceTrack = useCallback(
    (direction: 1 | -1, autoAdvance: boolean) => {
      const nextIdx = resolveNextTrackIndex({
        queueLength: queue.length,
        currentIndex,
        direction,
        shuffle,
        repeatMode,
        autoAdvance,
      });
      if (nextIdx === null) {
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
    [queue, currentIndex, shuffle, repeatMode, startTrackPlayback]
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
          setCurrentTime(audio.currentTime);
          if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
        }
      };
      const onEnded = () => {
        if (activeEngineRef.current !== 'audio' || !isActiveAudio(audio)) return;
        if (audio.src === SILENT_WAV_DATA_URI) return;
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
  }, [advanceTrack, loadAndPlayCandidate, showToast]);

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
      sendUserEvent({ type: added ? 'like' : 'unlike', track }).then((st) => {
        if (st) {
          setArtistAffinity(st.artistAffinity);
          setLanguageAffinity(st.languageAffinity);
        }
      });
      showToast(added ? `Saved "${track.name}" to Liked Songs` : `Removed from Liked Songs`);
    },
    [likedMap, showToast]
  );

  const handleEnqueue = useCallback(
    (track: Track) => {
      setQueue((prev) => [...prev, track]);
      showToast(`Added "${track.name}" to Queue`);
    },
    [showToast]
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
        description: 'Created by you on Harmonia',
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

      sendPersonalisation(settings).then((state) => {
        if (state) {
          if (state.artistAffinity) setArtistAffinity(state.artistAffinity);
          if (state.languageAffinity) setLanguageAffinity(state.languageAffinity);
          if (state.genreAffinity) setGenreAffinity(state.genreAffinity);
        }
      });
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

    sendPersonalisation({ resetTaste: true }).then((state) => {
      if (state) {
        setArtistAffinity(state.artistAffinity);
        setLanguageAffinity(state.languageAffinity);
        setGenreAffinity(state.genreAffinity);
        setPlayCounts(state.playCounts);
      }
    });
    showToast('Your taste profile has been reset');
  }, [showToast]);

  // Collection openers
  const openPlaylistCollection = useCallback(
    (pl: CuratedPlaylist) => {
      navigateTo('collection', {
        kind: 'playlist',
        id: pl.id,
        title: pl.name,
        subtitle: pl.description,
        image: pl.tracks[0]?.image || pl.image || ARTWORK.englishVinyl,
        tracks: pl.tracks,
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
      if (res.ok && res.tracks?.length) {
        navigateTo('collection', {
          kind: 'playlist',
          id: `sp-import-${res.id || Date.now()}`,
          title: res.title || 'Spotify Stream',
          subtitle: res.subtitle || 'Ad-Free Spotify Streaming',
          image: res.image || res.tracks[0].image || ARTWORK.englishVinyl,
          tracks: res.tracks,
          spotifyEmbedUrl: res.kind && res.id
            ? `https://open.spotify.com/embed/${res.kind}/${res.id}`
            : undefined,
        });
        showToast('Spotify player loaded. Use its Play button below to start playback.');
        return { ok: true };
      }
      return { ok: false, error: res.error || 'Could not resolve Spotify link' };
    },
    [navigateTo, showToast]
  );

  // Videos
  const openVideosForQuery = useCallback(
    async (queryText: string) => {
      setVideoModalOpen(true);
      const found = await searchVideos(queryText);
      if (found.length) {
        setVideos(found);
        setSelectedVideoId(found[0].id);
      }
    },
    []
  );

  const likedTracks = useMemo(() => Object.values(likedMap), [likedMap]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-black text-white">
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

        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-[#121212]">
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
                spotifyPlaylists={spotifyPlaylists}
                recentlyPlayed={recentlyPlayed}
                likedCount={likedTracks.length}
                likedTracks={likedTracks}
                playCounts={playCounts}
                playedTracks={Object.values(playedTracks)}
                tasteHighlights={tasteHighlights}
                onPlayTrackList={playTrackList}
                onOpenPlaylist={openPlaylistCollection}
                onOpenLiked={openLikedCollection}
                onOpenRecent={openRecentCollection}
                onOpenPersonalise={() => setPersonaliseOpen(true)}
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
                onPlayList={playTrackList}
                onToggleLike={handleToggleLike}
                onEnqueue={handleEnqueue}
                onAddToPlaylist={(t) => setAddToPlaylistTrack(t)}
                onOpenVideo={(t) => openVideosForQuery(`${t.name} ${t.artist} official video`)}
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
          onOpenFullLyrics={() => navigateTo('lyrics', null)}
          onPlayIndex={(idx) => {
            if (queue[idx]) {
              setCurrentIndex(idx);
              startTrackPlayback(queue[idx]);
            }
          }}
          onRemoveIndex={(idx) => {
            setQueue((prev) => {
              const next = prev.filter((_, i) => i !== idx);
              if (idx < currentIndex) setCurrentIndex((c) => Math.max(0, c - 1));
              else if (idx === currentIndex && next.length) {
                const nextIdx = Math.min(idx, next.length - 1);
                setCurrentIndex(nextIdx);
                startTrackPlayback(next[nextIdx]);
              }
              return next;
            });
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
        volume={volume}
        quality={quality}
        lyricsOpen={activeView === 'lyrics'}
        rightPanelMode={rightPanelMode}
        onTogglePlay={handleTogglePlay}
        onPrev={() => advanceTrack(-1, false)}
        onNext={() => advanceTrack(1, false)}
        onToggleShuffle={() => setShuffle((s) => !s)}
        onCycleRepeat={() => setRepeatMode((r) => ((r + 1) % 3) as RepeatMode)}
        onToggleLike={() => currentTrack && handleToggleLike(currentTrack)}
        onShare={() => {
          if (!currentTrack) return;
          const text = `${currentTrack.name} — ${currentTrack.artist} on Harmonia`;
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
        onDownload={() => {
          navigateTo('downloads', null);
          showToast('Import audio files in Offline Downloads to listen without internet.');
        }}
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
          const text = `${currentTrack.name} — ${currentTrack.artist} on Harmonia`;
          navigator.clipboard?.writeText(text).catch(() => {});
          showToast('Track info copied to clipboard');
        }}
        onCycleQuality={() => {
          const nextQ = cycleQuality(quality);
          setQuality(nextQ);
          showToast(`Audio quality: ${nextQ}`);
        }}
      />

      {/* Mobile Bottom Navigation Bar */}
      <nav
        aria-label="Mobile navigation"
        className="grid grid-cols-3 border-t border-white/[0.08] bg-black py-1.5 lg:hidden"
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
        onSearchQuery={(q) => {
          setSearchQuery(q);
          setSearchTab('songs');
          navigateTo('search', null);
        }}
        onSwitchToVideos={(q) => openVideosForQuery(q)}
        onImportSpotifyUrl={handleImportSpotifyUrl}
      />

      <VideoModal
        open={videoModalOpen}
        videos={videos}
        selectedId={selectedVideoId}
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
        initialSettings={{
          displayName,
          region,
          preferredLanguages,
          favoriteArtists,
          preferredMoods,
          prioritizeLyrics,
        }}
        detectingLocation={detectingLocation}
        onDetectLocation={handleDetectLocation}
        onClose={() => setPersonaliseOpen(false)}
        onSave={handleSavePersonalisation}
        onReset={handleResetPersonalisation}
      />

      {/* Subtle Toast */}
      {toastMsg && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-[#1DB954] px-4 py-1.5 text-xs font-extrabold text-black shadow-2xl"
        >
          {toastMsg}
        </div>
      )}
    </div>
  );
}
