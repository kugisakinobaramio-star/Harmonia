import {
  Check,
  ChevronDown,
  Heart,
  ListMusic,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Share2,
  Shuffle,
  SkipBack,
  SkipForward,
  Video,
} from 'lucide-react';
import type { AudioQuality, LyricLine, RepeatMode, Track } from '../types/music';
import { formatTime, QUALITY_LABELS, resolveActiveLyricPair } from '../utils/playerEngine';
import { CoverImage } from './CoverImage';

interface ExpandedPlayerProps {
  open: boolean;
  track: Track | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  shuffle: boolean;
  repeatMode: RepeatMode;
  isLiked: boolean;
  quality: AudioQuality;
  lyrics: LyricLine[];
  lyricsSynced: boolean;
  onClose: () => void;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onToggleLike: () => void;
  onSeek: (seconds: number) => void;
  onOpenQueue: () => void;
  onOpenVideo: () => void;
  onShare: () => void;
  onCycleQuality: () => void;
}

export function ExpandedPlayer({
  open,
  track,
  isPlaying,
  currentTime,
  duration,
  shuffle,
  repeatMode,
  isLiked,
  quality,
  lyrics,
  lyricsSynced,
  onClose,
  onTogglePlay,
  onPrev,
  onNext,
  onToggleShuffle,
  onCycleRepeat,
  onToggleLike,
  onSeek,
  onOpenQueue,
  onOpenVideo,
  onShare,
  onCycleQuality,
}: ExpandedPlayerProps) {
  if (!open || !track) return null;

  const safeDuration = duration > 0 ? duration : track.duration || 200;
  const progressPct = Math.min(100, Math.max(0, (currentTime / safeDuration) * 100));
  const { activeIndex } = resolveActiveLyricPair(lyrics, currentTime, safeDuration);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Expanded Now Playing player"
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-gradient-to-b from-[#1f2621] via-[#121212] to-black text-white"
    >
      {/* Top Bar */}
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-8">
        <button
          type="button"
          onClick={onClose}
          aria-label="Collapse full player"
          className="grid h-10 w-10 place-items-center rounded-full bg-black/40 text-zinc-200 transition-colors hover:bg-black/70 hover:text-white"
        >
          <ChevronDown className="h-5 w-5" />
        </button>

        <div className="min-w-0 text-center">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
            Playing From Harmonia
          </div>
          <div className="truncate text-xs font-bold text-white">{track.albumName}</div>
        </div>

        <button
          type="button"
          onClick={() => {
            onClose();
            onOpenQueue();
          }}
          aria-label="Open playback queue"
          className="grid h-10 w-10 place-items-center rounded-full bg-black/40 text-zinc-200 transition-colors hover:bg-black/70 hover:text-white"
        >
          <ListMusic className="h-4 w-4" />
        </button>
      </div>

      {/* Main Content */}
      <div className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-8 px-5 pb-8 pt-2 lg:grid-cols-[minmax(320px,440px)_1fr] lg:px-10">
        {/* Left: Cover + Metadata + Full Transport */}
        <div className="mx-auto flex w-full max-w-[420px] flex-col">
          <div className="overflow-hidden rounded-lg bg-black shadow-2xl">
            <CoverImage
              src={track.image}
              alt={track.name}
              className="aspect-square w-full object-cover"
            />
          </div>

          <div className="mt-6 flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-2xl font-extrabold tracking-tight text-white">
                {track.name}
              </h2>
              <p className="mt-0.5 truncate text-sm font-medium text-zinc-300">{track.artist}</p>
            </div>

            <button
              type="button"
              onClick={onToggleLike}
              aria-label={isLiked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
              aria-pressed={isLiked}
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-full transition-transform hover:scale-105 ${
                isLiked
                  ? 'bg-[#1DB954] text-black'
                  : 'border border-zinc-500 text-zinc-300 hover:border-white hover:text-white'
              }`}
            >
              {isLiked ? <Check className="h-4 w-4 stroke-[3]" /> : <Heart className="h-4 w-4" />}
            </button>
          </div>

          {/* Scrubber */}
          <div className="mt-5">
            <div className="group/bar relative flex w-full items-center">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white group-hover/bar:bg-[#1DB954]"
                style={{ width: `${progressPct}%` }}
              />
              <label htmlFor="expanded-seek-bar" className="sr-only">
                Full player progress
              </label>
              <input
                id="expanded-seek-bar"
                type="range"
                min={0}
                max={1000}
                value={Math.round((progressPct / 100) * 1000)}
                onChange={(e) => onSeek((Number(e.target.value) / 1000) * safeDuration)}
                className="sp-range relative z-10 w-full"
              />
            </div>
            <div className="mt-1.5 flex justify-between font-mono-num text-[11px] text-zinc-400">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(safeDuration)}</span>
            </div>
          </div>

          {/* Transport */}
          <div className="mt-3 flex items-center justify-between px-2">
            <button
              type="button"
              onClick={onToggleShuffle}
              aria-label={shuffle ? 'Disable shuffle' : 'Enable shuffle'}
              className={`p-2 ${shuffle ? 'text-[#1DB954]' : 'text-zinc-400 hover:text-white'}`}
            >
              <Shuffle className="h-5 w-5" />
            </button>

            <button
              type="button"
              onClick={onPrev}
              aria-label="Previous track"
              className="p-2 text-white hover:scale-105"
            >
              <SkipBack className="h-7 w-7 fill-current" />
            </button>

            <button
              type="button"
              onClick={onTogglePlay}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              className="grid h-16 w-16 place-items-center rounded-full bg-white text-black shadow-xl transition-transform hover:scale-105 active:scale-95"
            >
              {isPlaying ? (
                <Pause className="h-7 w-7 fill-current" />
              ) : (
                <Play className="h-7 w-7 fill-current pl-0.5" />
              )}
            </button>

            <button
              type="button"
              onClick={onNext}
              aria-label="Next track"
              className="p-2 text-white hover:scale-105"
            >
              <SkipForward className="h-7 w-7 fill-current" />
            </button>

            <button
              type="button"
              onClick={onCycleRepeat}
              aria-label="Cycle repeat mode"
              className={`p-2 ${repeatMode > 0 ? 'text-[#1DB954]' : 'text-zinc-400 hover:text-white'}`}
            >
              {repeatMode === 2 ? <Repeat1 className="h-5 w-5" /> : <Repeat className="h-5 w-5" />}
            </button>
          </div>

          {/* Bottom Utility Row */}
          <div className="mt-5 flex items-center justify-between text-xs text-zinc-400">
            <button
              type="button"
              onClick={onCycleQuality}
              className="font-mono-num rounded-full border border-white/15 px-3 py-1 font-semibold text-zinc-200 hover:border-white"
            >
              Quality: {QUALITY_LABELS[quality]}
            </button>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onOpenVideo}
                aria-label="Watch music video"
                className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 font-semibold text-white hover:bg-white/20"
              >
                <Video className="h-3.5 w-3.5" />
                Video
              </button>
              <button
                type="button"
                onClick={onShare}
                aria-label="Share track"
                className="p-1.5 text-zinc-300 hover:text-white"
              >
                <Share2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Right: Synced Lyrics Card */}
        <div className="flex h-full max-h-[540px] flex-col rounded-xl bg-[#181c1a]/90 p-5 sm:p-7">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-xs font-extrabold uppercase tracking-wider text-[#1DB954]">
              {lyricsSynced ? 'Time-Synced Lyrics' : 'Lyrics'}
            </span>
            <span className="text-xs text-zinc-400">{track.language || 'Vocal'}</span>
          </div>

          {lyrics.length === 0 ? (
            <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
              Lyrics unavailable for this recording.
            </div>
          ) : (
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-2">
              {lyrics.map((line, idx) => {
                const isActive = idx === activeIndex;
                return (
                  <button
                    key={`${idx}-${line.time}`}
                    type="button"
                    onClick={() => onSeek(line.time)}
                    className={`block w-full rounded-md px-2 py-1 text-left text-lg font-bold leading-snug transition-colors hover:bg-white/[0.05] sm:text-xl ${
                      isActive ? 'text-[#1DB954]' : idx < activeIndex ? 'text-zinc-500' : 'text-zinc-300'
                    }`}
                  >
                    {line.text}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
