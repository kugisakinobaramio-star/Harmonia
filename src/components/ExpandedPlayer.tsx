import { useEffect, useRef } from 'react';
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
import { DownloadButton } from './DownloadButton';
import { SuggestedMusic } from './SuggestedMusic';

interface ExpandedPlayerProps {
  open: boolean;
  track: Track | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  shuffle: boolean;
  repeatMode: RepeatMode;
  isLiked: boolean;
  isDownloaded: boolean;
  isDownloading: boolean;
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
  onToggleDownload: () => void;
  onSeek: (seconds: number) => void;
  onOpenQueue: () => void;
  onOpenVideo: () => void;
  onShare: () => void;
  onCycleQuality: () => void;
  suggestionCandidates: Track[];
  onPlaySuggested: (track: Track) => void;
  onEnqueueSuggested: (track: Track) => void;
  onAddSuggestedToPlaylist: (track: Track) => void;
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
  isDownloaded,
  isDownloading,
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
  onToggleDownload,
  onSeek,
  onOpenQueue,
  onOpenVideo,
  onShare,
  onCycleQuality,
  suggestionCandidates,
  onPlaySuggested,
  onEnqueueSuggested,
  onAddSuggestedToPlaylist,
}: ExpandedPlayerProps) {
  const lyricListRef = useRef<HTMLDivElement | null>(null);
  const activeLyricRef = useRef<HTMLButtonElement | null>(null);
  const safeDuration = duration > 0 ? duration : track?.duration || 200;
  const progressPct = Math.min(100, Math.max(0, (currentTime / safeDuration) * 100));
  const { activeIndex } = resolveActiveLyricPair(lyrics, currentTime, safeDuration);

  useEffect(() => {
    if (!open || activeIndex < 0 || !activeLyricRef.current || !lyricListRef.current) return;
    activeLyricRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [open, activeIndex, track?.id]);

  if (!open || !track) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Expanded Now Playing player"
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-gradient-to-b from-[#1f2621] via-[#121212] to-black text-white"
    >
      {/* Top Bar */}
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-2.5 sm:px-8 sm:py-4">
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
            Playing From MusicKK
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
      <div className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-5 px-5 pb-5 pt-1 sm:gap-8 sm:pb-8 sm:pt-2 lg:grid-cols-[minmax(300px,420px)_1fr] lg:px-10">
        {/* Left: Cover + Metadata + Full Transport */}
        <div className="mx-auto flex w-full max-w-[420px] flex-col">
          <div className="mx-auto w-full max-w-[min(420px,36dvh)] overflow-hidden rounded-lg bg-black shadow-2xl lg:max-w-[min(400px,44dvh)]">
            <CoverImage
              src={track.image}
              alt={track.name}
              className="aspect-square w-full object-contain"
            />
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 sm:mt-6">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-xl font-extrabold tracking-tight text-white sm:text-2xl">
                {track.name}
              </h2>
              <p className="mt-0.5 truncate text-sm font-medium text-zinc-300">{track.artist}</p>
              {track.sourceProvider && (
                <p className="mt-1 truncate text-[10px] text-zinc-500">
                  Source: {track.sourceProvider}
                  {track.sourceAvailability === 'preview' ? ' · 30s preview' : ''}
                </p>
              )}
              {track.sourceProvider === 'Jamendo' && track.sourcePageUrl && (
                <div className="mt-1 flex flex-wrap gap-x-3 text-[10px]">
                  <a href={track.sourcePageUrl} target="_blank" rel="noreferrer" className="text-[#86dba4] underline underline-offset-2">Jamendo track</a>
                  {track.sourceLicense && (
                    <a href={track.sourceLicense} target="_blank" rel="noreferrer" className="text-zinc-500 underline underline-offset-2">Creative Commons licence</a>
                  )}
                </div>
              )}
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
          <div className="mt-3 sm:mt-5">
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
          <div className="mt-2 flex items-center justify-between px-2 sm:mt-3">
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
              className="grid h-14 w-14 place-items-center rounded-full bg-white text-black shadow-xl transition-transform hover:scale-105 active:scale-95 sm:h-16 sm:w-16"
            >
              {isPlaying ? (
                <Pause className="h-6 w-6 fill-current sm:h-7 sm:w-7" />
              ) : (
                <Play className="h-6 w-6 fill-current pl-0.5 sm:h-7 sm:w-7" />
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
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400 sm:mt-5">
            <button
              type="button"
              onClick={onCycleQuality}
              className="font-mono-num rounded-full border border-white/15 px-3 py-1 font-semibold text-zinc-200 hover:border-white"
            >
              Quality: {QUALITY_LABELS[quality]}
            </button>

            <div className="flex items-center gap-2">
              <DownloadButton
                trackName={track.name}
                downloaded={isDownloaded}
                downloading={isDownloading}
                onClick={onToggleDownload}
                disabled={track.offlineAvailable === false}
                disabledReason="This provider supports online listening only"
                variant="pill"
              />
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
            <div ref={lyricListRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-2">
              {lyrics.map((line, idx) => {
                const isActive = idx === activeIndex;
                return (
                  <button
                    key={`${idx}-${line.time}`}
                    ref={isActive ? activeLyricRef : null}
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
          <div className="mt-5 border-t border-white/10 pt-4">
            <SuggestedMusic
              title="Made for this sound"
              description="Picked from the mood, language and sound of this track."
              sourceTracks={[track]}
              candidates={suggestionCandidates}
              onPlay={onPlaySuggested}
              onEnqueue={onEnqueueSuggested}
              onAddToPlaylist={onAddSuggestedToPlaylist}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
