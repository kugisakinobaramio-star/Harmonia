import { ArrowDown, ArrowUp, Mic2, Play, Trash2, X } from 'lucide-react';
import type { LyricLine, RightPanelMode, Track } from '../types/music';
import { resolveActiveLyricPair } from '../utils/playerEngine';
import { CoverImage } from './CoverImage';
import { DownloadButton } from './DownloadButton';

interface RightPanelProps {
  mode: RightPanelMode;
  onChangeMode: (mode: RightPanelMode) => void;
  currentTrack: Track | null;
  queue: Track[];
  currentIndex: number;
  lyrics: LyricLine[];
  currentTime: number;
  duration: number;
  downloadedIds: Set<string>;
  downloadingIds: Set<string>;
  onToggleDownload: (track: Track) => void;
  onOpenFullLyrics: () => void;
  onPlayIndex: (idx: number) => void;
  onRemoveIndex: (idx: number) => void;
  onMoveItem: (fromIdx: number, toIdx: number) => void;
  onClearQueue: () => void;
}

export function RightPanel({
  mode,
  onChangeMode,
  currentTrack,
  queue,
  currentIndex,
  lyrics,
  currentTime,
  duration,
  downloadedIds,
  downloadingIds,
  onToggleDownload,
  onOpenFullLyrics,
  onPlayIndex,
  onRemoveIndex,
  onMoveItem,
  onClearQueue,
}: RightPanelProps) {
  if (mode === 'closed') return null;

  const pair = resolveActiveLyricPair(lyrics, currentTime, duration);
  const nextTrack =
    currentIndex >= 0 && currentIndex + 1 < queue.length ? queue[currentIndex + 1] : null;

  return (
    <>
      <div
        className="fixed inset-0 z-30 bg-black/70 backdrop-blur-xs xl:hidden"
        onClick={() => onChangeMode('closed')}
        aria-hidden="true"
      />
      <aside
        aria-label={mode === 'queue' ? 'Playback queue panel' : 'Now playing panel'}
        className="fixed inset-y-2 right-2 z-40 flex w-[300px] flex-col rounded-lg bg-[#121212] p-3.5 shadow-2xl xl:static xl:h-full xl:shadow-none"
      >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => onChangeMode('nowplaying')}
            className={`rounded-full px-3 py-1 text-xs font-bold transition-colors ${
              mode === 'nowplaying'
                ? 'bg-white text-black'
                : 'bg-[#202024] text-zinc-300 hover:bg-[#2a2a2f]'
            }`}
          >
            Now Playing
          </button>
          <button
            type="button"
            onClick={() => onChangeMode('queue')}
            className={`rounded-full px-3 py-1 text-xs font-bold transition-colors ${
              mode === 'queue'
                ? 'bg-white text-black'
                : 'bg-[#202024] text-zinc-300 hover:bg-[#2a2a2f]'
            }`}
          >
            Queue ({queue.length})
          </button>
        </div>

        <button
          type="button"
          onClick={() => onChangeMode('closed')}
          aria-label="Close right panel"
          className="rounded-full p-1 text-zinc-400 hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {mode === 'nowplaying' ? (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {currentTrack ? (
            <>
              <div className="overflow-hidden rounded-lg bg-black shadow-lg">
                <CoverImage
                  src={currentTrack.image}
                  alt={currentTrack.name}
                  className="aspect-square w-full object-cover"
                />
              </div>

              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-lg font-extrabold text-white">
                    {currentTrack.name}
                  </h2>
                  <p className="truncate text-sm text-zinc-400">{currentTrack.artist}</p>
                  <p className="mt-0.5 truncate text-xs text-zinc-500">
                    {currentTrack.albumName}
                    {currentTrack.language ? ` · ${currentTrack.language}` : ''}
                  </p>
                </div>
                <DownloadButton
                  trackName={currentTrack.name}
                  downloaded={downloadedIds.has(currentTrack.id)}
                  downloading={downloadingIds.has(currentTrack.id)}
                  onClick={() => onToggleDownload(currentTrack)}
                  size="sm"
                  className="mt-0.5"
                />
              </div>

              {/* Compact Lyrics Preview Card */}
              <div className="rounded-lg bg-[#1c1c20] p-3.5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-bold text-white">Synced Lyrics</span>
                  <button
                    type="button"
                    onClick={onOpenFullLyrics}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-[#1DB954] hover:underline"
                  >
                    <Mic2 className="h-3 w-3" />
                    Expand
                  </button>
                </div>
                <p className="text-sm font-bold leading-snug text-white">
                  {pair.current || 'Playing vocal track...'}
                </p>
                {pair.next && (
                  <p className="mt-1 text-xs leading-snug text-zinc-400">{pair.next}</p>
                )}
              </div>

              {nextTrack && (
                <div className="rounded-lg bg-[#1c1c20] p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-bold text-white">Next in queue</span>
                    <button
                      type="button"
                      onClick={() => onChangeMode('queue')}
                      className="text-[11px] font-semibold text-zinc-400 hover:text-white"
                    >
                      Open queue
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => onPlayIndex(currentIndex + 1)}
                    className="flex w-full items-center gap-2.5 rounded-md p-1 text-left hover:bg-white/[0.06]"
                  >
                    <CoverImage
                      src={nextTrack.image}
                      alt={nextTrack.name}
                      className="h-10 w-10 shrink-0 rounded object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-bold text-white">
                        {nextTrack.name}
                      </div>
                      <div className="truncate text-[11px] text-zinc-400">
                        {nextTrack.artist}
                      </div>
                    </div>
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-lg bg-[#1c1c20] p-4 text-xs text-zinc-400">
              Pick any track to see album art, synced lyrics, and what is up next.
            </div>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-400">
              {queue.length} {queue.length === 1 ? 'track' : 'tracks'}
            </span>
            {queue.length > 0 && (
              <button
                type="button"
                onClick={onClearQueue}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold text-zinc-400 hover:bg-white/10 hover:text-white"
              >
                <Trash2 className="h-3 w-3" />
                Clear
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
            {queue.length === 0 ? (
              <div className="rounded-lg bg-[#1c1c20] p-4 text-xs text-zinc-400">
                Queue is empty. Play a song or playlist to queue tracks.
              </div>
            ) : (
              queue.map((track, idx) => {
                const isNow = idx === currentIndex;
                return (
                  <div
                    key={`${track.id}-${idx}`}
                    className={`group flex items-center gap-2 rounded-md p-1.5 transition-colors ${
                      isNow ? 'bg-white/10' : 'hover:bg-white/[0.06]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onPlayIndex(idx)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                    >
                      <CoverImage
                        src={track.image}
                        alt={track.name}
                        className="h-10 w-10 shrink-0 rounded object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <div
                          className={`truncate text-xs font-bold ${
                            isNow ? 'text-[#1DB954]' : 'text-white'
                          }`}
                        >
                          {track.name}
                        </div>
                        <div className="truncate text-[11px] text-zinc-400">{track.artist}</div>
                      </div>
                    </button>

                    <div className="flex items-center gap-0.5">
                      <DownloadButton
                        trackName={track.name}
                        downloaded={downloadedIds.has(track.id)}
                        downloading={downloadingIds.has(track.id)}
                        onClick={() => onToggleDownload(track)}
                        size="xs"
                        className="mr-0.5"
                      />
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => onMoveItem(idx, idx - 1)}
                        aria-label={`Move ${track.name} up`}
                        className="rounded p-1 text-zinc-500 hover:text-white disabled:opacity-25"
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === queue.length - 1}
                        onClick={() => onMoveItem(idx, idx + 1)}
                        aria-label={`Move ${track.name} down`}
                        className="rounded p-1 text-zinc-500 hover:text-white disabled:opacity-25"
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>
                      {!isNow && (
                        <button
                          type="button"
                          onClick={() => onPlayIndex(idx)}
                          aria-label={`Play ${track.name}`}
                          className="rounded p-1 text-zinc-400 hover:text-[#1DB954]"
                        >
                          <Play className="h-3 w-3 fill-current" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onRemoveIndex(idx)}
                        aria-label={`Remove ${track.name}`}
                        className="rounded p-1 text-zinc-500 hover:text-white"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </aside>
    </>
  );
}
