import type {
  ArtistAlbumSummary,
  ArtistPageData,
  ArtistProfile,
  ArtistTarget,
  FollowedArtist,
  MusicLanguage,
  RelatedArtistSummary,
  Track,
} from '../types/music';
import { hasFullAudioStream } from './playerEngine';

export type ArtistSongSort = 'popular' | 'newest' | 'title' | 'duration';

export function normalizeArtistNameKey(name: string): string {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function normalizeTrackTitleKey(name: string): string {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\s+[-–—]\s*(?:from\b.*|original\s+motion\s+picture.*|soundtrack.*)$/i, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function extractAllArtistCredits(artistCredit: string): string[] {
  const raw = String(artistCredit || '').trim();
  if (!raw) return [];
  return raw
    .split(/\s*(?:,|&|\bfeat\.?\b|\bft\.?\b|\bwith\b|\bx\b|·)\s*/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function extractPrimaryArtistName(artistCredit: string): string {
  const credits = extractAllArtistCredits(artistCredit);
  return credits[0] || String(artistCredit || '').trim() || 'Unknown Artist';
}

export function doesTrackBelongToArtist(
  track: Pick<Track, 'name' | 'artist' | 'albumName'>,
  artistName: string
): boolean {
  const target = normalizeArtistNameKey(artistName);
  if (!target) return true;
  const credits = extractAllArtistCredits(track.artist).map(normalizeArtistNameKey);
  if (credits.some((c) => c === target)) return true;
  const fullArtist = normalizeArtistNameKey(track.artist);
  if (fullArtist === target) return true;
  // Handle single-artist credits or multi-word names appearing cleanly as credit substrings
  const targetTokens = target.split(' ').filter(Boolean);
  if (targetTokens.length === 0) return true;
  return credits.some((credit) => {
    const creditTokens = credit.split(' ').filter(Boolean);
    return (
      targetTokens.length >= 2 &&
      targetTokens.every((tok) => creditTokens.includes(tok))
    );
  });
}

function scoreTrackQualityForDedupe(track: Track): number {
  let score = 0;
  if (hasFullAudioStream(track)) score += 1000;
  else if (track.previewUrl) score += 250;
  if (!track.metadataOnly) score += 100;
  if (track.sourceProvider === 'SoundCloud') score -= 60;
  else if (track.sourceProvider === 'JioSaavn' || track.sourceProvider === 'Catalog') score += 40;
  if (track.playCount && track.playCount > 0) {
    score += Math.min(200, Math.log10(Math.max(1, track.playCount)) * 20);
  }
  if (parseReleaseYear(track.year) > 0) score += 15;
  if (track.albumName && track.albumName.toLowerCase() !== 'single') score += 10;
  if (track.hasLyrics) score += 5;
  if (track.image) score += 5;
  return score;
}

function extractTrackVariantTag(name: string): string {
  const lower = String(name || '').toLowerCase();
  const variantMatch = lower.match(/\b(unplugged|acoustic|lofi|lo-fi|reprise|live|instrumental|slowed|reverb|remix|mashup|cover|sped\s*up)\b/);
  return variantMatch ? variantMatch[1].replace(/\s+/g, '') : '';
}

export function dedupeArtistTracks(tracks: Track[]): Track[] {
  const indexById = new Map<string, number>();
  const indicesByTitleVariant = new Map<string, number[]>();
  const result: Track[] = [];

  for (const track of tracks) {
    if (!track || !track.id || !track.name) continue;
    const titleKey = normalizeTrackTitleKey(track.name) || track.name.toLowerCase().trim();
    const variantKey = extractTrackVariantTag(track.name);
    const titleVariantKey = `${titleKey}::${variantKey}`;
    const credits = new Set(extractAllArtistCredits(track.artist).map(normalizeArtistNameKey).filter(Boolean));

    let existingIdx = indexById.get(track.id);
    if (existingIdx === undefined) {
      const candidates = indicesByTitleVariant.get(titleVariantKey) || [];
      for (const idx of candidates) {
        const existing = result[idx];
        const existingCredits = extractAllArtistCredits(existing.artist)
          .map(normalizeArtistNameKey)
          .filter(Boolean);
        const sharesCredit = existingCredits.some((c) => credits.has(c));
        const sameDuration =
          track.duration > 0 &&
          existing.duration > 0 &&
          Math.abs(track.duration - existing.duration) <= 5;
        if (sharesCredit || sameDuration) {
          existingIdx = idx;
          break;
        }
      }
    }

    if (existingIdx === undefined) {
      const nextIdx = result.length;
      result.push(track);
      indexById.set(track.id, nextIdx);
      const list = indicesByTitleVariant.get(titleVariantKey) || [];
      list.push(nextIdx);
      indicesByTitleVariant.set(titleVariantKey, list);
      continue;
    }

    const existing = result[existingIdx];
    const preferIncoming = scoreTrackQualityForDedupe(track) > scoreTrackQualityForDedupe(existing);
    const primary = preferIncoming ? track : existing;
    const secondary = preferIncoming ? existing : track;

    result[existingIdx] = {
      ...secondary,
      ...primary,
      year: primary.year || secondary.year,
      albumName:
        primary.albumName && primary.albumName !== 'Single'
          ? primary.albumName
          : secondary.albumName || primary.albumName,
      playCount: Math.max(primary.playCount || 0, secondary.playCount || 0) || undefined,
      image: primary.image || secondary.image,
      language: primary.language && primary.language !== 'Other' ? primary.language : secondary.language || primary.language,
      genre: primary.genre || secondary.genre,
      streamUrls: primary.streamUrls || secondary.streamUrls,
      previewUrl: primary.previewUrl || secondary.previewUrl,
      youtubeId: primary.youtubeId || secondary.youtubeId,
    };
  }

  return result;
}

export const dedupeCanonicalTracks = dedupeArtistTracks;

export function parseReleaseYear(year?: string): number {
  if (!year) return 0;
  const match = String(year).match(/\b(19\d{2}|20\d{2})\b/);
  if (!match) return 0;
  const numeric = Number(match[1]);
  const maxAllowed = new Date().getFullYear() + 1;
  return numeric >= 1900 && numeric <= maxAllowed ? numeric : 0;
}

export function sortArtistTracks(
  tracks: Track[],
  sortBy: ArtistSongSort,
  seedTopIds: string[] = []
): Track[] {
  const seedRank = new Map(seedTopIds.map((id, idx) => [id, idx]));
  const copy = [...tracks];

  copy.sort((a, b) => {
    if (sortBy === 'title') {
      return a.name.localeCompare(b.name);
    }
    if (sortBy === 'duration') {
      return (b.duration || 0) - (a.duration || 0) || a.name.localeCompare(b.name);
    }
    if (sortBy === 'newest') {
      const yA = parseReleaseYear(a.year);
      const yB = parseReleaseYear(b.year);
      if (yB !== yA) return yB - yA;
      return (b.playCount || 0) - (a.playCount || 0) || a.name.localeCompare(b.name);
    }
    // 'popular'
    const rankA = seedRank.get(a.id);
    const rankB = seedRank.get(b.id);
    const pA = a.playCount || 0;
    const pB = b.playCount || 0;
    if (pA !== pB && (pA > 0 || pB > 0)) {
      return pB - pA;
    }
    if (rankA !== undefined && rankB !== undefined) return rankA - rankB;
    if (rankA !== undefined) return -1;
    if (rankB !== undefined) return 1;
    const fullDiff = (hasFullAudioStream(b) ? 1 : 0) - (hasFullAudioStream(a) ? 1 : 0);
    if (fullDiff !== 0) return fullDiff;
    return parseReleaseYear(b.year) - parseReleaseYear(a.year);
  });

  return copy;
}

function normalizeAlbumKey(name: string): string {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function inferReleaseType(trackCount: number, explicitType?: 'Album' | 'Single' | 'EP'): 'Album' | 'Single' | 'EP' {
  if (explicitType) return explicitType;
  if (trackCount <= 1) return 'Single';
  if (trackCount <= 4) return 'EP';
  return 'Album';
}

export function extractArtistAlbumsAndLatestRelease(
  tracks: Track[],
  remoteAlbums: ArtistAlbumSummary[] = [],
  artistName = ''
): { albums: ArtistAlbumSummary[]; latestRelease: ArtistAlbumSummary | null } {
  const byKey = new Map<string, ArtistAlbumSummary>();

  for (const alb of remoteAlbums) {
    if (!alb?.name) continue;
    const key = normalizeAlbumKey(alb.name) || alb.id;
    if (!byKey.has(key)) {
      byKey.set(key, {
        ...alb,
        type: inferReleaseType(alb.trackCount || alb.tracks.length || 1, alb.type),
      });
    }
  }

  // Group tracks into albums / singles
  const groupedTracks = new Map<string, Track[]>();
  for (const track of tracks) {
    const rawAlbum = (track.albumName || '').trim();
    const isGenericSingle = !rawAlbum || /^single$/i.test(rawAlbum) || /^recording$/i.test(rawAlbum);
    const label = isGenericSingle ? track.name : rawAlbum;
    const key = normalizeAlbumKey(label);
    if (!key) continue;
    const list = groupedTracks.get(key) || [];
    list.push(track);
    groupedTracks.set(key, list);
  }

  for (const [key, group] of groupedTracks.entries()) {
    const existing = byKey.get(key);
    const years = group.map((t) => parseReleaseYear(t.year)).filter((y) => y > 0);
    const newestYear = years.length > 0 ? String(Math.max(...years)) : existing?.year;
    const representative = group[0];

    if (existing) {
      const mergedTracks = dedupeArtistTracks([...existing.tracks, ...group]);
      byKey.set(key, {
        ...existing,
        year: existing.year || newestYear,
        image: existing.image || representative?.image || '',
        tracks: mergedTracks,
        trackCount: Math.max(existing.trackCount || 0, mergedTracks.length),
        type: inferReleaseType(
          Math.max(existing.trackCount || 0, mergedTracks.length),
          existing.type
        ),
      });
    } else {
      const isGeneric =
        !representative?.albumName ||
        /^single$/i.test(representative.albumName.trim()) ||
        /^recording$/i.test(representative.albumName.trim());
      const albumTitle = isGeneric ? representative.name : representative.albumName.trim();
      byKey.set(key, {
        id: `artist-alb:${key.replace(/\s+/g, '-')}`,
        name: albumTitle,
        artist: artistName || extractPrimaryArtistName(representative.artist),
        year: newestYear,
        image: representative.image,
        trackCount: group.length,
        type: inferReleaseType(group.length),
        tracks: dedupeArtistTracks(group),
      });
    }
  }

  const albums = [...byKey.values()].sort((a, b) => {
    const yearA = parseReleaseYear(a.year);
    const yearB = parseReleaseYear(b.year);
    if (yearB !== yearA) return yearB - yearA;
    const countA = a.trackCount || a.tracks.length;
    const countB = b.trackCount || b.tracks.length;
    if (countB !== countA) return countB - countA;
    return a.name.localeCompare(b.name);
  });

  const isCompilationRelease = (name: string) =>
    /\b(all time|best of|greatest hits|top \d+|hits collection|essential|superhit)\b/i.test(name);

  // Latest release prefers the newest non-compilation entry with an explicit year
  const latestRelease =
    albums.find(
      (alb) =>
        parseReleaseYear(alb.year) > 0 &&
        !isCompilationRelease(alb.name) &&
        (alb.tracks.length > 0 || (alb.trackCount || 0) > 0)
    ) ||
    albums.find((alb) => parseReleaseYear(alb.year) > 0 && (alb.tracks.length > 0 || (alb.trackCount || 0) > 0)) ||
    albums[0] ||
    null;

  return { albums: albums.slice(0, 24), latestRelease };
}

export function buildRelatedArtists(
  artistName: string,
  language?: string,
  genre?: string,
  seedArtists: ArtistProfile[] = [],
  remoteRelated: RelatedArtistSummary[] = []
): RelatedArtistSummary[] {
  const selfKey = normalizeArtistNameKey(artistName);
  const seen = new Set<string>([selfKey]);
  const out: RelatedArtistSummary[] = [];

  for (const rel of remoteRelated) {
    const key = normalizeArtistNameKey(rel.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(rel);
  }

  const normalizedLang = (language || '').toLowerCase();
  const genreTokens = new Set(
    String(genre || '')
      .toLowerCase()
      .split(/[\s,·/&]+/)
      .filter((t) => t.length > 2)
  );

  const rankedSeeds = seedArtists
    .filter((seed) => {
      const key = normalizeArtistNameKey(seed.name);
      return key && !seen.has(key);
    })
    .map((seed) => {
      let score = 0;
      if (normalizedLang && seed.language && seed.language.toLowerCase() === normalizedLang) {
        score += 5;
      }
      const seedTokens = seed.genre.toLowerCase().split(/[\s,·/&]+/);
      for (const tok of seedTokens) {
        if (genreTokens.has(tok)) score += 2;
      }
      return { seed, score };
    })
    .sort((a, b) => b.score - a.score);

  for (const { seed } of rankedSeeds) {
    const key = normalizeArtistNameKey(seed.name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: seed.id,
      name: seed.name,
      subtitle: `${seed.genre} · ${seed.monthlyListeners}`,
      image: seed.image,
      genre: seed.genre,
      language: seed.language,
    });
    if (out.length >= 10) break;
  }

  return out.slice(0, 10);
}

export function getCanonicalFollowedArtistId(artistId: string, artistName: string): string {
  const cleanId = String(artistId || '').trim();
  if (cleanId && !cleanId.startsWith('artist-name:')) return cleanId;
  const slug = normalizeArtistNameKey(artistName).replace(/\s+/g, '-') || 'artist';
  return `artist-name:${slug}`;
}

export function isArtistFollowed(
  followedArtists: Record<string, FollowedArtist>,
  artistId: string,
  artistName: string
): boolean {
  return Boolean(findFollowedArtistEntry(followedArtists, artistId, artistName));
}

export function findFollowedArtistEntry(
  followedArtists: Record<string, FollowedArtist>,
  artistId: string,
  artistName: string
): { key: string; artist: FollowedArtist } | null {
  if (artistId && followedArtists[artistId]) {
    return { key: artistId, artist: followedArtists[artistId] };
  }
  const targetKey = normalizeArtistNameKey(artistName);
  if (!targetKey) return null;
  for (const [key, artist] of Object.entries(followedArtists)) {
    if (normalizeArtistNameKey(artist.name) === targetKey || artist.id === artistId) {
      return { key, artist };
    }
  }
  return null;
}

export function toggleFollowedArtistMap(
  current: Record<string, FollowedArtist>,
  target: ArtistTarget,
  nowMs = Date.now()
): {
  nextMap: Record<string, FollowedArtist>;
  followed: boolean;
  entryKey: string;
} {
  const existing = findFollowedArtistEntry(current, target.id, target.name);
  const nextMap = { ...current };
  if (existing) {
    delete nextMap[existing.key];
    return { nextMap, followed: false, entryKey: existing.key };
  }
  const entryKey = getCanonicalFollowedArtistId(target.id, target.name);
  nextMap[entryKey] = {
    id: entryKey,
    name: target.name.trim(),
    image: target.image || '',
    genre: target.genre,
    language: target.language,
    monthlyListeners: target.monthlyListeners,
    bio: target.bio,
    followedAtMs: nowMs,
  };
  return { nextMap, followed: true, entryKey };
}

export function buildArtistPageData(input: {
  target: ArtistTarget;
  seedArtist?: ArtistProfile;
  seedTracks: Track[];
  seedAlbums: Array<{ id: string; name: string; artist: string; year: string; image: string; trackIds: string[] }>;
  seedArtists: ArtistProfile[];
  detailName?: string;
  detailImage?: string;
  detailSubtitle?: string;
  detailBio?: string;
  detailFollowerCount?: number;
  detailVerified?: boolean;
  detailSongs?: Track[];
  searchedSongs?: Track[];
  remoteAlbums?: ArtistAlbumSummary[];
  remoteRelatedArtists?: RelatedArtistSummary[];
  localHistoryTracks?: Track[];
}): ArtistPageData {
  const {
    target,
    seedArtist,
    seedTracks,
    seedAlbums,
    seedArtists,
    detailName,
    detailImage,
    detailSubtitle,
    detailBio,
    detailFollowerCount,
    detailVerified,
    detailSongs = [],
    searchedSongs = [],
    remoteAlbums = [],
    remoteRelatedArtists = [],
    localHistoryTracks = [],
  } = input;

  const artistName = (detailName || seedArtist?.name || target.name || 'Artist').trim();

  // Combine seed tracks + detail songs + searched songs + local user liked/played tracks by this artist
  const matchingSeedTracks = seedTracks.filter(
    (t) =>
      (seedArtist?.topTrackIds.includes(t.id)) ||
      doesTrackBelongToArtist(t, artistName)
  );
  const matchingLocalTracks = localHistoryTracks.filter((t) =>
    doesTrackBelongToArtist(t, artistName)
  );
  const matchingSearched = searchedSongs.filter((t) =>
    doesTrackBelongToArtist(t, artistName)
  );

  // Detail songs are already artist-scoped by provider, keep them + anything else belonging to artist
  const allSongsRaw = dedupeArtistTracks([
    ...detailSongs,
    ...matchingSeedTracks,
    ...matchingSearched,
    ...matchingLocalTracks,
  ]);

  const allSongs = sortArtistTracks(
    allSongsRaw,
    'popular',
    seedArtist?.topTrackIds || []
  );

  const popularTracks = allSongs.slice(0, 10);

  // Merge matching seed albums with remote albums
  const matchingSeedAlbums: ArtistAlbumSummary[] = seedAlbums
    .filter((alb) =>
      normalizeArtistNameKey(alb.artist).includes(normalizeArtistNameKey(artistName))
    )
    .map((alb) => ({
      id: alb.id,
      name: alb.name,
      artist: alb.artist,
      year: alb.year,
      image: alb.image,
      trackCount: alb.trackIds.length,
      type: (alb.trackIds.length >= 4 ? 'Album' : 'EP') as 'Album' | 'EP',
      tracks: alb.trackIds
        .map((tid) => seedTracks.find((t) => t.id === tid))
        .filter((t): t is Track => Boolean(t)),
    }));

  const { albums, latestRelease } = extractArtistAlbumsAndLatestRelease(
    allSongs,
    [...matchingSeedAlbums, ...remoteAlbums],
    artistName
  );

  const inferredLanguage =
    seedArtist?.language ||
    (target.language as MusicLanguage | undefined) ||
    (allSongs.find((t) => t.language && t.language !== 'Other')?.language as MusicLanguage | undefined);

  const rawGenreCandidate =
    seedArtist?.genre ||
    target.genre ||
    detailSubtitle ||
    allSongs.find((t) => Boolean(t.genre))?.genre ||
    '';
  const cleanedGenre = /^(?:artist(?:\s*·.*)?|\d[\d,.\s]*(?:k|m|b)?\s*(?:fans?|followers?|listeners?))$/i.test(
    rawGenreCandidate.trim()
  )
    ? ''
    : rawGenreCandidate.trim();
  const inferredGenre =
    cleanedGenre || (inferredLanguage ? `${inferredLanguage} · Artist` : 'Music Artist');

  const resolvedMonthlyListeners =
    seedArtist?.monthlyListeners ||
    target.monthlyListeners ||
    (detailFollowerCount && detailFollowerCount > 0
      ? `${detailFollowerCount >= 1_000_000
          ? `${(detailFollowerCount / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
          : detailFollowerCount >= 1_000
            ? `${Math.round(detailFollowerCount / 1_000)}K`
            : detailFollowerCount} followers`
      : detailSubtitle || `${allSongs.length} catalog tracks`);

  const artistImage =
    detailImage ||
    seedArtist?.image ||
    target.image ||
    allSongs.find((t) => Boolean(t.image))?.image ||
    '';

  const artistBio =
    detailBio ||
    seedArtist?.bio ||
    target.bio ||
    `${artistName} features ${allSongs.length > 0 ? `${allSongs.length} songs` : 'music'} across ${
      albums.length > 0 ? `${albums.length} releases` : 'multiple releases'
    } on MusicKK.`;

  const relatedArtists = buildRelatedArtists(
    artistName,
    inferredLanguage,
    inferredGenre,
    seedArtists,
    remoteRelatedArtists
  );

  return {
    artist: {
      id: seedArtist?.id || target.id || getCanonicalFollowedArtistId('', artistName),
      name: artistName,
      genre: inferredGenre,
      language: inferredLanguage,
      monthlyListeners: resolvedMonthlyListeners,
      image: artistImage,
      bannerImage: artistImage || latestRelease?.image || allSongs[0]?.image,
      bio: artistBio,
      topTrackIds: popularTracks.map((t) => t.id),
      followerCount: detailFollowerCount,
      isVerified: detailVerified ?? Boolean(seedArtist || (detailFollowerCount && detailFollowerCount > 5000)),
    },
    latestRelease,
    popularTracks,
    allSongs,
    albums,
    relatedArtists,
  };
}
