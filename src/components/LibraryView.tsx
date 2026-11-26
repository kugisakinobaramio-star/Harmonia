import { Clock3, Heart, ListMusic, Music2, Play, Plus, Search, Sparkles, Trash2, UserCheck, Video } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ArtistTarget, CuratedPlaylist, FollowedArtist, Track } from '../types/music';
import { extractPrimaryArtistName } from '../utils/artistProfile';
import { CoverImage } from './CoverImage';
import { DownloadButton } from './DownloadButton';

type LibraryFilter = 'all' | 'playlists' | 'imported' | 'artists' | 'liked' | 'recent';

interface LibraryViewProps {
  likedMap: Record<string, Track>;
  playlists: CuratedPlaylist[];
  recentlyPlayed: Track[];
  followedArtists?: FollowedArtist[];
  currentTrackId?: string;
  isPlaying: boolean;
  downloadedIds: Set<string>;
  downloadingIds: Set<string>;
  onPlayList: (tracks: Track[], startIndex: number) => void;
  onOpenPlaylist: (pl: CuratedPlaylist) => void;
  onEnqueue: (track: Track) => void;
  onToggleLike: (track: Track) => void;
  onToggleDownload: (track: Track) => void;
  onAddToPlaylist: (track: Track) => void;
  onOpenCreatePlaylist: () => void;
  onDeletePlaylist: (playlistId: string) => void;
  onOpenVideoQuery: (query: string) => void;
  onOpenArtist?: (artist: ArtistTarget) => void;
  onToggleFollowArtist?: (artist: ArtistTarget) => void;
}

const filters: { id: LibraryFilter; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'artists', label: 'Following' },
  { id: 'imported', label: 'Imported' },
  { id: 'liked', label: 'Liked songs' },
  { id: 'recent', label: 'Recently played' },
];

function matchesQuery(value: string, query: string) {
  return value.toLocaleLowerCase().includes(query);
}

