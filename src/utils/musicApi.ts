import {
  ARTWORK,
  SEED_ALBUMS,
  SEED_ARTISTS,
  SEED_PLAYLISTS,
  SEED_TRACKS,
  SEED_VIDEOS,
} from '../data/catalog';
import type {
  ArtistProfile,
  CuratedPlaylist,
  LyricLine,
  MusicLanguage,
  MusicRegion,
  Track,
  UserTasteProfile,
  VideoResult,
} from '../types/music';
import {
  decodeHtmlEntities,
  filterAndRankTracks,
  hasFullAudioStream,
  isRemixOrKnockoff,
  isUnnecessaryNoLyricsTrack,
  parsePlainLyricsToLines,
  toProxiedImageUrl,
} from './playerEngine';

interface SaavnImage {
  quality?: string;
  url?: string;
}

interface SaavnDownload {
  quality?: string;
  url?: string;
}

interface SaavnSongRaw {
  id: string;
  name?: string;
  duration?: number | string;
  year?: string;
  playCount?: number | string;
  language?: string;
  album?: { name?: string };
  artists?: {
    primary?: Array<{ name?: string }>;
    featured?: Array<{ name?: string }>;
    all?: Array<{ name?: string }>;
  };
  image?: SaavnImage[];
  downloadUrl?: SaavnDownload[];
}

function pickSaavnImage(images?: SaavnImage[], fallback = ARTWORK.englishVinyl): string {
  if (!images?.length) return fallback;
  const preferred = images.find(
    (img) =>
      img.quality === '500x500' &&
      img.url &&
      !img.url.includes('artist-default') &&
      !img.url.includes('/_i/3.0/')
  );
  if (preferred?.url) return toProxiedImageUrl(preferred.url);
  for (let i = images.length - 1; i >= 0; i--) {
    const url = images[i]?.url || '';
    if (url && !url.includes('artist-default') && !url.includes('/_i/3.0/')) {
      return toProxiedImageUrl(url);
    }
  }
  return fallback;
}

function mapSaavnLanguage(rawLang?: string): Track['language'] {
  const low = (rawLang || '').toLowerCase();
  if (low.includes('hindi') || low.includes('punjabi')) return 'Hindi';
  if (low.includes('japanese') || low.includes('j-pop')) return 'J-Pop';
  if (low.includes('english')) return 'English';
  return 'Other';
}

function mapSaavnSong(raw: SaavnSongRaw): Track {
  const names: string[] = [];
  const seen = new Set<string>();
  const primaryAndFeatured = [
    ...(raw.artists?.primary || []),
    ...(raw.artists?.featured || []),
  ];
  const sources =
    primaryAndFeatured.length > 0 ? primaryAndFeatured : (raw.artists?.all || []).slice(0, 3);
  for (const item of sources) {
    const n = (item.name || '').trim();
    if (n && !seen.has(n.toLowerCase())) {
      seen.add(n.toLowerCase());
      names.push(decodeHtmlEntities(n));
    }
  }

  const streamUrls: Track['streamUrls'] = {};
  for (const d of raw.downloadUrl || []) {
    if (
      d.url &&
      (d.quality === '320kbps' ||
        d.quality === '160kbps' ||
        d.quality === '96kbps' ||
        d.quality === '48kbps' ||
        d.quality === '12kbps')
    ) {
      streamUrls[d.quality] = d.url;
    }
  }

  const name = decodeHtmlEntities(raw.name || 'Untitled Track');
  const albumName = decodeHtmlEntities(raw.album?.name || 'Single');

  return {
    id: `saavn-${raw.id}`,
    name,
    artist: names.slice(0, 3).join(', ') || 'Unknown Artist',
    albumName,
    year: raw.year,
    duration: Number(raw.duration) || 195,
    playCount: Number(raw.playCount) || undefined,
    image: pickSaavnImage(raw.image),
    language: mapSaavnLanguage(raw.language),
    hasLyrics: !isUnnecessaryNoLyricsTrack({
      id: raw.id,
      name,
      artist: '',
      albumName,
      duration: 0,
      image: '',
    }),
    streamUrls,
    synthMood: mapSaavnLanguage(raw.language) === 'Hindi' ? 'hindi' : 'pop',
  };
}

function normalizeRemoteTrack(raw: Track): Track {
  return {
    ...raw,
    image: toProxiedImageUrl(raw.image) || ARTWORK.englishVinyl,
  };
}

