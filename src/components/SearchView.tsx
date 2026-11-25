import { ArrowLeft, Play, Search as SearchIcon, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { QUICK_SEARCH_CHIPS } from '../data/catalog';
import type { MusicLanguage, MusicRegion, SearchTab, Track, VideoResult } from '../types/music';
import {
  loadCollectionTracks,
  searchAlbums,
  searchArtists,
  searchPlaylists,
  searchSongs,
  searchVideos,
} from '../utils/musicApi';
import { CoverImage } from './CoverImage';
import { TrackRow } from './TrackRow';

interface SearchViewProps {
  query: string;
  onQueryChange: (q: string) => void;
  activeTab: SearchTab;
  onTabChange: (tab: SearchTab) => void;
  region: MusicRegion;
  languageFilter: MusicLanguage | 'All';
  onLanguageFilterChange: (lang: MusicLanguage | 'All') => void;
  drillCollection: { kind: 'albums' | 'playlists' | 'artists'; id: string } | null;
  onClearDrill: () => void;
  onOpenDrill: (kind: 'albums' | 'playlists' | 'artists', id: string) => void;
  currentTrackId?: string;
  isPlaying: boolean;
  likedIds: Record<string, Track>;
  downloadedIds: Set<string>;
  downloadingIds: Set<string>;
  onPlayList: (tracks: Track[], startIndex: number) => void;
  onEnqueue: (track: Track) => void;
  onToggleLike: (track: Track) => void;
  onToggleDownload: (track: Track) => void;
  onAddToPlaylist: (track: Track) => void;
  onOpenVideoQuery: (query: string) => void;
  onOpenVideoModal: (videos: VideoResult[], selectedId: string) => void;
}

const TABS: Array<{ id: SearchTab; label: string }> = [
  { id: 'songs', label: 'Songs' },
  { id: 'albums', label: 'Albums' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'artists', label: 'Artists' },
  { id: 'videos', label: 'Videos' },
];

export function SearchView({
  query,
  onQueryChange,
  activeTab,
  onTabChange,
  region,
  languageFilter,
  onLanguageFilterChange,
  drillCollection,
  onClearDrill,
  onOpenDrill,
  currentTrackId,
  isPlaying,
  likedIds,
  downloadedIds,
  downloadingIds,
  onPlayList,
  onEnqueue,
  onToggleLike,
  onToggleDownload,
  onAddToPlaylist,
  onOpenVideoQuery,
  onOpenVideoModal,
}: SearchViewProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const seqRef = useRef(0);

  const [prioritizeLyrics, setPrioritizeLyrics] = useState(true);
  const [includeCatalogue, setIncludeCatalogue] = useState(false);
  const [songPage, setSongPage] = useState(0);
  const [canLoadMoreSongs, setCanLoadMoreSongs] = useState(false);
  const [loadingMoreSongs, setLoadingMoreSongs] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState('');
  const [loading, setLoading] = useState(false);
  const [songs, setSongs] = useState<Track[]>([]);
  const [albums, setAlbums] = useState<
    Array<{ id: string; name: string; subtitle: string; image: string }>
  >([]);
  const [playlists, setPlaylists] = useState<
    Array<{ id: string; name: string; subtitle: string; image: string }>
  >([]);
  const [artists, setArtists] = useState<
    Array<{ id: string; name: string; subtitle: string; image: string }>
  >([]);
  const [videos, setVideos] = useState<VideoResult[]>([]);
  const [drillMeta, setDrillMeta] = useState<{ title: string; subtitle: string } | null>(null);
  const [searchError, setSearchError] = useState('');

  useEffect(() => {
    const seq = ++seqRef.current;
    const rawQuery = query.trim();
    if (!drillCollection && activeTab === 'videos' && !rawQuery) {
      setVideos([]);
      setSearchError('');
      setLoading(false);
      return;
    }

    const timer = window.setTimeout(async () => {
      setLoading(true);
      setSearchError('');
      try {
        if (drillCollection) {
          const detail = await loadCollectionTracks(drillCollection.kind, drillCollection.id);
          if (seq !== seqRef.current) return;
          setDrillMeta({ title: detail.title, subtitle: detail.subtitle });
          setSongs(detail.tracks);
        } else {
          setDrillMeta(null);
          if (activeTab === 'songs') {
            const res = await searchSongs(rawQuery, {
              region,
              prioritizeLyrics,
              languageFilter,
              includeCatalogue,
              page: 0,
            });
            if (seq !== seqRef.current) return;
            setSongs(res.tracks);
            setSongPage(0);
            setCanLoadMoreSongs(Boolean(rawQuery) && res.tracks.length > 0);
            setLoadingMoreSongs(false);
            setLoadMoreError('');
          } else if (activeTab === 'albums') {
            const res = await searchAlbums(rawQuery);
            if (seq !== seqRef.current) return;
            setAlbums(res.albums);
          } else if (activeTab === 'playlists') {
            const res = await searchPlaylists(rawQuery);
            if (seq !== seqRef.current) return;
            setPlaylists(res.playlists);
          } else if (activeTab === 'artists') {
            const res = await searchArtists(rawQuery);
            if (seq !== seqRef.current) return;
            setArtists(res.artists);
          } else if (activeTab === 'videos') {
            const res = await searchVideos(rawQuery);
            if (seq !== seqRef.current) return;
            setVideos(res);
          }
        }
      } catch {
        if (seq === seqRef.current) {
          setSearchError('Search is temporarily unavailable. Check your connection and try again.');
          setSongs([]);
          setAlbums([]);
          setPlaylists([]);
          setArtists([]);
          setVideos([]);
          setDrillMeta(null);
          setCanLoadMoreSongs(false);
          setLoadMoreError('');
        }
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    }, 180);

    return () => window.clearTimeout(timer);
  }, [query, activeTab, drillCollection, region, prioritizeLyrics, languageFilter, includeCatalogue]);

  const handleLoadMoreSongs = async () => {
    const rawQuery = query.trim();
    if (!rawQuery || loadingMoreSongs || !canLoadMoreSongs || drillCollection) return;
    const requestSeq = seqRef.current;
    const nextPage = songPage + 1;
    setLoadingMoreSongs(true);
    setLoadMoreError('');
    try {
      const result = await searchSongs(rawQuery, {
        region,
        prioritizeLyrics,
        languageFilter,
        includeCatalogue,
        page: nextPage,
      });
      if (requestSeq !== seqRef.current) return;

      const existingIds = new Set(songs.map((track) => track.id));
      const existingKeys = new Set(
        songs.map((track) =>
          track.name.toLowerCase().trim() + '::' + track.artist.toLowerCase().trim()
        )
      );
      const newTracks = result.tracks.filter((track) => {
        if (!track?.id || existingIds.has(track.id)) return false;
        const key = track.name.toLowerCase().trim() + '::' + track.artist.toLowerCase().trim();
        if (existingKeys.has(key)) return false;
        existingIds.add(track.id);
        existingKeys.add(key);
        return true;
      });
      setSongs((previous) => [...previous, ...newTracks]);
      setSongPage(nextPage);
      setCanLoadMoreSongs(newTracks.length > 0);
      if (newTracks.length === 0) setLoadMoreError('There are no additional matches for this search.');
    } catch {
      if (requestSeq === seqRef.current) {
        setCanLoadMoreSongs(false);
        setLoadMoreError('Could not load more results. Try the search again.');
      }
    } finally {
      if (requestSeq === seqRef.current) setLoadingMoreSongs(false);
    }
  };

  return (
    <section aria-label="Search music and videos" className="space-y-4 pb-8">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onClearDrill();
        }}
        className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-[#202024] px-4 py-2.5 focus-within:border-white/30"
      >
        <SearchIcon className="h-4 w-4 shrink-0 text-zinc-400" />
        <label htmlFor="harmonia-search-input" className="sr-only">
          Search songs, artists, albums, or videos
        </label>
        <input
          id="harmonia-search-input"
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            onClearDrill();
            onQueryChange(e.target.value);
          }}
          placeholder="Search Hindi, English, J-Pop songs, artists, or lyrics..."
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder-zinc-400 focus:outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              onClearDrill();
              onQueryChange('');
              inputRef.current?.focus();
            }}
            aria-label="Clear search query"
            className="rounded-full p-1 text-zinc-400 hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </form>

      {/* Tabs + Language & Lyrics-Priority controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Search categories">
          {TABS.map((tab) => {
            const active = !drillCollection && activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  onClearDrill();
                  onTabChange(tab.id);
                }}
                className={`rounded-full px-4 py-1.5 text-xs font-bold transition-colors ${
                  active
                    ? 'bg-white text-black'
                    : 'bg-[#202024] text-zinc-300 hover:bg-[#2a2a2f] hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(['All', 'Hindi', 'English', 'J-Pop'] as const).map((lang) => (
            <button
              key={lang}
              type="button"
              onClick={() => onLanguageFilterChange(lang)}
              className={`rounded-full px-3 py-1 text-[11px] font-bold transition-colors ${
                languageFilter === lang
                  ? 'bg-[#1DB954] text-black'
                  : 'bg-[#1c1c20] text-zinc-400 hover:text-white'
              }`}
            >
              {lang}
            </button>
          ))}

          <label className="ml-1 flex cursor-pointer items-center gap-1.5 rounded-full bg-[#1c1c20] px-3 py-1 text-[11px] font-semibold text-zinc-300">
            <input
              type="checkbox"
              checked={prioritizeLyrics}
              onChange={(e) => setPrioritizeLyrics(e.target.checked)}
              className="h-3.5 w-3.5 accent-[#1DB954]"
            />
            <span>Lyrics priority</span>
          </label>
          {activeTab === 'songs' && (
            <label
              title="Adds a broader metadata catalogue. Some entries may not have a playable stream."
              className="ml-1 flex cursor-pointer items-center gap-1.5 rounded-full bg-[#1c1c20] px-3 py-1 text-[11px] font-semibold text-zinc-300"
            >
              <input
                type="checkbox"
                checked={includeCatalogue}
                onChange={(event) => setIncludeCatalogue(event.target.checked)}
                className="h-3.5 w-3.5 accent-[#1DB954]"
              />
              <span>Wider catalogue</span>
            </label>
          )}
        </div>
      </div>

      {/* Quick Search Chips */}
      <div className="flex flex-wrap gap-2">
        {QUICK_SEARCH_CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => {
              onClearDrill();
              onQueryChange(chip);
            }}
            className="rounded-full bg-[#18181b] px-3 py-1 text-xs font-medium text-zinc-300 transition-colors hover:bg-[#242429] hover:text-white"
          >
            {chip}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-2.5">
          {drillCollection && (
            <button
              type="button"
              onClick={onClearDrill}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#202024] px-3 py-1 text-xs font-bold text-white hover:bg-[#2a2a2f]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>
          )}
          <div>
            <h2 className="text-lg font-bold text-white">
              {drillMeta
                ? drillMeta.title
                : TABS.find((t) => t.id === activeTab)?.label || 'Songs'}
            </h2>
            <p className="text-xs text-zinc-400">
              {drillMeta
                ? drillMeta.subtitle
                : query.trim()
                  ? `Results for "${query.trim()}"`
                  : 'Curated vocal tracks prioritized with lyrics'}
            </p>
          </div>
        </div>

        {(activeTab === 'songs' || drillCollection) && songs.length > 0 && !loading && (
          <button
            type="button"
            onClick={() => onPlayList(songs, 0)}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#1DB954] px-4 py-1.5 text-xs font-extrabold text-black hover:scale-105 transition-transform"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            Play all ({songs.length})
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading search results">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-md bg-white/[0.04]" />
          ))}
        </div>
      ) : searchError ? (
        <div role="alert" className="rounded-lg border border-amber-500/20 bg-amber-500/[0.06] p-4 text-sm text-amber-200">
          {searchError}
        </div>
      ) : activeTab === 'songs' || drillCollection ? (
        songs.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[#18181b] p-4 text-sm text-zinc-400">
            <span>No matching songs found. Try another keyword or switch language filter to All.</span>
            {query.trim() && !drillCollection && (
              <button
                type="button"
                onClick={() => onTabChange('videos')}
                className="rounded-full bg-[#242429] px-3.5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-[#303036]"
              >
                Search in Videos
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {songs.map((track, idx) => (
              <TrackRow
                key={track.id}
                track={track}
                index={idx}
                isCurrent={track.id === currentTrackId}
                isPlaying={isPlaying}
                isLiked={Boolean(likedIds[track.id])}
                isDownloaded={downloadedIds.has(track.id)}
                isDownloading={downloadingIds.has(track.id)}
                onPlay={() => onPlayList(songs, idx)}
                onEnqueue={() => onEnqueue(track)}
                onToggleLike={() => onToggleLike(track)}
                onToggleDownload={() => onToggleDownload(track)}
                onAddToPlaylist={() => onAddToPlaylist(track)}
                onOpenVideo={() =>
                  onOpenVideoQuery(`${track.name} ${track.artist} official music video`)
                }
              />
            ))}
            {!drillCollection && canLoadMoreSongs && (
              <div className="flex justify-center pt-4">
                <button
                  type="button"
                  onClick={() => void handleLoadMoreSongs()}
                  disabled={loadingMoreSongs}
                  className="rounded-full border border-white/15 bg-[#202024] px-5 py-2 text-xs font-bold text-zinc-200 hover:bg-[#2a2a2f] disabled:cursor-wait disabled:opacity-60"
                >
                  {loadingMoreSongs ? 'Loading more songs…' : 'Load more results'}
                </button>
              </div>
            )}
            {loadMoreError && (
              <p className="pt-2 text-center text-xs text-zinc-500" role="status">
                {loadMoreError}
              </p>
            )}
          </div>
        )
      ) : activeTab === 'albums' ? (
        albums.length === 0 ? (
          <div className="rounded-lg bg-[#18181b] p-4 text-sm text-zinc-400" role="status">
            No matching albums found. Try checking Songs or Videos for this query.
          </div>
        ) : (
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {albums.map((album) => (
            <button
              key={album.id}
              type="button"
              onClick={() => onOpenDrill('albums', album.id)}
              className="group rounded-lg bg-[#161619] p-3 text-left transition-colors hover:bg-[#222227]"
            >
              <div className="relative aspect-square overflow-hidden rounded-md bg-black">
                <CoverImage
                  src={album.image}
                  alt={album.name}
                  className="h-full w-full object-cover"
                />
                <span className="absolute bottom-2 right-2 grid h-9 w-9 place-items-center rounded-full bg-[#1DB954] text-black opacity-0 transition-opacity group-hover:opacity-100">
                  <Play className="h-4 w-4 fill-current pl-0.5" />
                </span>
              </div>
              <div className="mt-2.5 truncate text-sm font-bold text-white">{album.name}</div>
              <div className="truncate text-xs text-zinc-400">{album.subtitle}</div>
            </button>
          ))}
        </div>
        )
      ) : activeTab === 'playlists' ? (
        playlists.length === 0 ? (
          <div className="rounded-lg bg-[#18181b] p-4 text-sm text-zinc-400" role="status">
            No matching playlists found.
          </div>
        ) : (
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {playlists.map((pl) => (
            <button
              key={pl.id}
              type="button"
              onClick={() => onOpenDrill('playlists', pl.id)}
              className="group rounded-lg bg-[#161619] p-3 text-left transition-colors hover:bg-[#222227]"
            >
              <div className="relative aspect-square overflow-hidden rounded-md bg-black">
                <CoverImage
                  src={pl.image}
                  alt={pl.name}
                  className="h-full w-full object-cover"
                />
                <span className="absolute bottom-2 right-2 grid h-9 w-9 place-items-center rounded-full bg-[#1DB954] text-black opacity-0 transition-opacity group-hover:opacity-100">
                  <Play className="h-4 w-4 fill-current pl-0.5" />
                </span>
              </div>
              <div className="mt-2.5 truncate text-sm font-bold text-white">{pl.name}</div>
              <div className="truncate text-xs text-zinc-400">{pl.subtitle}</div>
            </button>
          ))}
        </div>
        )
      ) : activeTab === 'artists' ? (
        artists.length === 0 ? (
          <div className="rounded-lg bg-[#18181b] p-4 text-sm text-zinc-400" role="status">
            No matching artists found.
          </div>
        ) : (
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {artists.map((art) => (
            <button
              key={art.id}
              type="button"
              onClick={() => onOpenDrill('artists', art.id)}
              className="group rounded-lg bg-[#161619] p-3 text-left transition-colors hover:bg-[#222227]"
            >
              <div className="relative aspect-square overflow-hidden rounded-full bg-black">
                <CoverImage
                  src={art.image}
                  alt={art.name}
                  className="h-full w-full object-cover"
                />
                <span className="absolute bottom-2 right-2 grid h-9 w-9 place-items-center rounded-full bg-[#1DB954] text-black opacity-0 transition-opacity group-hover:opacity-100">
                  <Play className="h-4 w-4 fill-current pl-0.5" />
                </span>
              </div>
              <div className="mt-2.5 truncate text-sm font-bold text-white">{art.name}</div>
              <div className="truncate text-xs text-zinc-400">{art.subtitle}</div>
            </button>
          ))}
        </div>
        )
      ) : videos.length === 0 ? (
        <div className="rounded-lg bg-[#18181b] p-4 text-sm text-zinc-400" role="status">
          {query.trim()
            ? 'No videos found for this search. Try another title or artist.'
            : 'Search for a song, artist, or music video to see video results here.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 md:grid-cols-3">
          {videos.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => onOpenVideoModal(videos, v.id)}
              className="group rounded-lg bg-[#161619] p-3 text-left transition-colors hover:bg-[#222227]"
            >
              <div className="relative aspect-video overflow-hidden rounded-md bg-black">
                <CoverImage
                  src={v.thumbnail || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`}
                  alt={v.title}
                  className="h-full w-full object-cover"
                />
                <span className="absolute bottom-2 right-2 grid h-9 w-9 place-items-center rounded-full bg-[#1DB954] text-black shadow-lg">
                  <Play className="h-4 w-4 fill-current pl-0.5" />
                </span>
              </div>
              <div className="mt-2.5 line-clamp-2 text-sm font-bold text-white">{v.title}</div>
              <div className="truncate text-xs text-zinc-400">
                {v.channel}
                {v.dur ? ` · ${v.dur}` : ''}
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
