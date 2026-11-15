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
  isPlausibleSongDuration,
  isRelevantTrackTitle,
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
interface MusicBrainzRecordingRaw {
  id?: string;
  title?: string;
  length?: number;
  'artist-credit'?: Array<string | { name?: string; artist?: { name?: string } }>;
  releases?: Array<{ title?: string; date?: string }>;
}

interface MusicBrainzArtistRaw { id?: string; name?: string; disambiguation?: string; country?: string; }

function mapMusicBrainzRecording(raw: MusicBrainzRecordingRaw): Track {
  const credits = (raw['artist-credit'] || [])
    .map((entry) => typeof entry === 'string' ? entry : entry.name || entry.artist?.name || '')
    .filter(Boolean);
  return {
    id: 'mb-rec:' + (raw.id || Math.random().toString(36).slice(2, 9)),
    name: decodeHtmlEntities(raw.title || 'Untitled Recording'),
    artist: credits.join(', ') || 'Unknown Artist',
    albumName: decodeHtmlEntities(raw.releases?.[0]?.title || 'Recording'),
    year: raw.releases?.[0]?.date?.slice(0, 4),
    duration: raw.length ? Math.round(raw.length / 1000) : 195,
    image: ARTWORK.englishVinyl,
    language: 'Other',
    region: 'GLOBAL',
    genre: 'MusicBrainz metadata',
    hasLyrics: true,
    metadataOnly: true,
  };
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
  const low = (rawLang || '').toLowerCase().trim();
  const aliases: Array<[RegExp, MusicLanguage]> = [
    [/punjabi/, 'Punjabi'], [/haryanvi/, 'Haryanvi'], [/marathi/, 'Marathi'],
    [/bengali|bangla/, 'Bengali'], [/tamil/, 'Tamil'], [/telugu/, 'Telugu'],
    [/kannada/, 'Kannada'], [/malayalam/, 'Malayalam'], [/gujarati/, 'Gujarati'],
    [/bhojpuri/, 'Bhojpuri'], [/urdu/, 'Urdu'], [/hindi/, 'Hindi'],
    [/french/, 'French'], [/spanish|español/, 'Spanish'], [/korean/, 'Korean'],
    [/japanese/, 'Japanese'], [/j-?pop/, 'J-Pop'], [/chinese|mandarin|cantonese/, 'Chinese'],
    [/arabic/, 'Arabic'], [/portuguese/, 'Portuguese'], [/german/, 'German'],
    [/italian/, 'Italian'], [/turkish/, 'Turkish'], [/thai/, 'Thai'],
    [/indonesian|bahasa/, 'Indonesian'], [/english/, 'English'],
  ];
  return aliases.find(([pattern]) => pattern.test(low))?.[1] || 'Other';
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

function searchTextTokens(value: string): string[] {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter((token) => token.length > 1);
}

function isRelevantSearchCandidate(track: Pick<Track, 'name' | 'artist' | 'albumName'>, query: string): boolean {
  const q = searchTextTokens(query);
  if (!q.length) return true;
  const title = new Set(searchTextTokens(track.name));
  const artist = new Set(searchTextTokens(track.artist));
  const album = new Set(searchTextTokens(track.albumName));
  const hits = q.filter((token) => title.has(token)).length + q.filter((token) => artist.has(token)).length + q.filter((token) => album.has(token)).length * 0.35;
  const exactTitle = searchTextTokens(track.name).join(' ') === q.join(' ');
  const exactArtist = searchTextTokens(track.artist).join(' ') === q.join(' ');
  return exactTitle || exactArtist || hits / q.length >= 0.5;
}

function scoreSearchCandidate(track: Track, query: string): number {
  const q = searchTextTokens(query);
  const title = searchTextTokens(track.name);
  const artist = searchTextTokens(track.artist);
  const album = searchTextTokens(track.albumName);
  const qText = q.join(' ');
  const titleText = title.join(' ');
  const artistText = artist.join(' ');
  let score = titleText === qText ? 120 : titleText.startsWith(qText) ? 85 : q.filter((token) => title.includes(token)).length * 18;
  score += artistText === qText ? 105 : q.filter((token) => artist.includes(token)).length * 16;
  score += q.filter((token) => album.includes(token)).length * 4;
  score += Math.min(8, Math.log10(Math.max(1, track.playCount || 1)) * 2);
  return score;
}
function normalizeRemoteTrack(raw: Track): Track {
  return {
    ...raw,
    image: toProxiedImageUrl(raw.image) || ARTWORK.englishVinyl,
  };
}

export async function fetchRegionalDiscovery(region: MusicRegion, refresh = false): Promise<Track[]> {
  try {
    const res = await fetch(`/api/music/discover?region=${encodeURIComponent(region)}${refresh ? '&refresh=1' : ''}`);
    if (res.ok) {
      const json = (await res.json()) as { ok?: boolean; tracks?: Track[] };
      if (json.ok && json.tracks?.length) {
        return json.tracks.map(normalizeRemoteTrack);
      }
    }
  } catch {
    // Fallback to curated catalog
  }
  return [];
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
          musicBrainzRecordings?: MusicBrainzRecordingRaw[];
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
            (!prioritizeLyrics || !isUnnecessaryNoLyricsTrack(t)) &&
            isPlausibleSongDuration(t.duration) &&
            !isRemixOrKnockoff(`${t.name} ${t.albumName}`, trimmed, t.artist, trimmed)
        );

      const musicBrainzTracks = languageFilter === 'All'
        ? (json.data?.musicBrainzRecordings || [])
            .map(mapMusicBrainzRecording)
            .filter((t) => isPlausibleSongDuration(t.duration) && isRelevantSearchCandidate(t, trimmed))
        : [];

      const combinedRemote = [...deezerRaw, ...itunesRaw, ...mappedSaavn, ...audiusRaw, ...musicBrainzTracks]
        .filter(
          (t) =>
            isPlausibleSongDuration(t.duration) &&
            isRelevantSearchCandidate(t, trimmed) &&
            (languageFilter === 'All' || t.language === languageFilter) &&
            !isRemixOrKnockoff(`${t.name} ${t.albumName}`, trimmed, t.artist, trimmed)
        )
        .sort((a, b) => scoreSearchCandidate(b, trimmed) - scoreSearchCandidate(a, trimmed));

      const seen = new Set<string>();
      const dedupedRemote: Track[] = [];
      for (const item of combinedRemote) {
        const key = `${item.name.toLowerCase()}::${item.artist.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          dedupedRemote.push(item);
        }
      }

      // Prefer live catalogue matches; keep local catalogue matches as a fallback,
      // not as a fixed block that crowds out the user's actual query.
      const merged = [...dedupedRemote, ...localMatches].sort((a, b) => scoreSearchCandidate(b, trimmed) - scoreSearchCandidate(a, trimmed)).slice(0, 30);
      if (merged.length > 0) {
        return { tracks: merged, source: 'live' };
      }
    }
  } catch {
    // Fallback
  }

  // Never show unrelated demo tracks for a real search query.
  return {
    tracks: localMatches,
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
          musicBrainzArtists?: MusicBrainzArtistRaw[];
        };
      };
      const saavnRaw = json.data?.results || [];
      const dzRaw = json.data?.deezerItems || [];
      const mbRaw = json.data?.musicBrainzArtists || [];
      if (json.ok && (saavnRaw.length > 0 || dzRaw.length > 0 || mbRaw.length > 0)) {
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
        const musicBrainzMapped = mbRaw
          .filter((artist) => artist.id && artist.name)
          .map((artist) => ({
            id: 'mb-art:' + artist.id,
            name: decodeHtmlEntities(artist.name || 'Artist'),
            subtitle: ['MusicBrainz', artist.disambiguation, artist.country].filter(Boolean).join(' · '),
            image: ARTWORK.popArtist,
            isLocal: false,
          }));
        const seenArtists = new Set<string>();
        const mergedArtists = [...localArtists, ...dzMapped, ...remote, ...musicBrainzMapped].filter((artist) => {
          const key = artist.name.toLowerCase();
          if (seenArtists.has(key)) return false;
          seenArtists.add(key);
          return true;
        });
        return { artists: mergedArtists.slice(0, 24) };
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

  const detailId = id.startsWith('dz-') || id.startsWith('mb-art:') ? id : id.replace(/^saavn-(alb|pl|art):/, '');
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

function videoSearchTokens(value: string): string[] {
  const ignored = new Set(['official', 'music', 'video', 'videos', 'audio', 'lyrics', 'hd', '4k', 'full', 'song']);
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/)
    .filter((token) => token.length > 1 && !ignored.has(token));
}

export async function searchVideos(query: string): Promise<VideoResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const tokens = videoSearchTokens(trimmed);
  if (!tokens.length) return [];

  try {
    const res = await fetch(`/api/music/videos?query=${encodeURIComponent(trimmed)}&limit=16`);
    if (!res.ok) return [];
    const json = (await res.json()) as { ok?: boolean; results?: VideoResult[] };
    const results = Array.isArray(json.results) ? json.results : [];
    const ranked = results
      .filter((video) => video.id && video.title)
      .map((video) => {
        const title = videoSearchTokens(video.title);
        const channel = videoSearchTokens(video.channel || '');
        const titleHits = tokens.filter((token) => title.some((part) => part.includes(token) || token.includes(part))).length;
        const channelHits = tokens.filter((token) => channel.some((part) => part.includes(token) || token.includes(part))).length;
        const phrase = trimmed.toLowerCase().replace(/\s+/g, ' ');
        const titleText = (video.title || '').toLowerCase();
        const score = (titleHits / tokens.length) * 100 + (channelHits / tokens.length) * 18
          + (titleText.includes(phrase) ? 35 : 0);
        return { video, score };
      })
      .filter((item) => item.score >= 32)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map(({ video }) => ({
        ...video,
        thumbnail: toProxiedImageUrl(`https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`),
      }));
    return ranked;
  } catch {
    return [];
  }
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
  Partial<Pick<Track, 'streamUrls' | 'previewUrl' | 'youtubeId' | 'youtubeAlternates'>> & { alternates?: string[] }
>();
const resolvedTrackInflight = new Map<string, Promise<Track & { alternates?: string[] }>>();
const failedResolveUntil = new Map<string, number>();

export async function resolveTrackStreams(
  track: Track,
  options: { forceRefresh?: boolean } = {}
): Promise<Track & { alternates?: string[] }> {
  const forceRefresh = Boolean(options.forceRefresh);
  const cached = resolvedTrackCache.get(track.id);
  if (forceRefresh) {
    resolvedTrackCache.delete(track.id);
    failedResolveUntil.delete(track.id);
  }
  if (!forceRefresh && hasFullAudioStream(track)) {
    return {
      ...track,
      alternates: cached?.alternates,
      youtubeId: cached?.youtubeId || track.youtubeId,
      youtubeAlternates: cached?.youtubeAlternates || track.youtubeAlternates,
    };
  }
  if (
    !forceRefresh &&
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
      youtubeAlternates: cached.youtubeAlternates || track.youtubeAlternates,
    };
  }

  const failedUntil = failedResolveUntil.get(track.id) || 0;
  if (!forceRefresh && failedUntil > Date.now()) return track;
  if (failedUntil) failedResolveUntil.delete(track.id);

  const pending = !forceRefresh ? resolvedTrackInflight.get(track.id) : undefined;
  if (pending) return pending;

  const request = (async (): Promise<Track & { alternates?: string[] }> => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    try {
      const res = await fetch(
        `/api/music/resolve?title=${encodeURIComponent(track.name)}&artist=${encodeURIComponent(
          track.artist
        )}&duration=${Math.round(track.duration || 0)}&forceRefresh=${forceRefresh ? '1' : '0'}`,
        { signal: controller.signal }
      );
      if (res.ok) {
        const json = (await res.json()) as {
          ok?: boolean;
          streamUrls?: Track['streamUrls'];
          previewUrl?: string;
          alternates?: string[];
          youtubeId?: string;
          youtubeAlternates?: string[];
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
            youtubeAlternates: json.youtubeAlternates || track.youtubeAlternates,
          };
          resolvedTrackCache.set(track.id, entry);
          failedResolveUntil.delete(track.id);
          return { ...track, ...entry };
        }
      }
    } catch {
      // A timed-out or unavailable resolver must not block the player.
    } finally {
      window.clearTimeout(timeout);
    }

    // Avoid hammering every provider on repeated renders when no source was found.
    // Explicit retries bypass this short negative cache.
    failedResolveUntil.set(track.id, Date.now() + 20_000);
    if (forceRefresh) {
      return {
        ...track,
        streamUrls: undefined,
        previewUrl: undefined,
        youtubeId: undefined,
        youtubeAlternates: [],
        alternates: [],
      };
    }
    return track;
  })();

  if (!forceRefresh) resolvedTrackInflight.set(track.id, request);
  try {
    return await request;
  } finally {
    if (resolvedTrackInflight.get(track.id) === request) {
      resolvedTrackInflight.delete(track.id);
    }
  }
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
