import { ArrowDown, Clock, Heart, ListPlus, Loader2, Play, Plus, Search, Shuffle, Video } from 'lucide-react';
import { useState } from 'react';
import type { CollectionTarget, Track } from '../types/music';
import { extractPrimaryArtistName } from '../utils/artistProfile';
import { isCollectionFullyDownloaded } from '../utils/offlineStore';
import { formatTime, sortTracks } from '../utils/playerEngine';
import { CoverImage } from './CoverImage';
import { DownloadButton } from './DownloadButton';
import { SuggestedMusic } from './SuggestedMusic';

interface CollectionViewProps {
  collection: CollectionTarget;
  currentTrackId?: string;
  isPlaying: boolean;
  likedMap: Record<string, Track>;
  downloadedIds: Set<string>;
  downloadingIds: Set<string>;
  onPlayList: (tracks: Track[], startIndex: number, shuffle?: boolean) => void;
  onToggleLike: (track: Track) => void;
  onToggleDownload: (track: Track) => void;
  onDownloadAll: (tracks: Track[]) => void;
  onEnqueue: (track: Track) => void;
  onAddToPlaylist: (track: Track) => void;
  onOpenVideo: (track: Track) => void;
  onOpenArtistName?: (artistName: string) => void;
  suggestionCandidates: Track[];
}

