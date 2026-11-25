import {
  ArrowDown,
  BadgeCheck,
  Disc3,
  Heart,
  ListPlus,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Search,
  Shuffle,
  UserCheck,
  UserPlus,
  Video,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  ArtistAlbumSummary,
  ArtistPageData,
  ArtistTarget,
  FollowedArtist,
  MusicRegion,
  Track,
} from '../types/music';
import {
  dedupeArtistTracks,
  isArtistFollowed,
  sortArtistTracks,
  type ArtistSongSort,
} from '../utils/artistProfile';
import { loadArtistMoreSongs, loadArtistPageData } from '../utils/musicApi';
import { isCollectionFullyDownloaded } from '../utils/offlineStore';
import { formatPlayCount, formatTime, hasFullAudioStream } from '../utils/playerEngine';
import { CoverImage } from './CoverImage';
import { DownloadButton } from './DownloadButton';
import { TrackRow } from './TrackRow';

interface ArtistViewProps {
  target: ArtistTarget;
  region: MusicRegion;
  localHistoryTracks: Track[];
  followedArtists: Record<string, FollowedArtist>;
  currentTrackId?: string;
  isPlaying: boolean;
  likedMap: Record<string, Track>;
  downloadedIds: Set<string>;
  downloadingIds: Set<string>;
  onToggleFollow: (target: ArtistTarget) => void;
  onPlayList: (tracks: Track[], startIndex: number, shuffle?: boolean) => void;
  onToggleLike: (track: Track) => void;
  onToggleDownload: (track: Track) => void;
  onDownloadAll: (tracks: Track[]) => void;
  onEnqueue: (track: Track) => void;
  onAddToPlaylist: (track: Track) => void;
  onOpenVideo: (track: Track) => void;
  onOpenVideoQuery: (query: string) => void;
  onOpenAlbum: (album: ArtistAlbumSummary) => void;
  onSelectArtist: (target: ArtistTarget) => void;
}

type DiscographyFilter = 'all' | 'albums' | 'singles';

const SORT_OPTIONS: Array<{ id: ArtistSongSort; label: string }> = [
  { id: 'popular', label: 'Popular' },
  { id: 'newest', label: 'Newest' },
  { id: 'title', label: 'Title' },
  { id: 'duration', label: 'Duration' },
];