export function LibraryView({
  likedMap,
  playlists,
  recentlyPlayed,
  followedArtists = [],
  currentTrackId,
  isPlaying,
  downloadedIds,
  downloadingIds,
  onPlayList,
  onOpenPlaylist,
  onEnqueue,
  onToggleLike,
  onToggleDownload,
  onAddToPlaylist,
  onOpenCreatePlaylist,
  onDeletePlaylist,
  onOpenVideoQuery,
  onOpenArtist,
  onToggleFollowArtist,
}: LibraryViewProps) {
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [query, setQuery] = useState('');
  const likedTracks = useMemo(() => Object.values(likedMap), [likedMap]);
  const normalizedQuery = query.trim().toLocaleLowerCase();

  const visiblePlaylists = useMemo(
    () => playlists.filter((playlist) =>
      (filter !== 'imported' || Boolean(playlist.sourcePageUrl)) &&
      (!normalizedQuery || matchesQuery(`${playlist.name} ${playlist.description}`, normalizedQuery) ||
      playlist.tracks.some((track) => matchesQuery(`${track.name} ${track.artist}`, normalizedQuery)))
    ),
    [playlists, normalizedQuery, filter]
  );
  const visibleFollowedArtists = useMemo(
    () =>
      [...followedArtists]
        .sort((a, b) => (b.followedAtMs || 0) - (a.followedAtMs || 0))
        .filter((artist) =>
          !normalizedQuery ||
          matchesQuery(`${artist.name} ${artist.genre || ''} ${artist.language || ''}`, normalizedQuery)
        ),
    [followedArtists, normalizedQuery]
  );
  const visibleLiked = useMemo(
    () => likedTracks.filter((track) => !normalizedQuery || matchesQuery(`${track.name} ${track.artist} ${track.albumName}`, normalizedQuery)),
    [likedTracks, normalizedQuery]
  );
  const visibleRecent = useMemo(
    () => recentlyPlayed.filter((track) => !normalizedQuery || matchesQuery(`${track.name} ${track.artist} ${track.albumName}`, normalizedQuery)),
    [recentlyPlayed, normalizedQuery]
  );

  const showPlaylists = filter === 'all' || filter === 'playlists' || filter === 'imported';
  const showArtists = filter === 'artists' || (filter === 'all' && followedArtists.length > 0);
  const showLiked = filter === 'all' || filter === 'liked';
  const showRecent = filter === 'all' || filter === 'recent';
  const totalTracks = new Set([...likedTracks, ...recentlyPlayed].map((track) => track.id)).size;

  return (
    <section aria-label="Your library" className="mx-auto w-full max-w-[1440px] space-y-8 pb-10">
      <header className="relative isolate overflow-hidden rounded-2xl border border-white/[0.07] bg-[#101713] px-5 py-6 sm:px-8 sm:py-8">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_85%_0%,rgba(50,190,105,0.22),transparent_42%),linear-gradient(120deg,rgba(255,255,255,0.035),transparent_55%)]" />
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#62f58a]/20 bg-[#62f58a]/[0.08] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-[#9fffb7]">
              <Sparkles className="h-3.5 w-3.5" /> Your personal space
            </div>
            <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">Your Library</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-400">
              Your playlists, favourites and listening history — together in one place.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenCreatePlaylist}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-[#62f58a] px-5 text-sm font-extrabold text-[#07110a] shadow-[0_8px_28px_rgba(48,210,105,0.16)] transition hover:bg-[#83ffa4] active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" /> Create playlist
          </button>
        </div>

        <div className="mt-7 grid grid-cols-2 gap-2 sm:max-w-[680px] sm:grid-cols-4 sm:gap-3">
          <div className="rounded-xl border border-white/[0.07] bg-black/20 px-3 py-3 sm:px-4">
            <div className="flex items-center gap-2 text-zinc-400"><ListMusic className="h-4 w-4" /><span className="text-[11px] font-semibold sm:text-xs">Playlists</span></div>
            <div className="mt-1.5 text-xl font-black tabular-nums text-white">{playlists.length}</div>
          </div>
          <div className="rounded-xl border border-white/[0.07] bg-black/20 px-3 py-3 sm:px-4">
            <div className="flex items-center gap-2 text-zinc-400"><UserCheck className="h-4 w-4" /><span className="text-[11px] font-semibold sm:text-xs">Following</span></div>
            <div className="mt-1.5 text-xl font-black tabular-nums text-white">{followedArtists.length}</div>
          </div>
          <div className="rounded-xl border border-white/[0.07] bg-black/20 px-3 py-3 sm:px-4">
            <div className="flex items-center gap-2 text-zinc-400"><Heart className="h-4 w-4" /><span className="text-[11px] font-semibold sm:text-xs">Liked</span></div>
            <div className="mt-1.5 text-xl font-black tabular-nums text-white">{likedTracks.length}</div>
          </div>
          <div className="rounded-xl border border-white/[0.07] bg-black/20 px-3 py-3 sm:px-4">
            <div className="flex items-center gap-2 text-zinc-400"><Music2 className="h-4 w-4" /><span className="text-[11px] font-semibold sm:text-xs">Unique tracks</span></div>
            <div className="mt-1.5 text-xl font-black tabular-nums text-white">{totalTracks}</div>
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Library filters">
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={filter === item.id}
              onClick={() => setFilter(item.id)}
              className={`shrink-0 rounded-full px-3.5 py-2 text-xs font-bold transition ${filter === item.id ? 'bg-white text-black' : 'border border-white/[0.08] bg-white/[0.035] text-zinc-400 hover:bg-white/[0.08] hover:text-white'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="flex min-h-10 w-full items-center gap-2 rounded-full border border-white/[0.09] bg-[#151917] px-4 text-zinc-400 focus-within:border-[#62f58a]/50 xl:max-w-[280px]">
          <Search className="h-4 w-4 shrink-0" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your library"
            aria-label="Search your library"
            className="w-full min-w-0 bg-transparent text-sm text-white outline-none placeholder:text-zinc-500"
          />
        </label>
      </div>

      {showPlaylists && (
        <section aria-labelledby="library-playlists">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <h2 id="library-playlists" className="text-xl font-extrabold tracking-tight text-white">Your playlists</h2>
              <p className="mt-1 text-xs text-zinc-500">Collections you have created and saved on this device</p>
            </div>
            <span className="text-xs font-semibold tabular-nums text-zinc-500">{visiblePlaylists.length} {visiblePlaylists.length === 1 ? 'collection' : 'collections'}</span>
          </div>

          {visiblePlaylists.length === 0 ? (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-white/[0.12] bg-white/[0.025] px-5 py-9 text-center">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/[0.06] text-zinc-400"><ListMusic className="h-5 w-5" /></div>
              <p className="mt-3 text-sm font-bold text-white">{query ? 'No matching playlists' : 'Your first playlist starts here'}</p>
              <p className="mt-1 max-w-sm text-xs leading-5 text-zinc-500">{query ? 'Try another title, description or track name.' : 'Make a collection for a mood, an artist or whatever you are listening to.'}</p>
              {!query && <button type="button" onClick={onOpenCreatePlaylist} className="mt-4 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-bold text-black"><Plus className="h-3.5 w-3.5" /> Create playlist</button>}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visiblePlaylists.map((playlist) => (
                <article key={playlist.id} className="group relative flex min-w-0 items-center gap-4 overflow-hidden rounded-2xl border border-white/[0.07] bg-[#151a17] p-3 transition duration-200 hover:border-[#62f58a]/25 hover:bg-[#19221c]">
                  <button type="button" onClick={() => onOpenPlaylist(playlist)} aria-label={`Open playlist ${playlist.name}`} className="relative h-[76px] w-[76px] shrink-0 overflow-hidden rounded-xl bg-black">
                    <CoverImage src={playlist.image || playlist.tracks[0]?.image} alt={playlist.name} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
                    <span className="absolute inset-0 grid place-items-center bg-black/35 opacity-0 transition group-hover:opacity-100"><Play className="h-6 w-6 fill-white text-white" /></span>
                  </button>
                  <div className="min-w-0 flex-1">
                    <button type="button" onClick={() => onOpenPlaylist(playlist)} className="block max-w-full truncate text-left text-sm font-extrabold text-white hover:text-[#9fffb7]">{playlist.name}</button>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-400">{playlist.description || 'Your personal collection'}</p>
                    <p className="mt-1.5 text-[11px] font-semibold text-zinc-500">{playlist.tracks.length} {playlist.tracks.length === 1 ? 'track' : 'tracks'}{playlist.importedAt ? ` · Imported ${new Date(playlist.importedAt).toLocaleDateString()}` : ''}</p>
                    {typeof playlist.matchedTrackCount === 'number' && (
                      <p className="mt-1 text-[10px] text-zinc-500">
                        <span className="text-[#8df8a7]">{playlist.matchedTrackCount} matched</span>
                        {typeof playlist.unmatchedTrackCount === 'number' && playlist.unmatchedTrackCount > 0
                          ? ` · ${playlist.unmatchedTrackCount} metadata only`
                          : ' · All matched'}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    {playlist.tracks.length > 0 && (
                      <button type="button" onClick={() => onPlayList(playlist.tracks, 0)} aria-label={`Play ${playlist.name}`} className="grid h-9 w-9 place-items-center rounded-full bg-[#62f58a] text-black transition hover:scale-105"><Play className="h-4 w-4 fill-current" /></button>
                    )}
                    <button type="button" onClick={() => onDeletePlaylist(playlist.id)} aria-label={`Delete playlist ${playlist.name}`} title="Delete playlist" className="grid h-9 w-9 place-items-center rounded-full text-zinc-500 transition hover:bg-red-500/10 hover:text-red-300"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {showArtists && (
        <section aria-labelledby="library-artists">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <h2 id="library-artists" className="text-xl font-extrabold tracking-tight text-white">Followed artists</h2>
              <p className="mt-1 text-xs text-zinc-500">Artists you follow for new releases and personalised picks</p>
            </div>
            <span className="text-xs font-semibold tabular-nums text-zinc-500">
              {visibleFollowedArtists.length} {visibleFollowedArtists.length === 1 ? 'artist' : 'artists'}
            </span>
          </div>

          {visibleFollowedArtists.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/[0.12] bg-white/[0.025] px-5 py-8 text-center">
              <UserCheck className="mx-auto h-6 w-6 text-zinc-500" />
              <p className="mt-2 text-sm font-bold text-white">
                {query ? 'No matching followed artists' : 'No followed artists yet'}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {query ? 'Try another name or genre.' : 'Open any artist page and tap Follow to keep them here.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visibleFollowedArtists.map((artist) => (
                <article
                  key={`lib-art-${artist.id}`}
                  className="group flex min-w-0 items-center gap-3.5 rounded-2xl border border-white/[0.07] bg-[#151a17] p-3 transition hover:border-[#62f58a]/25 hover:bg-[#19221c]"
                >
                  <button
                    type="button"
                    onClick={() => onOpenArtist?.(artist)}
                    aria-label={`Open ${artist.name}`}
                    className="h-16 w-16 shrink-0 overflow-hidden rounded-full bg-black"
                  >
                    <CoverImage
                      src={artist.image}
                      alt={artist.name}
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    />
                  </button>
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => onOpenArtist?.(artist)}
                      className="block max-w-full truncate text-left text-sm font-extrabold text-white hover:text-[#9fffb7]"
                    >
                      {artist.name}
                    </button>
                    <p className="mt-0.5 truncate text-xs text-zinc-400">
                      {[artist.genre || 'Artist', artist.language].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  {onToggleFollowArtist && (
                    <button
                      type="button"
                      onClick={() => onToggleFollowArtist(artist)}
                      aria-label={`Unfollow ${artist.name}`}
                      className="shrink-0 rounded-full border border-[#1DB954]/50 bg-[#1DB954]/12 px-3 py-1.5 text-xs font-bold text-[#8df8a7] transition hover:bg-[#1DB954]/22"
                    >
                      Following
                    </button>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {showLiked && (
        <section aria-labelledby="library-liked">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <h2 id="library-liked" className="text-xl font-extrabold tracking-tight text-white">Liked songs</h2>
              <p className="mt-1 text-xs text-zinc-500">The tracks you have saved with a heart</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold tabular-nums text-zinc-500">{visibleLiked.length} songs</span>
              {visibleLiked.length > 0 && <button type="button" onClick={() => onPlayList(visibleLiked, 0)} className="inline-flex items-center gap-1.5 rounded-full bg-[#62f58a] px-3.5 py-2 text-xs font-extrabold text-black"><Play className="h-3.5 w-3.5 fill-current" /> Play all</button>}
            </div>
          </div>
          {visibleLiked.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/[0.12] bg-white/[0.025] px-5 py-8 text-center">
              <Heart className="mx-auto h-6 w-6 text-zinc-500" />
              <p className="mt-2 text-sm font-bold text-white">{query ? 'No matching liked songs' : 'No liked songs yet'}</p>
              <p className="mt-1 text-xs text-zinc-500">{query ? 'Try a different search.' : 'Tap the heart on a track and it will be kept here.'}</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#111512] p-2 sm:p-3">
              {visibleLiked.map((track, index) => (
                <LibraryTrackRow key={track.id} track={track} index={index} currentTrackId={currentTrackId} isPlaying={isPlaying} isLiked downloaded={downloadedIds.has(track.id)} downloading={downloadingIds.has(track.id)} onPlay={() => onPlayList(visibleLiked, index)} onEnqueue={() => onEnqueue(track)} onToggleLike={() => onToggleLike(track)} onToggleDownload={() => onToggleDownload(track)} onAddToPlaylist={() => onAddToPlaylist(track)} onOpenVideo={() => onOpenVideoQuery(`${track.name} ${track.artist} official music video`)} onOpenArtist={onOpenArtist} />
              ))}
            </div>
          )}
        </section>
      )}

      {showRecent && (
        <section aria-labelledby="library-recent">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <h2 id="library-recent" className="text-xl font-extrabold tracking-tight text-white">Recently played</h2>
              <p className="mt-1 text-xs text-zinc-500">Pick up where you left off</p>
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold tabular-nums text-zinc-500"><Clock3 className="h-3.5 w-3.5" /> {visibleRecent.length} tracks</span>
          </div>
          {visibleRecent.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/[0.12] bg-white/[0.025] px-5 py-8 text-center">
              <Clock3 className="mx-auto h-6 w-6 text-zinc-500" />
              <p className="mt-2 text-sm font-bold text-white">{query ? 'No matching listening history' : 'Nothing played recently'}</p>
              <p className="mt-1 text-xs text-zinc-500">{query ? 'Try a different search.' : 'Tracks you listen to will appear here.'}</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#111512] p-2 sm:p-3">
              {visibleRecent.slice(0, 30).map((track, index) => (
                <LibraryTrackRow key={`recent-${track.id}-${index}`} track={track} index={index} currentTrackId={currentTrackId} isPlaying={isPlaying} isLiked={Boolean(likedMap[track.id])} downloaded={downloadedIds.has(track.id)} downloading={downloadingIds.has(track.id)} onPlay={() => onPlayList(visibleRecent, index)} onEnqueue={() => onEnqueue(track)} onToggleLike={() => onToggleLike(track)} onToggleDownload={() => onToggleDownload(track)} onAddToPlaylist={() => onAddToPlaylist(track)} onOpenVideo={() => onOpenVideoQuery(`${track.name} ${track.artist} official music video`)} onOpenArtist={onOpenArtist} />
              ))}
            </div>
          )}
        </section>
      )}
    </section>
  );
}

interface LibraryTrackRowProps {
  track: Track;
  index: number;
  currentTrackId?: string;
  isPlaying: boolean;
  isLiked: boolean;
  downloaded: boolean;
  downloading: boolean;
  onPlay: () => void;
  onEnqueue: () => void;
  onToggleLike: () => void;
  onToggleDownload: () => void;
  onAddToPlaylist: () => void;
  onOpenVideo: () => void;
  onOpenArtist?: (artist: ArtistTarget) => void;
}

function LibraryTrackRow({ track, index, currentTrackId, isPlaying, isLiked, downloaded, downloading, onPlay, onEnqueue, onToggleLike, onToggleDownload, onAddToPlaylist, onOpenVideo, onOpenArtist }: LibraryTrackRowProps) {
  const isCurrent = track.id === currentTrackId;
  const primaryArtist = extractPrimaryArtistName(track.artist);
  return (
    <article className={`group flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-2 py-2.5 transition hover:bg-white/[0.045] sm:flex-nowrap sm:px-3 ${isCurrent ? 'bg-[#62f58a]/[0.07]' : ''}`}>
      <span className="w-5 shrink-0 text-center font-mono text-[11px] text-zinc-600">{isCurrent && isPlaying ? '♫' : index + 1}</span>
      <button type="button" onClick={onPlay} aria-label={`Play ${track.name}`} className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-black">
        <CoverImage src={track.image} alt={track.name} className="h-full w-full object-cover" />
        <span className="absolute inset-0 grid place-items-center bg-black/50 opacity-0 transition group-hover:opacity-100"><Play className="h-4 w-4 fill-white text-white" /></span>
      </button>
      <div className="min-w-[120px] flex-1">
        <button type="button" onClick={onPlay} className="block max-w-full truncate text-left">
          <span className={`block truncate text-sm font-bold ${isCurrent ? 'text-[#8df8a7]' : 'text-zinc-100'}`}>{track.name}</span>
        </button>
        <div className="mt-0.5 flex min-w-0 items-center truncate text-xs text-zinc-500">
          {onOpenArtist && primaryArtist && primaryArtist !== 'Unknown Artist' ? (
            <button type="button" onClick={() => onOpenArtist({ id: '', name: primaryArtist, image: '' })} className="truncate text-left hover:text-zinc-300 hover:underline">
              {track.artist}
            </button>
          ) : (
            <span className="truncate">{track.artist}</span>
          )}
          {track.albumName && <span className="truncate">{` · ${track.albumName}`}</span>}
        </div>
      </div>
      <div className="flex w-full shrink-0 items-center justify-end gap-1 border-t border-white/[0.045] pt-1 sm:w-auto sm:border-0 sm:pt-0">
        <DownloadButton trackName={track.name} downloaded={downloaded} downloading={downloading} onClick={onToggleDownload} disabled={track.offlineAvailable === false || track.sourceProvider === 'Jamendo'} disabledReason="This provider supports online listening only" size="xs" />
        <button type="button" onClick={onToggleLike} aria-label={isLiked ? `Unlike ${track.name}` : `Like ${track.name}`} title={isLiked ? 'Remove from liked songs' : 'Like'} className={`grid h-8 w-8 place-items-center rounded-full transition hover:bg-white/[0.08] ${isLiked ? 'text-[#62f58a]' : 'text-zinc-500 hover:text-white'}`}><Heart className={`h-4 w-4 ${isLiked ? 'fill-current' : ''}`} /></button>
        <button type="button" onClick={onEnqueue} aria-label={`Add ${track.name} to queue`} title="Add to queue" className="grid h-8 w-8 place-items-center rounded-full text-zinc-500 transition hover:bg-white/[0.08] hover:text-white"><Plus className="h-4 w-4" /></button>
        <button type="button" onClick={onAddToPlaylist} aria-label={`Add ${track.name} to a playlist`} title="Add to playlist" className="grid h-8 w-8 place-items-center rounded-full text-zinc-500 transition hover:bg-white/[0.08] hover:text-white"><ListMusic className="h-4 w-4" /></button>
        <button type="button" onClick={onOpenVideo} aria-label={`Find video for ${track.name}`} title="Find video" className="grid h-8 w-8 place-items-center rounded-full text-zinc-500 transition hover:bg-white/[0.08] hover:text-white"><Video className="h-4 w-4" /></button>
      </div>
    </article>
  );
}