export function CollectionView({
  collection,
  currentTrackId,
  isPlaying,
  likedMap,
  downloadedIds,
  downloadingIds,
  onPlayList,
  onToggleLike,
  onToggleDownload,
  onDownloadAll,
  onEnqueue,
  onAddToPlaylist,
  onOpenVideo,
  onOpenArtistName,
  suggestionCandidates,
}: CollectionViewProps) {
  const [filterText, setFilterText] = useState('');
  const [sortBy, setSortBy] = useState<'default' | 'title' | 'artist' | 'duration'>('default');

  const filtered = collection.tracks.filter((t) => {
    const q = filterText.trim().toLowerCase();
    if (!q) return true;
    return (
      t.name.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q) ||
      t.albumName.toLowerCase().includes(q)
    );
  });

  const sorted = sortTracks(filtered, sortBy);
  const totalSeconds = sorted.reduce((acc, t) => acc + (t.duration || 0), 0);
  const totalMins = Math.round(totalSeconds / 60);
  const allDownloaded = isCollectionFullyDownloaded(sorted, downloadedIds);
  const hasDownloadable = sorted.some(
    (t) => t.offlineAvailable !== false && t.sourceProvider !== 'Jamendo'
  );
  const anyDownloading = sorted.some((t) => downloadingIds.has(t.id));

  return (
    <section aria-label={collection.title} className="pb-8">
      {/* Spotify-style gradient header */}
      <div className="flex flex-col gap-5 rounded-lg bg-gradient-to-b from-[#232329] to-[#121212] p-5 sm:flex-row sm:items-end">
        <CoverImage
          src={collection.image}
          alt={collection.title}
          className={`h-40 w-40 shrink-0 object-cover shadow-2xl sm:h-48 sm:w-48 ${
            collection.kind === 'artist' ? 'rounded-full' : 'rounded-md'
          }`}
        />

        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold uppercase tracking-wider text-zinc-300">
            {collection.kind === 'artist'
              ? 'Artist'
              : collection.kind === 'liked'
                ? 'Playlist'
                : collection.kind}
          </div>
          <h1 className="mt-1.5 truncate text-3xl font-extrabold tracking-tight text-white sm:text-5xl">
            {collection.title}
          </h1>
          <p className="mt-2 text-sm text-zinc-300">{collection.subtitle}</p>
          {collection.sourcePageUrl && (
            <a href={collection.sourcePageUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex text-xs font-semibold text-[#79e99f] hover:underline">
              Imported from Spotify · View original playlist
            </a>
          )}
          <p className="mt-1 font-mono-num text-xs text-zinc-400">
            MusicKK · {sorted.length} {sorted.length === 1 ? 'song' : 'songs'}
            {totalMins > 0 ? ` · about ${totalMins} min` : ''}
          </p>
        </div>
      </div>

      {collection.spotifyEmbedUrl && (
        <div className="mt-5 rounded-lg border border-white/10 bg-[#181818] p-3 sm:p-4">
          <div className="mb-2 text-sm font-semibold text-white">Listen on Spotify</div>
          <p className="mb-3 text-xs leading-relaxed text-zinc-400">
            Playback is handled by Spotify here. Sign in to Spotify in this browser if the player only offers previews. Full playback availability is controlled by Spotify and your account.
          </p>
          <iframe
            title={`Spotify player for ${collection.title}`}
            src={collection.spotifyEmbedUrl}
            width="100%"
            height="352"
            frameBorder="0"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            allowFullScreen
            loading="lazy"
            className="w-full rounded-md"
          />
        </div>
      )}

      {/* Action bar: Emerald Play, Shuffle, Filter & Sort */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-3">
          {sorted.length > 0 && !collection.spotifyEmbedUrl && (
            <>
              <button
                type="button"
                onClick={() => onPlayList(sorted, 0, false)}
                aria-label={`Play ${collection.title}`}
                className="grid h-12 w-12 place-items-center rounded-full bg-[#1DB954] text-black shadow-lg transition-transform hover:scale-105"
              >
                <Play className="h-5 w-5 fill-current pl-0.5" />
              </button>
              <button
                type="button"
                onClick={() => onPlayList(sorted, 0, true)}
                aria-label={`Shuffle play ${collection.title}`}
                className="grid h-9 w-9 place-items-center rounded-full border border-white/15 text-zinc-300 transition-colors hover:border-white hover:text-white"
              >
                <Shuffle className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => onDownloadAll(sorted)}
                disabled={anyDownloading || !hasDownloadable}
                aria-label={
                  !hasDownloadable
                    ? `Offline download is unavailable for ${collection.title}`
                    : anyDownloading
                      ? `Downloading ${collection.title}`
                      : allDownloaded
                        ? `Remove downloaded tracks in ${collection.title}`
                        : `Download all songs in ${collection.title}`
                }
                aria-pressed={allDownloaded}
                title={
                  !hasDownloadable
                    ? 'These tracks support online listening only'
                    : allDownloaded
                      ? 'Downloaded — click to remove'
                      : 'Download all songs for offline listening'
                }
                className={`grid h-9 w-9 place-items-center rounded-full border transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                  allDownloaded
                    ? 'border-[#1DB954] bg-[#1DB954] text-black shadow-md'
                    : anyDownloading
                      ? 'border-[#1DB954] text-[#1DB954]'
                      : 'border-white/15 text-zinc-300 hover:border-white hover:text-white'
                }`}
              >
                {anyDownloading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowDown className="h-4 w-4 stroke-[2.5]" />
                )}
              </button>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-md bg-[#202024] px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 text-zinc-400" />
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filter tracks..."
              aria-label="Filter tracks in playlist"
              className="w-32 bg-transparent text-xs text-white placeholder-zinc-400 focus:outline-none sm:w-44"
            />
          </div>

          <select
            aria-label="Sort tracks"
            value={sortBy}
            onChange={(e) =>
              setSortBy(e.target.value as 'default' | 'title' | 'artist' | 'duration')
            }
            className="rounded-md bg-[#202024] px-2.5 py-1.5 text-xs font-semibold text-zinc-200 focus:outline-none"
          >
            <option value="default">Custom order</option>
            <option value="title">Title</option>
            <option value="artist">Artist</option>
            <option value="duration">Duration</option>
          </select>
        </div>
      </div>

      {/* Spotify Track Table */}
      {sorted.length === 0 ? (
        <div className="mt-6 rounded-lg bg-[#18181b] p-6 text-sm text-zinc-400">
          No tracks found here yet. Play or like songs to populate this collection.
        </div>
      ) : (
        <div className="mt-4">
          <div className="hidden grid-cols-[32px_minmax(0,1.6fr)_minmax(0,1fr)_76px_184px] items-center gap-3 border-b border-white/[0.08] px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400 md:grid">
            <span className="text-center">#</span>
            <span>Title</span>
            <span className="hidden md:block">Album</span>
            <span className="hidden md:block">Lang</span>
            <span className="flex items-center justify-end pr-2">
              <Clock className="h-3.5 w-3.5" />
            </span>
          </div>

          <div className="mt-1 space-y-0.5">
            {sorted.map((track, idx) => {
              const isCurrent = track.id === currentTrackId;
              const isLiked = Boolean(likedMap[track.id]);
              const isDownloaded = downloadedIds.has(track.id);
              const isDownloading = downloadingIds.has(track.id);
              return (
                <div
                  key={`${collection.id}-${track.id}-${idx}`}
                  className={`group grid grid-cols-[24px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-xl px-2 py-3 transition-colors md:grid-cols-[32px_minmax(0,1.6fr)_minmax(0,1fr)_76px_184px] md:gap-3 md:rounded-md md:px-3 md:py-2 ${
                    isCurrent ? 'bg-white/[0.1]' : 'hover:bg-white/[0.06]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => { if (!collection.spotifyEmbedUrl) onPlayList(sorted, idx); }}
                    disabled={Boolean(collection.spotifyEmbedUrl)}
                    className="font-mono-num text-center text-xs text-zinc-400 group-hover:text-white"
                    aria-label={`Play ${track.name}`}
                  >
                    {isCurrent && isPlaying ? (
                      <span className="text-[#1DB954]">♫</span>
                    ) : (
                      idx + 1
                    )}
                  </button>

                  <div className="flex w-full min-w-0 items-center gap-3">
                    <button
                      type="button"
                      onClick={() => { if (!collection.spotifyEmbedUrl) onPlayList(sorted, idx); }}
                      disabled={Boolean(collection.spotifyEmbedUrl)}
                      aria-label={`Play ${track.name}`}
                      className="h-10 w-10 shrink-0 overflow-hidden rounded bg-black"
                    >
                      <CoverImage
                        src={track.image}
                        alt={track.name}
                        className="h-full w-full object-cover"
                      />
                    </button>
                    <div className="min-w-0 flex-1 text-left">
                      <button
                        type="button"
                        onClick={() => { if (!collection.spotifyEmbedUrl) onPlayList(sorted, idx); }}
                        disabled={Boolean(collection.spotifyEmbedUrl)}
                        className={`block max-w-full truncate text-left text-sm font-semibold ${
                          isCurrent ? 'text-[#1DB954]' : 'text-white'
                        }`}
                      >
                        {track.name}
                      </button>
                      {onOpenArtistName ? (
                        <button
                          type="button"
                          onClick={() => onOpenArtistName(extractPrimaryArtistName(track.artist))}
                          className="block max-w-full truncate text-left text-xs text-zinc-400 hover:text-white hover:underline"
                        >
                          {track.artist}
                        </button>
                      ) : (
                        <div className="truncate text-xs text-zinc-400">{track.artist}</div>
                      )}
                    </div>
                  </div>

                  <div className="hidden truncate text-xs text-zinc-400 md:block">
                    {track.albumName}
                  </div>

                  <div className="hidden truncate text-xs text-zinc-400 md:block">
                    {track.language || 'Vocal'}
                  </div>

                  <div className="col-start-2 flex w-full items-center justify-end gap-1.5 border-t border-white/[0.05] pt-2 md:col-start-auto md:w-auto md:border-0 md:pt-0">
                    <DownloadButton
                      trackName={track.name}
                      downloaded={isDownloaded}
                      downloading={isDownloading}
                      onClick={() => onToggleDownload(track)}
                      disabled={track.offlineAvailable === false}
                      disabledReason="This provider supports online listening only"
                      size="xs"
                      className={
                        isDownloaded || isDownloading
                          ? 'opacity-100'
                          : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100'
                      }
                    />

                    <button
                      type="button"
                      onClick={() => onToggleLike(track)}
                      aria-label={isLiked ? `Unlike ${track.name}` : `Like ${track.name}`}
                      className={`p-1 transition-colors focus-visible:opacity-100 ${
                        isLiked
                          ? 'text-[#1DB954] opacity-100'
                          : 'text-zinc-400 opacity-100 hover:text-white sm:opacity-0 sm:group-hover:opacity-100'
                      }`}
                    >
                      <Heart className={`h-3.5 w-3.5 ${isLiked ? 'fill-current' : ''}`} />
                    </button>

                    <button
                      type="button"
                      onClick={() => onEnqueue(track)}
                      aria-label={`Add ${track.name} to queue`}
                      title="Add to queue"
                      className="p-1 text-zinc-400 opacity-100 transition-opacity hover:text-white focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                    >
                      <ListPlus className="h-3.5 w-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => onAddToPlaylist(track)}
                      aria-label={`Add ${track.name} to playlist`}
                      title="Add to playlist"
                      className="inline-flex shrink-0 p-1 text-zinc-400 opacity-100 transition-opacity hover:text-white sm:opacity-0 sm:group-hover:opacity-100"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => onOpenVideo(track)}
                      aria-label={`Watch video for ${track.name}`}
                      title="Watch video"
                      className="hidden p-1 text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100 hover:text-white md:inline-flex"
                    >
                      <Video className="h-3.5 w-3.5" />
                    </button>

                    <span className="font-mono-num w-10 text-right text-xs text-zinc-400">
                      {formatTime(track.duration)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!collection.spotifyEmbedUrl && sorted.length > 0 && (
        <div className="mt-8 border-t border-white/10 pt-6">
          <SuggestedMusic
            title="Fits this playlist"
            description="Recommendations shaped by the shared sound across this collection."
            sourceTracks={sorted}
            candidates={suggestionCandidates}
            onPlay={(track) => onPlayList([track], 0)}
            onEnqueue={onEnqueue}
            onAddToPlaylist={onAddToPlaylist}
          />
        </div>
      )}
    </section>
  );
}
