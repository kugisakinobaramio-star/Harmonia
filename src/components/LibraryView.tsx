import { Play, Plus, Trash2 } from 'lucide-react';
import { ARTWORK } from '../data/catalog';
import type { CuratedPlaylist, Track } from '../types/music';
import { CoverImage } from './CoverImage';
import { TrackRow } from './TrackRow';

interface LibraryViewProps {
  likedMap: Record<string, Track>;
  playlists: CuratedPlaylist[];
  recentlyPlayed: Track[];
  currentTrackId?: string;
  isPlaying: boolean;
  onPlayList: (tracks: Track[], startIndex: number) => void;
  onOpenPlaylist: (pl: CuratedPlaylist) => void;
  onEnqueue: (track: Track) => void;
  onToggleLike: (track: Track) => void;
  onAddToPlaylist: (track: Track) => void;
  onOpenCreatePlaylist: () => void;
  onDeletePlaylist: (playlistId: string) => void;
  onOpenVideoQuery: (query: string) => void;
}

export function LibraryView({
  likedMap,
  playlists,
  recentlyPlayed,
  currentTrackId,
  isPlaying,
  onPlayList,
  onOpenPlaylist,
  onEnqueue,
  onToggleLike,
  onAddToPlaylist,
  onOpenCreatePlaylist,
  onDeletePlaylist,
  onOpenVideoQuery,
}: LibraryViewProps) {
  const likedTracks = Object.values(likedMap);

  return (
    <section aria-label="Your library" className="space-y-7 pb-8">
      {/* Custom Playlists */}
      <div>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-extrabold text-white">Your Playlists</h1>
            <p className="text-xs text-zinc-400">Synced with your Harmonia backend</p>
          </div>
          <button
            type="button"
            onClick={onOpenCreatePlaylist}
            className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-xs font-extrabold text-black transition-transform hover:scale-105"
          >
            <Plus className="h-3.5 w-3.5" />
            Create Playlist
          </button>
        </div>

        {playlists.length === 0 ? (
          <div className="rounded-lg bg-[#18181b] p-5 text-sm text-zinc-400">
            No custom playlists yet. Click Create Playlist to save your own collection.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {playlists.map((pl) => (
              <div
                key={pl.id}
                className="flex items-center justify-between gap-3 rounded-lg bg-[#161619] p-3 transition-colors hover:bg-[#222227]"
              >
                <button
                  type="button"
                  onClick={() => onOpenPlaylist(pl)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <CoverImage
                    src={pl.tracks[0]?.image || pl.image || ARTWORK.englishVinyl}
                    alt={pl.name}
                    className="h-12 w-12 shrink-0 rounded object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-white">{pl.name}</div>
                    <div className="font-mono-num text-xs text-zinc-400">
                      {pl.tracks.length} {pl.tracks.length === 1 ? 'track' : 'tracks'}
                    </div>
                  </div>
                </button>

                <div className="flex items-center gap-1.5">
                  {pl.tracks.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onPlayList(pl.tracks, 0)}
                      aria-label={`Play ${pl.name}`}
                      className="grid h-8 w-8 place-items-center rounded-full bg-[#1DB954] text-black hover:scale-105"
                    >
                      <Play className="h-3.5 w-3.5 fill-current pl-0.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onDeletePlaylist(pl.id)}
                    aria-label={`Delete playlist ${pl.name}`}
                    className="rounded-full p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Liked Songs */}
      <div>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-extrabold text-white">Liked Songs</h2>
            <p className="font-mono-num text-xs text-zinc-400">
              {likedTracks.length} {likedTracks.length === 1 ? 'song' : 'songs'}
            </p>
          </div>
          {likedTracks.length > 0 && (
            <button
              type="button"
              onClick={() => onPlayList(likedTracks, 0)}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#1DB954] px-4 py-1.5 text-xs font-extrabold text-black"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              Play Liked
            </button>
          )}
        </div>

        {likedTracks.length === 0 ? (
          <div className="rounded-lg bg-[#18181b] p-5 text-sm text-zinc-400">
            Save any song with the heart icon and it appears here.
          </div>
        ) : (
          <div className="space-y-1">
            {likedTracks.map((track, idx) => (
              <TrackRow
                key={track.id}
                track={track}
                index={idx}
                isCurrent={track.id === currentTrackId}
                isPlaying={isPlaying}
                isLiked
                onPlay={() => onPlayList(likedTracks, idx)}
                onEnqueue={() => onEnqueue(track)}
                onToggleLike={() => onToggleLike(track)}
                onAddToPlaylist={() => onAddToPlaylist(track)}
                onOpenVideo={() =>
                  onOpenVideoQuery(`${track.name} ${track.artist} official music video`)
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* Recently Played */}
      {recentlyPlayed.length > 0 && (
        <div>
          <h2 className="mb-3 text-xl font-extrabold text-white">Recently Played</h2>
          <div className="space-y-1">
            {recentlyPlayed.slice(0, 8).map((track, idx) => (
              <TrackRow
                key={`recent-${track.id}-${idx}`}
                track={track}
                index={idx}
                isCurrent={track.id === currentTrackId}
                isPlaying={isPlaying}
                isLiked={Boolean(likedMap[track.id])}
                onPlay={() => onPlayList(recentlyPlayed, idx)}
                onEnqueue={() => onEnqueue(track)}
                onToggleLike={() => onToggleLike(track)}
                onAddToPlaylist={() => onAddToPlaylist(track)}
                onOpenVideo={() =>
                  onOpenVideoQuery(`${track.name} ${track.artist} official music video`)
                }
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