export async function fetchRegionalDiscovery(region: MusicRegion): Promise<Track[]> {
  try {
    const res = await fetch(`/api/music/discover?region=${encodeURIComponent(region)}`);
    if (res.ok) {
      const json = (await res.json()) as { ok?: boolean; tracks?: Track[] };
      if (json.ok && json.tracks?.length) {
        return json.tracks.map(normalizeRemoteTrack);
      }
    }
  } catch {
    // Fallback to curated catalog
  }
  return SEED_TRACKS;
}

export async function searchSongs(
  query: string,
  options: { region?: MusicRegion; prioritizeLyrics?: boolean; languageFilter?: MusicLanguage | 'All' } = {}
): Promise<{ tracks: Track[]; source: 'live' | 'catalog' }> {
  const { region = 'IN', prioritizeLyrics = true, languageFilter = 'All' } = options;
  const trimmed = query.trim();
  if (!trimmed) {
    return {
      tracks: filterAndRankTracks(SEED_TRACKS, '', { prioritizeLyrics, languageFilter }),
      source: 'catalog',
    };
  }

  const localMatches = filterAndRankTracks(SEED_TRACKS, trimmed, {
    prioritizeLyrics,
    languageFilter,
  });

  try {
    const res = await fetch(
      `/api/music/search?type=songs&query=${encodeURIComponent(trimmed)}&region=${encodeURIComponent(region)}&limit=16`
    );
    if (res.ok) {
      const json = (await res.json()) as {
        ok?: boolean;
        data?: {
          results?: SaavnSongRaw[];
          itunesTracks?: Track[];
          deezerTracks?: Track[];
          audiusTracks?: Track[];
        };
      };
      const saavnRaw = json.data?.results || [];
      const deezerRaw = (json.data?.deezerTracks || []).map(normalizeRemoteTrack);
      const itunesRaw = (json.data?.itunesTracks || []).map(normalizeRemoteTrack);
      const audiusRaw = (json.data?.audiusTracks || []).map(normalizeRemoteTrack);

      const mappedSaavn = saavnRaw
        .map(mapSaavnSong)
        .filter(
          (t) =>
            typeof t.playCount === 'number' &&
            t.playCount >= 5000 &&
            (!prioritizeLyrics || !isUnnecessaryNoLyricsTrack(t)) &&
            !isRemixOrKnockoff(`${t.name} ${t.albumName}`, trimmed, t.artist, trimmed)
        );

      const combinedRemote = [...deezerRaw, ...itunesRaw, ...mappedSaavn, ...audiusRaw]
        .filter(
          (t) =>
            (languageFilter === 'All' ? true : t.language === languageFilter) &&
            !isRemixOrKnockoff(`${t.name} ${t.albumName}`, trimmed, t.artist, trimmed)
        )
        .sort((a, b) => (b.playCount || 0) - (a.playCount || 0));

      const seen = new Set(localMatches.map((t) => `${t.name.toLowerCase()}::${t.artist.toLowerCase()}`));
      const dedupedRemote: Track[] = [];
      for (const item of combinedRemote) {
        const key = `${item.name.toLowerCase()}::${item.artist.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          dedupedRemote.push(item);
        }
      }

      const merged = [...localMatches, ...dedupedRemote].slice(0, 30);
      if (merged.length > 0) {
        return { tracks: merged, source: 'live' };
      }
    }
  } catch {
    // Fallback
  }

  return {
    tracks: localMatches.length ? localMatches : SEED_TRACKS,
    source: 'catalog',
  };
}

export async function searchAlbums(query: string): Promise<{
  albums: Array<{ id: string; name: string; subtitle: string; image: string; isLocal: boolean }>;
}> {
  const q = query.trim().toLowerCase();
  const localAlbums = SEED_ALBUMS.filter(
    (a) => !q || a.name.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q)
  ).map((a) => ({
    id: a.id,
    name: a.name,
    subtitle: `${a.artist} · ${a.year}`,
    image: a.image,
    isLocal: true,
  }));

  if (!q) return { albums: localAlbums };

  try {
    const res = await fetch(`/api/music/search?type=albums&query=${encodeURIComponent(query)}&limit=12`);
    if (res.ok) {
      const json = (await res.json()) as {
        ok?: boolean;
        data?: {
          results?: Array<{ id: string; name?: string; year?: string; image?: SaavnImage[] }>;
          deezerItems?: Array<{
            id?: number;
            title?: string;
            cover_big?: string;
            cover_medium?: string;
            artist?: { name?: string };
          }>;
        };
      };
      const saavnRaw = json.data?.results || [];
      const dzRaw = json.data?.deezerItems || [];
      if (json.ok && (saavnRaw.length > 0 || dzRaw.length > 0)) {
        const dzMapped = dzRaw.map((a) => ({
          id: `dz-alb:${a.id}`,
          name: decodeHtmlEntities(a.title || 'Album'),
          subtitle: a.artist?.name ? `${a.artist.name} · Album` : 'Album',
          image: toProxiedImageUrl(a.cover_big || a.cover_medium) || ARTWORK.englishVinyl,
          isLocal: false,
        }));
        const remote = saavnRaw.map((a) => ({
          id: `saavn-alb:${a.id}`,
          name: decodeHtmlEntities(a.name || 'Album'),
          subtitle: a.year ? `${a.year} · Album` : 'Album',
          image: pickSaavnImage(a.image, ARTWORK.englishVinyl),
          isLocal: false,
        }));
        return { albums: [...localAlbums, ...dzMapped, ...remote].slice(0, 18) };
      }
    }
  } catch {
    // Fallback
  }

  return { albums: localAlbums };
}

export async function searchPlaylists(query: string): Promise<{
  playlists: Array<{ id: string; name: string; subtitle: string; image: string; isLocal: boolean }>;
}> {
  const q = query.trim().toLowerCase();
  const localPlaylists = SEED_PLAYLISTS.filter(
    (p) => !q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
  ).map((p) => ({
    id: p.id,
    name: p.name,
    subtitle: `${p.tracks.length} songs`,
    image: p.image,
    isLocal: true,
  }));

  if (!q) return { playlists: localPlaylists };

  try {
    const res = await fetch(`/api/music/search?type=playlists&query=${encodeURIComponent(query)}&limit=12`);
    if (res.ok) {
      const json = (await res.json()) as {
        ok?: boolean;
        data?: {
          results?: Array<{ id: string; name?: string; songCount?: number; image?: SaavnImage[] }>;
          deezerItems?: Array<{
            id?: number;
            title?: string;
            nb_tracks?: number;
            picture_big?: string;
            picture_medium?: string;
          }>;
        };
      };
      const saavnRaw = json.data?.results || [];
      const dzRaw = json.data?.deezerItems || [];
      if (json.ok && (saavnRaw.length > 0 || dzRaw.length > 0)) {
        const dzMapped = dzRaw.map((p) => ({
          id: `dz-pl:${p.id}`,
          name: decodeHtmlEntities(p.title || 'Playlist'),
          subtitle: p.nb_tracks ? `${p.nb_tracks} songs` : 'Playlist',
          image: toProxiedImageUrl(p.picture_big || p.picture_medium) || ARTWORK.hindiMidnight,
          isLocal: false,
        }));
        const remote = saavnRaw.map((p) => ({
          id: `saavn-pl:${p.id}`,
          name: decodeHtmlEntities(p.name || 'Playlist'),
          subtitle: p.songCount ? `${p.songCount} songs` : 'Playlist',
          image: pickSaavnImage(p.image, ARTWORK.hindiMidnight),
          isLocal: false,
        }));
        return { playlists: [...localPlaylists, ...dzMapped, ...remote].slice(0, 18) };
      }
    }
  } catch {
    // Fallback
  }

  return { playlists: localPlaylists };
}

export async function searchArtists(query: string): Promise<{
  artists: Array<{ id: string; name: string; subtitle: string; image: string; isLocal: boolean }>;
}> {
  const q = query.trim().toLowerCase();
  const localArtists = SEED_ARTISTS.filter(
    (a) => !q || a.name.toLowerCase().includes(q) || a.genre.toLowerCase().includes(q)
  ).map((a) => ({
    id: a.id,
    name: a.name,
    subtitle: a.genre,
    image: a.image,
    isLocal: true,
  }));

  if (!q) return { artists: localArtists };

  try {
    const res = await fetch(`/api/music/search?type=artists&query=${encodeURIComponent(query)}&limit=12`);
    if (res.ok) {
      const json = (await res.json()) as {
        ok?: boolean;
        data?: {
          results?: Array<{ id: string; name?: string; image?: SaavnImage[] }>;
          deezerItems?: Array<{
            id?: number;
            name?: string;
            picture_big?: string;
            picture_medium?: string;
            nb_fan?: number;
          }>;
        };
      };
      const saavnRaw = json.data?.results || [];
      const dzRaw = json.data?.deezerItems || [];
      if (json.ok && (saavnRaw.length > 0 || dzRaw.length > 0)) {
        const dzMapped = dzRaw.map((a) => ({
          id: `dz-art:${a.id}`,
          name: decodeHtmlEntities(a.name || 'Artist'),
          subtitle: a.nb_fan ? `Artist · ${Math.round(a.nb_fan / 1000)}K fans` : 'Artist',
          image: toProxiedImageUrl(a.picture_big || a.picture_medium) || ARTWORK.popArtist,
          isLocal: false,
        }));
        const remote = saavnRaw.map((a) => ({
          id: `saavn-art:${a.id}`,
          name: decodeHtmlEntities(a.name || 'Artist'),
          subtitle: 'Artist',
          image: pickSaavnImage(a.image, ARTWORK.popArtist),
          isLocal: false,
        }));
        return { artists: [...localArtists, ...dzMapped, ...remote].slice(0, 18) };
      }
    }
  } catch {
    // Fallback
  }

  return { artists: localArtists };
}

export async function loadCollectionTracks(
  kind: 'albums' | 'playlists' | 'artists',
  id: string
): Promise<{ title: string; subtitle: string; image: string; tracks: Track[] }> {
  if (kind === 'albums') {
    const localAlbum = SEED_ALBUMS.find((a) => a.id === id);
    if (localAlbum) {
      return {
        title: localAlbum.name,
        subtitle: `${localAlbum.artist} · ${localAlbum.year}`,
        image: localAlbum.image,
        tracks: localAlbum.trackIds
          .map((tid) => SEED_TRACKS.find((t) => t.id === tid))
          .filter((t): t is Track => Boolean(t)),
      };
    }
  }

  if (kind === 'playlists') {
    const localPl = SEED_PLAYLISTS.find((p) => p.id === id);
    if (localPl) {
      return {
        title: localPl.name,
        subtitle: localPl.description,
        image: localPl.image,
        tracks: localPl.tracks,
      };
    }
  }

  if (kind === 'artists') {
    const localArtist = SEED_ARTISTS.find((a) => a.id === id);
    if (localArtist) {
      return {
        title: localArtist.name,
        subtitle: `${localArtist.genre} · ${localArtist.monthlyListeners}`,
        image: localArtist.image,
        tracks: localArtist.topTrackIds
          .map((tid) => SEED_TRACKS.find((t) => t.id === tid))
          .filter((t): t is Track => Boolean(t)),
      };
    }
  }

  const detailId = id.startsWith('dz-') ? id : id.replace(/^saavn-(alb|pl|art):/, '');
  try {
    const res = await fetch(`/api/music/detail?type=${kind}&id=${encodeURIComponent(detailId)}&limit=30`);
    if (res.ok) {
      const json = (await res.json()) as {
        ok?: boolean;
        source?: string;
        data?: { name?: string; image?: SaavnImage[] | string; songs?: SaavnSongRaw[]; tracks?: Track[] };
      };
      if (json.ok && json.source === 'deezer' && json.data?.tracks?.length) {
        const tracks = json.data.tracks.map(normalizeRemoteTrack);
        const img = typeof json.data.image === 'string' ? toProxiedImageUrl(json.data.image) : '';
        return {
          title: decodeHtmlEntities(json.data.name || 'Collection'),
          subtitle: `${tracks.length} tracks`,
          image: img || tracks[0]?.image || ARTWORK.englishVinyl,
          tracks,
        };
      }
      if (json.ok && json.data?.songs?.length) {
        const tracks = json.data.songs
          .map(mapSaavnSong)
          .filter((t) => !isUnnecessaryNoLyricsTrack(t) && !isRemixOrKnockoff(t.name, '', t.artist, ''));
        const saavnImages = Array.isArray(json.data.image) ? json.data.image : undefined;
        return {
          title: decodeHtmlEntities(json.data.name || 'Collection'),
          subtitle: `${tracks.length} tracks`,
          image: pickSaavnImage(saavnImages, tracks[0]?.image || ARTWORK.englishVinyl),
          tracks,
        };
      }
    }
  } catch {
    // Fallback
  }

  return {
    title: 'Curated Mix',
    subtitle: 'Harmonia Selection',
    image: ARTWORK.englishVinyl,
    tracks: SEED_TRACKS.slice(0, 8),
  };
}

export async function searchVideos(query: string): Promise<VideoResult[]> {
  const q = query.trim().toLowerCase();
  const localVids = SEED_VIDEOS.filter(
    (v) => !q || v.title.toLowerCase().includes(q) || v.channel.toLowerCase().includes(q)
  );

  try {
    const res = await fetch(`/api/music/videos?query=${encodeURIComponent(query)}&limit=12`);
    if (res.ok) {
      const json = (await res.json()) as { ok?: boolean; results?: VideoResult[] };
      if (json.ok && json.results?.length) {
        return json.results.map((v) => ({
          ...v,
          thumbnail: toProxiedImageUrl(`https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`),
        }));
      }
    }
  } catch {
    // Fallback
  }

  return localVids.length ? localVids : SEED_VIDEOS;
}

export async function fetchTrackLyrics(track: Track): Promise<{ lines: LyricLine[]; synced: boolean }> {
  const primaryArtist = track.artist.split(',')[0]?.trim() || '';
  const cleanTitle = track.name.split('(')[0]?.split('-')[0]?.trim() || track.name;
  try {
    const res = await fetch(
      `/api/music/lyrics?artist=${encodeURIComponent(primaryArtist)}&title=${encodeURIComponent(cleanTitle)}&duration=${Math.round(track.duration || 195)}`
    );
    if (res.ok) {
      const json = (await res.json()) as {
        ok?: boolean;
        hasLyrics?: boolean;
        synced?: boolean;
        lines?: LyricLine[];
      };
      if (json.ok && json.hasLyrics && json.lines?.length) {
        return { lines: json.lines, synced: Boolean(json.synced) };
      }
    }
  } catch {
    // Fallback to curated synced lines
  }

  if (track.lyrics?.length) {
    return { lines: track.lyrics, synced: true };
  }

  const fallbackLines = parsePlainLyricsToLines(
    `${track.name}\n${track.artist}\n${track.albumName}`,
    track.duration
  );
  return { lines: fallbackLines, synced: false };
}

export interface BackendUserState {
  displayName?: string;
  region: MusicRegion;
  preferredLanguages: MusicLanguage[];
  favoriteArtists?: string[];
  preferredMoods?: string[];
  prioritizeLyrics?: boolean;
  likedMap: Record<string, Track>;
  playlists: CuratedPlaylist[];
  recentlyPlayed: Track[];
  artistAffinity: Record<string, number>;
  languageAffinity: Record<string, number>;
  genreAffinity: Record<string, number>;
  playCounts: Record<string, number>;
}

// Listener preferences and playlists remain in localStorage until authenticated
// multi-user storage is implemented. Never send personal state to a shared JSON file.
export async function fetchBackendUserState(): Promise<BackendUserState | null> {
  return null;
}

export async function sendUserEvent(_payload: {
  type: 'play' | 'like' | 'unlike' | 'region' | 'languages';
  track?: Track;
  region?: MusicRegion;
  languages?: MusicLanguage[];
}): Promise<BackendUserState | null> {
  return null;
}

export async function sendPersonalisation(_payload: {
  resetTaste?: boolean;
  displayName?: string;
  region?: MusicRegion;
  preferredLanguages?: MusicLanguage[];
  favoriteArtists?: string[];
  preferredMoods?: string[];
  prioritizeLyrics?: boolean;
}): Promise<BackendUserState | null> {
  return null;
}

export async function syncBackendPlaylists(_playlists: CuratedPlaylist[]): Promise<void> {
  // Local snapshot persistence in App.tsx is the single source of truth.
}

export function buildTasteProfile(state: {
  region: MusicRegion;
  preferredLanguages: MusicLanguage[];
  favoriteArtists?: string[];
  preferredMoods?: string[];
  prioritizeLyrics?: boolean;
  artistAffinity: Record<string, number>;
  languageAffinity: Record<string, number>;
  genreAffinity: Record<string, number>;
  playCounts: Record<string, number>;
  likedMap: Record<string, Track>;
  recentlyPlayed: Track[];
}): UserTasteProfile {
  return {
    region: state.region,
    preferredLanguages: state.preferredLanguages,
    favoriteArtists: state.favoriteArtists,
    preferredMoods: state.preferredMoods,
    prioritizeLyrics: state.prioritizeLyrics,
    artistAffinity: state.artistAffinity,
    languageAffinity: state.languageAffinity,
    genreAffinity: state.genreAffinity,
    playCounts: state.playCounts,
    likedIds: Object.keys(state.likedMap),
    recentIds: state.recentlyPlayed.map((t) => t.id),
  };
}

export function getArtistProfileById(id: string): ArtistProfile | undefined {
  return SEED_ARTISTS.find((a) => a.id === id);
}

const resolvedTrackCache = new Map<
  string,
  Partial<Pick<Track, 'streamUrls' | 'previewUrl' | 'youtubeId'>> & { alternates?: string[] }
>();

export async function resolveTrackStreams(
  track: Track
): Promise<Track & { alternates?: string[] }> {
  const cached = resolvedTrackCache.get(track.id);
  if (hasFullAudioStream(track)) {
    return { ...track, alternates: cached?.alternates, youtubeId: cached?.youtubeId || track.youtubeId };
  }
  if (
    cached &&
    ((cached.streamUrls && Object.keys(cached.streamUrls).length > 0) ||
      cached.previewUrl ||
      cached.youtubeId)
  ) {
    return {
      ...track,
      streamUrls: cached.streamUrls || track.streamUrls,
      previewUrl: cached.previewUrl || track.previewUrl,
      alternates: cached.alternates,
      youtubeId: cached.youtubeId || track.youtubeId,
    };
  }
  try {
    const res = await fetch(
      `/api/music/resolve?title=${encodeURIComponent(track.name)}&artist=${encodeURIComponent(
        track.artist
      )}&duration=${Math.round(track.duration || 0)}`
    );
    if (res.ok) {
      const json = (await res.json()) as {
        ok?: boolean;
        streamUrls?: Track['streamUrls'];
        previewUrl?: string;
        alternates?: string[];
        youtubeId?: string;
      };
      if (
        json.ok &&
        ((json.streamUrls && Object.keys(json.streamUrls).length > 0) ||
          json.previewUrl ||
          json.youtubeId)
      ) {
        const entry = {
          streamUrls:
            json.streamUrls && Object.keys(json.streamUrls).length > 0
              ? json.streamUrls
              : track.streamUrls,
          previewUrl: json.previewUrl || track.previewUrl,
          alternates: json.alternates,
          youtubeId: json.youtubeId || track.youtubeId,
        };
        resolvedTrackCache.set(track.id, entry);
        return { ...track, ...entry };
      }
    }
  } catch {
    // Fallback gracefully
  }
  return track;
}

export async function fetchSpotifyPlaylists(): Promise<CuratedPlaylist[]> {
  try {
    const res = await fetch('/api/music/spotify/playlists');
    if (res.ok) {
      const json = (await res.json()) as { ok?: boolean; playlists?: CuratedPlaylist[] };
      if (json.ok && json.playlists?.length) {
        return json.playlists.map((pl) => ({
          ...pl,
          image: toProxiedImageUrl(pl.image) || ARTWORK.englishVinyl,
          tracks: (pl.tracks || []).map(normalizeRemoteTrack),
        }));
      }
    }
  } catch {
    // Graceful fallback
  }
  return [];
}

export async function resolveSpotifyUrl(urlOrUri: string): Promise<{
  ok: boolean;
  kind?: 'track' | 'album' | 'playlist' | 'artist';
  id?: string;
  title?: string;
  subtitle?: string;
  image?: string;
  tracks?: Track[];
  error?: string;
}> {
  try {
    const res = await fetch(`/api/music/spotify/resolve?url=${encodeURIComponent(urlOrUri.trim())}`);
    const json = (await res.json()) as {
      ok?: boolean;
      kind?: 'track' | 'album' | 'playlist' | 'artist';
      id?: string;
      title?: string;
      subtitle?: string;
      image?: string;
      tracks?: Track[];
      error?: string;
    };
    if (json.ok && json.tracks?.length) {
      return {
        ...json,
        ok: true,
        image: toProxiedImageUrl(json.image) || ARTWORK.englishVinyl,
        tracks: json.tracks.map(normalizeRemoteTrack),
      };
    }
    return { ok: false, error: json.error || 'Could not load Spotify link' };
  } catch {
    return { ok: false, error: 'Network error resolving Spotify link' };
  }
}