export function ArtistView({
  target,
  region,
  localHistoryTracks,
  followedArtists,
  currentTrackId,
  isPlaying,
  likedMap,
  downloadedIds,
  downloadingIds,
  onToggleFollow,
  onPlayList,
  onToggleLike,
  onToggleDownload,
  onDownloadAll,
  onEnqueue,
  onAddToPlaylist,
  onOpenVideo,
  onOpenVideoQuery,
  onOpenAlbum,
  onSelectArtist,
}: ArtistViewProps) {
  const [pageData, setPageData] = useState<(ArtistPageData & { resolvedRemoteId?: string }) | null>(
    null
  );
  const [extraSongs, setExtraSongs] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadNonce, setReloadNonce] = useState(0);

  const [showAllPopular, setShowAllPopular] = useState(false);
  const [discogFilter, setDiscogFilter] = useState<DiscographyFilter>('all');
  const [songQuery, setSongQuery] = useState('');
  const [songSort, setSongSort] = useState<ArtistSongSort>('popular');
  const [songPage, setSongPage] = useState(0);
  const [canLoadMore, setCanLoadMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreNote, setLoadMoreNote] = useState('');
  const [bioExpanded, setBioExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setExtraSongs([]);
    setShowAllPopular(false);
    setDiscogFilter('all');
    setSongQuery('');
    setSongSort('popular');
    setSongPage(0);
    setCanLoadMore(true);
    setLoadMoreNote('');
    setBioExpanded(false);

    loadArtistPageData(target, { region, localHistoryTracks })
      .then((data) => {
        if (cancelled) return;
        setPageData(data);
        setCanLoadMore(data.allSongs.length > 0);
      })
      .catch(() => {
        if (!cancelled) {
          setError('Could not load this artist right now. Check your connection and try again.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [target.id, target.name, region, reloadNonce]);

  const artist = pageData?.artist;
  const artistName = artist?.name || target.name;
  const artistImage = artist?.image || target.image || '';
  const followed = isArtistFollowed(
    followedArtists,
    artist?.id || target.id,
    artistName
  );

  const combinedSongs = useMemo(() => {
    const base = pageData?.allSongs || [];
    if (!extraSongs.length) return base;
    return dedupeArtistTracks([...base, ...extraSongs]);
  }, [pageData?.allSongs, extraSongs]);

  const popularTracks = useMemo(() => {
    if (!pageData) return [];
    const base = pageData.popularTracks.length ? pageData.popularTracks : combinedSongs.slice(0, 10);
    return showAllPopular ? base.slice(0, 10) : base.slice(0, 5);
  }, [pageData, combinedSongs, showAllPopular]);

  const filteredAlbums = useMemo(() => {
    const list = pageData?.albums || [];
    if (discogFilter === 'albums') {
      return list.filter((a) => a.type === 'Album');
    }
    if (discogFilter === 'singles') {
      return list.filter((a) => a.type === 'Single' || a.type === 'EP');
    }
    return list;
  }, [pageData?.albums, discogFilter]);

  const visibleAllSongs = useMemo(() => {
    const q = songQuery.trim().toLowerCase();
    const filtered = q
      ? combinedSongs.filter(
          (t) =>
            t.name.toLowerCase().includes(q) ||
            t.artist.toLowerCase().includes(q) ||
            t.albumName.toLowerCase().includes(q) ||
            (t.year || '').includes(q)
        )
      : combinedSongs;
    return sortArtistTracks(filtered, songSort, artist?.topTrackIds || []);
  }, [combinedSongs, songQuery, songSort, artist?.topTrackIds]);

  const topPlayableList = useMemo(
    () => (pageData?.popularTracks.length ? pageData.popularTracks : visibleAllSongs),
    [pageData?.popularTracks, visibleAllSongs]
  );

  const allDownloaded = isCollectionFullyDownloaded(topPlayableList, downloadedIds);
  const hasDownloadable = topPlayableList.some(
    (t) => t.offlineAvailable !== false && t.sourceProvider !== 'Jamendo'
  );
  const anyDownloading = topPlayableList.some((t) => downloadingIds.has(t.id));

  const handleLoadMoreSongs = async () => {
    if (loadingMore || !canLoadMore) return;
    const nextPage = songPage + 1;
    setLoadingMore(true);
    setLoadMoreNote('');
    try {
      const res = await loadArtistMoreSongs(
        artistName,
        pageData?.resolvedRemoteId || artist?.id || target.id,
        nextPage,
        region
      );
      const existingIds = new Set(combinedSongs.map((t) => t.id));
      const fresh = res.tracks.filter((t) => t?.id && !existingIds.has(t.id));
      if (fresh.length > 0) {
        setExtraSongs((prev) => dedupeArtistTracks([...prev, ...fresh]));
        setSongPage(nextPage);
        setCanLoadMore(res.hasMore);
      } else {
        setCanLoadMore(false);
        setLoadMoreNote('All available catalogue songs for this artist are loaded.');
      }
    } catch {
      setLoadMoreNote('Could not load additional songs right now.');
    } finally {
      setLoadingMore(false);
    }
  };

  const handleFollowToggle = () => {
    onToggleFollow({
      id: artist?.id || target.id,
      name: artistName,
      image: artistImage,
      genre: artist?.genre || target.genre,
      language: artist?.language || target.language,
      monthlyListeners: artist?.monthlyListeners || target.monthlyListeners,
      bio: artist?.bio || target.bio,
    });
  };

  if (loading) {
    return (
      <section aria-busy="true" aria-label={`Loading ${target.name}`} className="space-y-6 pb-10">
        <div className="flex flex-col gap-5 rounded-2xl bg-[#161918] p-6 sm:flex-row sm:items-end">
          <div className="h-36 w-36 shrink-0 animate-pulse rounded-full bg-white/[0.07] sm:h-44 sm:w-44" />
          <div className="flex-1 space-y-3">
            <div className="h-4 w-28 animate-pulse rounded bg-white/[0.06]" />
            <div className="h-10 w-64 max-w-full animate-pulse rounded bg-white/[0.08]" />
            <div className="h-4 w-48 max-w-full animate-pulse rounded bg-white/[0.06]" />
          </div>
        </div>
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-white/[0.04]" />
          ))}
        </div>
      </section>
    );
  }

  if (error && !pageData) {
    return (
      <section className="rounded-2xl border border-white/10 bg-[#16181a] p-8 text-center">
        <h1 className="text-xl font-bold text-white">{target.name}</h1>
        <p className="mt-2 text-sm text-zinc-400">{error}</p>
        <button
          type="button"
          onClick={() => setReloadNonce((n) => n + 1)}
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-[#1DB954] px-5 text-sm font-bold text-black hover:bg-[#32d46a]"
        >
          <RefreshCw className="h-4 w-4" />
          Try again
        </button>
      </section>
    );
  }

  const metaSegments = [
    artist?.monthlyListeners,
    artist?.genre && artist.genre !== `${artist.language} · Artist` ? artist.genre : '',
    `${combinedSongs.length} ${combinedSongs.length === 1 ? 'song' : 'songs'}`,
    pageData?.albums.length ? `${pageData.albums.length} releases` : '',
  ].filter(Boolean);

  return (
    <section
      aria-label={`${artistName} artist page`}
      className="@container mx-auto w-full max-w-[1440px] space-y-8 pb-12"
    >
      {/* Artist Hero */}
      <header className="relative isolate overflow-hidden rounded-2xl border border-white/[0.07] bg-gradient-to-b from-[#1e2c23] via-[#151917] to-[#121212] p-5 sm:p-7">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_25%_0%,rgba(29,185,84,0.22),transparent_55%)]"
        />
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
          <div className="h-36 w-36 shrink-0 overflow-hidden rounded-full border border-white/10 bg-black shadow-2xl sm:h-44 sm:w-44">
            <CoverImage
              src={artistImage}
              alt={artistName}
              className="h-full w-full object-cover"
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.12em] text-zinc-300">
              {artist?.isVerified ? (
                <>
                  <BadgeCheck className="h-4 w-4 text-[#62f58a]" aria-hidden="true" />
                  <span>Verified Artist</span>
                </>
              ) : (
                <span>Artist</span>
              )}
              {artist?.language && (
                <span className="text-zinc-400">· {artist.language}</span>
              )}
            </div>

            <h1 className="mt-1.5 break-words text-3xl font-black tracking-tight text-white sm:text-5xl">
              {artistName}
            </h1>

            <p className="mt-2 font-mono-num text-xs text-zinc-300 sm:text-sm">
              {metaSegments.join(' · ')}
            </p>
          </div>
        </div>

        {/* Action Toolbar */}
        <div className="mt-6 flex flex-wrap items-center gap-2.5">
          {topPlayableList.length > 0 && (
            <button
              type="button"
              onClick={() => onPlayList(topPlayableList, 0, false)}
              aria-label={`Play top songs by ${artistName}`}
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#1DB954] px-5 text-sm font-extrabold text-black shadow-lg transition hover:scale-[1.02] hover:bg-[#32d46a] active:scale-[0.98]"
            >
              <Play className="h-4 w-4 fill-current" />
              Play
            </button>
          )}

          <button
            type="button"
            onClick={handleFollowToggle}
            aria-pressed={followed}
            className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-bold transition ${
              followed
                ? 'border-[#1DB954] bg-[#1DB954]/15 text-[#8ff9af] hover:bg-[#1DB954]/25'
                : 'border-white/20 bg-white/[0.04] text-white hover:border-white hover:bg-white/10'
            }`}
          >
            {followed ? (
              <>
                <UserCheck className="h-4 w-4" />
                Following
              </>
            ) : (
              <>
                <UserPlus className="h-4 w-4" />
                Follow
              </>
            )}
          </button>

          {topPlayableList.length > 1 && (
            <button
              type="button"
              onClick={() => onPlayList(topPlayableList, 0, true)}
              aria-label={`Shuffle play ${artistName}`}
              title="Shuffle"
              className="grid h-11 w-11 place-items-center rounded-full border border-white/15 text-zinc-200 transition hover:border-white hover:text-white"
            >
              <Shuffle className="h-4 w-4" />
            </button>
          )}

          {topPlayableList.length > 0 && (
            <button
              type="button"
              onClick={() => onDownloadAll(topPlayableList)}
              disabled={anyDownloading || !hasDownloadable}
              aria-pressed={allDownloaded}
              aria-label={
                !hasDownloadable
                  ? `Offline download is unavailable for ${artistName}`
                  : anyDownloading
                    ? `Downloading top tracks by ${artistName}`
                    : allDownloaded
                      ? `Remove downloaded songs by ${artistName}`
                      : `Download popular songs by ${artistName}`
              }
              title={
                !hasDownloadable
                  ? 'Streaming catalogue only'
                  : allDownloaded
                    ? 'Downloaded — click to remove'
                    : 'Download top songs offline'
              }
              className={`grid h-11 w-11 place-items-center rounded-full border transition disabled:cursor-not-allowed disabled:opacity-45 ${
                allDownloaded
                  ? 'border-[#1DB954] bg-[#1DB954] text-black'
                  : 'border-white/15 text-zinc-200 hover:border-white hover:text-white'
              }`}
            >
              {anyDownloading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowDown className="h-4 w-4 stroke-[2.25]" />
              )}
            </button>
          )}

          <button
            type="button"
            onClick={() => onOpenVideoQuery(`${artistName} official music video`)}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/15 bg-white/[0.03] px-4 text-xs font-bold text-zinc-200 transition hover:border-white hover:text-white"
          >
            <Video className="h-4 w-4" />
            Music Videos
          </button>
        </div>
      </header>

      {/* Popular + Latest Release + About Overview */}
      <div className="grid grid-cols-1 gap-6 @[960px]:grid-cols-12">
        {/* Popular Songs */}
        <section aria-labelledby="artist-popular-heading" className="min-w-0 @[960px]:col-span-7">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 id="artist-popular-heading" className="text-xl font-extrabold tracking-tight text-white">
              Popular
            </h2>
            {(pageData?.popularTracks.length || 0) > 5 && (
              <button
                type="button"
                onClick={() => setShowAllPopular((v) => !v)}
                className="text-xs font-bold uppercase tracking-wider text-zinc-400 hover:text-white"
              >
                {showAllPopular ? 'Show less' : 'See more'}
              </button>
            )}
          </div>

          {popularTracks.length === 0 ? (
            <div className="rounded-xl border border-white/[0.06] bg-[#161619] p-5 text-sm text-zinc-400">
              No popular tracks returned for {artistName} right now. Try searching songs directly.
            </div>
          ) : (
            <div className="space-y-1 rounded-xl border border-white/[0.06] bg-[#131514] p-2">
              {popularTracks.map((track, idx) => {
                const isCurrent = track.id === currentTrackId;
                const isLiked = Boolean(likedMap[track.id]);
                const isDownloaded = downloadedIds.has(track.id);
                const isDownloading = downloadingIds.has(track.id);
                const plays = formatPlayCount(track.playCount);
                return (
                  <div
                    key={`popular-${artist?.id || target.id}-${track.id}-${idx}`}
                    data-testid="artist-popular-row"
                    className={`group flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-xl px-2 py-2 transition sm:flex-nowrap sm:rounded-lg ${
                      isCurrent ? 'bg-[#1DB954]/10' : 'hover:bg-white/[0.05]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onPlayList(popularTracks, idx)}
                      aria-label={`Play popular track #${idx + 1} ${track.name}`}
                      className="w-5 shrink-0 text-center font-mono-num text-xs font-semibold text-zinc-400 group-hover:text-white"
                    >
                      {isCurrent && isPlaying ? (
                        <span className="text-[#1DB954]">♫</span>
                      ) : (
                        idx + 1
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => onPlayList(popularTracks, idx)}
                      className="flex min-w-[140px] flex-1 items-center gap-3 text-left"
                    >
                      <CoverImage
                        src={track.image}
                        alt={track.name}
                        className="h-11 w-11 shrink-0 rounded object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <div
                          className={`truncate text-sm font-bold ${
                            isCurrent ? 'text-[#62f58a]' : 'text-white'
                          }`}
                        >
                          {track.name}
                        </div>
                        <div className="truncate font-mono-num text-xs text-zinc-400">
                          {[
                            track.albumName || 'Single',
                            plays ? `${plays} plays` : '',
                            track.sourceAvailability === 'preview' && !hasFullAudioStream(track)
                              ? 'Preview'
                              : '',
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </div>
                    </button>

                    <div className="flex w-full shrink-0 items-center justify-end gap-0.5 border-t border-white/[0.045] pt-1.5 sm:w-auto sm:border-0 sm:pt-0">
                      <DownloadButton
                        trackName={track.name}
                        downloaded={isDownloaded}
                        downloading={isDownloading}
                        onClick={() => onToggleDownload(track)}
                        disabled={track.offlineAvailable === false}
                        disabledReason="Online streaming only"
                        size="xs"
                      />
                      <button
                        type="button"
                        onClick={() => onToggleLike(track)}
                        aria-label={isLiked ? `Unlike ${track.name}` : `Like ${track.name}`}
                        className={`grid h-8 w-8 place-items-center rounded-full transition hover:bg-white/10 ${
                          isLiked ? 'text-[#1DB954]' : 'text-zinc-400 hover:text-white'
                        }`}
                      >
                        <Heart className={`h-4 w-4 ${isLiked ? 'fill-current' : ''}`} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onEnqueue(track)}
                        aria-label={`Add ${track.name} to queue`}
                        title="Add to queue"
                        className="grid h-8 w-8 place-items-center rounded-full text-zinc-400 transition hover:bg-white/10 hover:text-white"
                      >
                        <ListPlus className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onAddToPlaylist(track)}
                        aria-label={`Add ${track.name} to playlist`}
                        title="Add to playlist"
                        className="grid h-8 w-8 place-items-center rounded-full text-zinc-400 transition hover:bg-white/10 hover:text-white"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenVideo(track)}
                        aria-label={`Watch video for ${track.name}`}
                        title="Watch video"
                        className="hidden h-8 w-8 place-items-center rounded-full text-zinc-400 transition hover:bg-white/10 hover:text-white md:grid"
                      >
                        <Video className="h-4 w-4" />
                      </button>
                      <span className="ml-1 w-10 text-right font-mono-num text-xs text-zinc-400">
                        {track.duration > 0 ? formatTime(track.duration) : '—'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Latest Release + About */}
        <aside className="grid min-w-0 grid-cols-1 gap-5 @[640px]:grid-cols-2 @[960px]:col-span-5 @[960px]:grid-cols-1 @[960px]:content-start">
          {pageData?.latestRelease && (
            <section aria-labelledby="artist-latest-release" className="min-w-0">
              <h2 id="artist-latest-release" className="mb-3 text-xl font-extrabold tracking-tight text-white">
                Latest Release
              </h2>
              <div className="flex items-center gap-4 rounded-xl border border-white/[0.08] bg-[#161a17] p-4">
                <button
                  type="button"
                  onClick={() => onOpenAlbum(pageData.latestRelease!)}
                  aria-label={`Open latest release ${pageData.latestRelease.name}`}
                  className="group relative h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-black shadow-lg"
                >
                  <CoverImage
                    src={pageData.latestRelease.image || artistImage}
                    alt={pageData.latestRelease.name}
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                  />
                  <span className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition group-hover:opacity-100">
                    <Play className="h-6 w-6 fill-white text-white" />
                  </span>
                </button>

                <div className="min-w-0 flex-1">
                  <div className="font-mono-num text-[11px] font-bold uppercase tracking-wider text-[#7cf7a3]">
                    {[pageData.latestRelease.year, pageData.latestRelease.type]
                      .filter(Boolean)
                      .join(' · ') || 'New Release'}
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenAlbum(pageData.latestRelease!)}
                    className="mt-1 block max-w-full truncate text-left text-base font-extrabold text-white hover:underline"
                  >
                    {pageData.latestRelease.name}
                  </button>
                  <div className="mt-0.5 truncate text-xs text-zinc-400">
                    {pageData.latestRelease.trackCount
                      ? `${pageData.latestRelease.trackCount} ${
                          pageData.latestRelease.trackCount === 1 ? 'track' : 'tracks'
                        }`
                      : pageData.latestRelease.artist}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {pageData.latestRelease.tracks.length > 0 && (
                      <button
                        type="button"
                        onClick={() => onPlayList(pageData.latestRelease!.tracks, 0)}
                        className="inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full bg-[#1DB954] px-3.5 text-xs font-extrabold text-black hover:bg-[#32d46a]"
                      >
                        <Play className="h-3.5 w-3.5 shrink-0 fill-current" />
                        Play
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onOpenAlbum(pageData.latestRelease!)}
                      className="inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full border border-white/15 bg-white/[0.04] px-3.5 text-xs font-bold text-zinc-200 hover:border-white hover:text-white"
                    >
                      <Disc3 className="h-3.5 w-3.5 shrink-0" />
                      Open release
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )}

          {artist?.bio && (
            <section aria-labelledby="artist-about-heading" className="rounded-xl border border-white/[0.07] bg-[#141615] p-4">
              <h2 id="artist-about-heading" className="text-sm font-extrabold uppercase tracking-wider text-zinc-300">
                About {artistName}
              </h2>
              <p className={`mt-2 text-sm leading-relaxed text-zinc-300 ${bioExpanded ? '' : 'line-clamp-4'}`}>
                {artist.bio}
              </p>
              {artist.bio.length > 160 && (
                <button
                  type="button"
                  onClick={() => setBioExpanded((v) => !v)}
                  className="mt-2 text-xs font-bold text-[#7cf7a3] hover:underline"
                >
                  {bioExpanded ? 'Show less' : 'Read full bio'}
                </button>
              )}
            </section>
          )}
        </aside>
      </div>

      {/* Discography */}
      {(pageData?.albums.length || 0) > 0 && (
        <section aria-labelledby="artist-discography-heading" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="artist-discography-heading" className="text-xl font-extrabold tracking-tight text-white">
                Discography
              </h2>
              <p className="mt-0.5 text-xs text-zinc-400">
                Albums, EPs and singles by {artistName}
              </p>
            </div>

            <div className="flex gap-1.5" role="tablist" aria-label="Filter discography">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'albums', label: 'Albums' },
                  { id: 'singles', label: 'Singles & EPs' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={discogFilter === tab.id}
                  onClick={() => setDiscogFilter(tab.id)}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
                    discogFilter === tab.id
                      ? 'bg-white text-black'
                      : 'bg-[#202024] text-zinc-300 hover:bg-[#2b2b30] hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {filteredAlbums.length === 0 ? (
            <div className="rounded-xl bg-[#161619] p-5 text-sm text-zinc-400">
              No releases match this filter yet.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
              {filteredAlbums.slice(0, 12).map((album, idx) => (
                <button
                  key={`${album.id}-${idx}`}
                  type="button"
                  onClick={() => onOpenAlbum(album)}
                  className="group rounded-xl bg-[#161619] p-3 text-left transition hover:bg-[#222227]"
                >
                  <div className="relative aspect-square overflow-hidden rounded-lg bg-black shadow-md">
                    <CoverImage
                      src={album.image || artistImage}
                      alt={album.name}
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    />
                    <span className="absolute bottom-2 right-2 grid h-9 w-9 place-items-center rounded-full bg-[#1DB954] text-black opacity-0 shadow-lg transition group-hover:opacity-100">
                      <Play className="h-4 w-4 fill-current pl-0.5" />
                    </span>
                  </div>
                  <div className="mt-2.5 truncate text-sm font-bold text-white">{album.name}</div>
                  <div className="truncate font-mono-num text-xs text-zinc-400">
                    {[album.year, album.type].filter(Boolean).join(' · ') || 'Release'}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {/* All Songs Catalog with Filter, Sort & Load More */}
      <section aria-labelledby="artist-all-songs-heading" className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="artist-all-songs-heading" className="text-xl font-extrabold tracking-tight text-white">
              All Songs
            </h2>
            <p className="mt-0.5 font-mono-num text-xs text-zinc-400">
              Showing {visibleAllSongs.length} {visibleAllSongs.length === 1 ? 'track' : 'tracks'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex min-h-10 items-center gap-2 rounded-full border border-white/[0.08] bg-[#18181b] px-3.5 focus-within:border-[#1DB954]/60">
              <Search className="h-3.5 w-3.5 text-zinc-400" />
              <input
                type="search"
                value={songQuery}
                onChange={(e) => setSongQuery(e.target.value)}
                placeholder="Filter songs..."
                aria-label={`Filter songs by ${artistName}`}
                className="w-36 bg-transparent text-xs text-white placeholder-zinc-500 focus:outline-none sm:w-44"
              />
            </label>

            <div className="flex flex-wrap gap-1" role="tablist" aria-label="Sort artist songs">
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="tab"
                  aria-selected={songSort === opt.id}
                  onClick={() => setSongSort(opt.id)}
                  className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                    songSort === opt.id
                      ? 'bg-white text-black'
                      : 'bg-[#1c1c20] text-zinc-300 hover:bg-[#26262c] hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {visibleAllSongs.length === 0 ? (
          <div className="rounded-xl bg-[#161619] p-5 text-sm text-zinc-400">
            {songQuery
              ? `No songs matching "${songQuery}".`
              : `No additional catalogue tracks available for ${artistName}.`}
          </div>
        ) : (
          <div className="space-y-1">
            {visibleAllSongs.map((track, idx) => (
              <TrackRow
                key={`all-${artist?.id || target.id}-${track.id}-${idx}`}
                track={track}
                index={idx}
                isCurrent={track.id === currentTrackId}
                isPlaying={isPlaying}
                isLiked={Boolean(likedMap[track.id])}
                isDownloaded={downloadedIds.has(track.id)}
                isDownloading={downloadingIds.has(track.id)}
                onPlay={() => onPlayList(visibleAllSongs, idx)}
                onEnqueue={() => onEnqueue(track)}
                onToggleLike={() => onToggleLike(track)}
                onToggleDownload={() => onToggleDownload(track)}
                onAddToPlaylist={() => onAddToPlaylist(track)}
                onOpenVideo={() =>
                  onOpenVideoQuery(`${track.name} ${track.artist} official music video`)
                }
                onOpenArtistName={(name) =>
                  onSelectArtist({
                    id: '',
                    name,
                    image: '',
                  })
                }
              />
            ))}
          </div>
        )}

        {(canLoadMore || loadMoreNote) && (
          <div className="flex flex-col items-center gap-2 pt-2">
            {canLoadMore && (
              <button
                type="button"
                onClick={() => void handleLoadMoreSongs()}
                disabled={loadingMore}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/15 bg-[#202024] px-6 text-xs font-bold text-white transition hover:bg-[#2a2a30] disabled:cursor-wait disabled:opacity-60"
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading more songs…
                  </>
                ) : (
                  'Load more songs'
                )}
              </button>
            )}
            {loadMoreNote && (
              <p className="text-xs text-zinc-400" role="status">
                {loadMoreNote}
              </p>
            )}
          </div>
        )}
      </section>

      {/* Fans Also Like */}
      {(pageData?.relatedArtists.length || 0) > 0 && (
        <section aria-labelledby="artist-related-heading" className="space-y-4">
          <h2 id="artist-related-heading" className="text-xl font-extrabold tracking-tight text-white">
            Fans Also Like
          </h2>
          <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
            {pageData!.relatedArtists.map((rel, idx) => (
              <button
                key={`rel-${rel.id}-${idx}`}
                type="button"
                onClick={() =>
                  onSelectArtist({
                    id: rel.id,
                    name: rel.name,
                    image: rel.image,
                    genre: rel.genre,
                    language: rel.language,
                  })
                }
                className="group rounded-xl bg-[#161619] p-3.5 text-left transition hover:bg-[#222227]"
              >
                <div className="aspect-square overflow-hidden rounded-full bg-black shadow-md">
                  <CoverImage
                    src={rel.image || artistImage}
                    alt={rel.name}
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                  />
                </div>
                <div className="mt-3 truncate text-sm font-bold text-white">{rel.name}</div>
                <div className="truncate text-xs text-zinc-400">{rel.subtitle || 'Artist'}</div>
              </button>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
