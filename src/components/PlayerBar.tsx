import {
  Check,
  Heart,
  ListMusic,
  Maximize2,
  Mic2,
  PanelRight,
  Pause,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Share2,
  Shuffle,
  SkipBack,
  SkipForward,
  Video,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { AudioQuality, RepeatMode, RightPanelMode, Track } from '../types/music';
import { formatTime, QUALITY_LABELS } from '../utils/playerEngine';
import { CoverImage } from './CoverImage';
import { DownloadButton } from './DownloadButton';

interface PlayerBarProps {
  currentTrack: Track | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  shuffle: boolean;
  repeatMode: RepeatMode;
  isLiked: boolean;
  isDownloaded: boolean;
  isDownloading: boolean;
  volume: number;
  quality: AudioQuality;
  lyricsOpen: boolean;
  rightPanelMode: RightPanelMode;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onToggleLike: () => void;
  onShare: () => void;
  onToggleLyrics: () => void;
  onToggleRightPanel: (target: Exclude<RightPanelMode, 'closed'>) => void;
  onOpenExpanded: () => void;
  onOpenVideo: () => void;
  onSeek: (seconds: number) => void;
  onVolumeChange: (val: number) => void;
  onCycleQuality: () => void;
  onDownload: () => void;
}

export function PlayerBar({
  currentTrack,
  isPlaying,
  currentTime,
  duration,
  shuffle,
  repeatMode,
  isLiked,
  isDownloaded,
  isDownloading,
  volume,
  quality,
  lyricsOpen,
  rightPanelMode,
  onTogglePlay,
  onPrev,
  onNext,
  onToggleShuffle,
  onCycleRepeat,
  onToggleLike,
  onShare,
  onToggleLyrics,
  onToggleRightPanel,
  onOpenExpanded,
  onOpenVideo,
  onSeek,
  onVolumeChange,
  onCycleQuality,
  onDownload,
}: PlayerBarProps) {
  const safeDuration = duration > 0 ? duration : currentTrack?.duration || 200;
  const progressPct = Math.min(100, Math.max(0, (currentTime / safeDuration) * 100));

  return (
    <footer aria-label="Musick playback bar" className="harmonia-player-shell z-30 shrink-0">
      {/* Mobile Spotify Floating Mini-Player Pill (tappable to expand into full player) */}
      <div className="mx-2 mb-1 overflow-hidden rounded-lg bg-[#222227] md:hidden">
        <div className="flex items-center gap-2.5 px-2.5 py-2">
          <button
            type="button"
            onClick={onOpenExpanded}
            aria-label="Expand mini player"
            className="flex min-w-0 flex-1 items-center gap-2.5 text-left focus:outline-none"
          >
            <CoverImage
              src={currentTrack?.image}
              alt={currentTrack?.name || 'Now Playing'}
              className="h-10 w-10 shrink-0 rounded object-cover"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-bold text-white">
                {currentTrack?.name || 'Kesariya'}
              </div>
              <div className="truncate text-[11px] text-zinc-300">
                {currentTrack?.artist || 'Arijit Singh, Pritam'}
              </div>
            </div>
          </button>

          <DownloadButton
            trackName={currentTrack?.name || 'current track'}
            downloaded={isDownloaded}
            downloading={isDownloading}
            onClick={onDownload}
            disabled={!currentTrack || currentTrack.offlineAvailable === false || currentTrack.sourceProvider === 'Jamendo'}
            disabledReason="This provider supports online listening only"
            size="xs"
          />

          <button
            type="button"
            onClick={onToggleLike}
            aria-label={isLiked ? 'Remove from Liked Songs (mini player)' : 'Save to Liked Songs (mini player)'}
            aria-pressed={isLiked}
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${
              isLiked ? 'text-[#1DB954]' : 'text-zinc-300 hover:text-white'
            }`}
          >
            {isLiked ? (
              <span className="grid h-5 w-5 place-items-center rounded-full bg-[#1DB954] text-black">
                <Check className="h-3 w-3 stroke-[3]" />
              </span>
            ) : (
              <Heart className="h-4 w-4" />
            )}
          </button>

          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={isPlaying ? 'Pause mini player' : 'Play mini player'}
            className="grid h-8 w-8 shrink-0 place-items-center text-white"
          >
            {isPlaying ? (
              <Pause className="h-5 w-5 fill-current" />
            ) : (
              <Play className="h-5 w-5 fill-current pl-0.5" />
            )}
          </button>
        </div>

        {/* Bottom mini progress line inside Spotify mobile pill */}
        <div className="relative h-3 w-full touch-none bg-white/15">
          <div
            className="pointer-events-none absolute left-0 top-1/2 h-[2px] -translate-y-1/2 bg-white transition-[width] duration-150"
            style={{ width: `${progressPct}%` }}
          />
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round((progressPct / 100) * 1000)}
            aria-label="Playback progress"
            onChange={(e) => onSeek((Number(e.target.value) / 1000) * safeDuration)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </div>
      </div>

      {/* Desktop Spotify Edge-to-Edge Now Playing Bar */}
      <div className="hidden h-[84px] grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,1fr)] items-center gap-2 px-3 md:grid lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.25fr)_minmax(0,1.1fr)] lg:gap-3 lg:px-4 xl:grid-cols-[minmax(220px,1fr)_minmax(340px,1.45fr)_minmax(260px,1fr)]">
        {/* Left: Cover art (opens expanded view), Title, Artist, Spotify '+' / green Check */}
        <div className="flex min-w-0 items-center gap-2.5 lg:gap-3">
          <button
            type="button"
            onClick={onOpenExpanded}
            className="group relative h-12 w-12 shrink-0 overflow-hidden rounded bg-[#18181b] focus:outline-none lg:h-14 lg:w-14"
            aria-label="Open full-screen player"
            title="Expand player"
          >
            <CoverImage
              src={currentTrack?.image}
              alt={currentTrack?.name || 'Now Playing'}
              className="h-full w-full object-cover"
            />
            <span className="absolute inset-0 grid place-items-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
              <Maximize2 className="h-4 w-4 text-white" />
            </span>
          </button>

          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={onOpenExpanded}
              className="block max-w-full truncate text-left text-sm font-bold text-white hover:underline"
            >
              {currentTrack?.name || 'Kesariya'}
            </button>
            <div className="truncate text-xs text-zinc-400">
              {currentTrack?.artist || 'Arijit Singh, Pritam'}
              {currentTrack?.sourceAvailability === 'preview' && !isDownloaded && (
                <span className="ml-1.5 text-[10px] font-semibold text-amber-300/90">
                  · 30s preview
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onToggleLike}
            aria-label={isLiked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
            aria-pressed={isLiked}
            className={`ml-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full transition-transform hover:scale-105 ${
              isLiked
                ? 'bg-[#1DB954] text-black'
                : 'border border-zinc-400 text-zinc-300 hover:border-white hover:text-white'
            }`}
          >
            {isLiked ? <Check className="h-3.5 w-3.5 stroke-[3]" /> : <Plus className="h-3.5 w-3.5" />}
          </button>
        </div>

        {/* Center: Transport + Progress Bar */}
        <div className="flex min-w-0 flex-col items-center justify-center gap-1.5">
          <div className="flex items-center gap-2 lg:gap-3.5 xl:gap-4">
            <button
              type="button"
              onClick={onToggleShuffle}
              aria-label={shuffle ? 'Disable shuffle' : 'Enable shuffle'}
              aria-pressed={shuffle}
              className={`relative grid h-8 w-8 place-items-center transition-colors ${
                shuffle ? 'text-[#1DB954]' : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Shuffle className="h-4 w-4" />
              {shuffle && (
                <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-[#1DB954]" />
              )}
            </button>

            <button
              type="button"
              onClick={onPrev}
              aria-label="Previous track"
              className="grid h-8 w-8 place-items-center text-zinc-300 transition-colors hover:text-white"
            >
              <SkipBack className="h-[18px] w-[18px] fill-current" />
            </button>

            <button
              type="button"
              onClick={onTogglePlay}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              className="grid h-9 w-9 place-items-center rounded-full bg-white text-black transition-transform hover:scale-105 active:scale-95"
            >
              {isPlaying ? (
                <Pause className="h-4 w-4 fill-current" />
              ) : (
                <Play className="h-4 w-4 fill-current pl-0.5" />
              )}
            </button>

            <button
              type="button"
              onClick={onNext}
              aria-label="Next track"
              className="grid h-8 w-8 place-items-center text-zinc-300 transition-colors hover:text-white"
            >
              <SkipForward className="h-[18px] w-[18px] fill-current" />
            </button>

            <button
              type="button"
              onClick={onCycleRepeat}
              aria-label={
                repeatMode === 0
                  ? 'Enable repeat all'
                  : repeatMode === 1
                    ? 'Enable repeat one'
                    : 'Disable repeat'
              }
              aria-pressed={repeatMode > 0}
              className={`relative grid h-8 w-8 place-items-center transition-colors ${
                repeatMode > 0 ? 'text-[#1DB954]' : 'text-zinc-400 hover:text-white'
              }`}
            >
              {repeatMode === 2 ? (
                <Repeat1 className="h-4 w-4" />
              ) : (
                <Repeat className="h-4 w-4" />
              )}
              {repeatMode > 0 && (
                <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-[#1DB954]" />
              )}
            </button>
          </div>

          <div className="group/bar flex w-full max-w-[540px] items-center gap-2 text-[11px] text-zinc-400">
            <span className="font-mono-num w-8 shrink-0 text-right lg:w-9">{formatTime(currentTime)}</span>

            <div className="relative flex min-w-0 flex-1 items-center">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white transition-colors group-hover/bar:bg-[#1DB954]"
                style={{ width: `${progressPct}%` }}
              />
              <label htmlFor="sp-seek-bar" className="sr-only">
                Playback progress
              </label>
              <input
                id="sp-seek-bar"
                type="range"
                min={0}
                max={1000}
                value={Math.round((progressPct / 100) * 1000)}
                onChange={(e) => onSeek((Number(e.target.value) / 1000) * safeDuration)}
                className="sp-range relative z-10 w-full"
              />
            </div>

            <span className="font-mono-num w-8 shrink-0 lg:w-9">{formatTime(safeDuration)}</span>
          </div>
        </div>

        {/* Right: Now Playing View, Lyrics Mic, Queue, Video, Share, Download, Quality, Volume, Fullscreen */}
        <div className="flex min-w-0 items-center justify-end gap-0.5 lg:gap-1 xl:gap-1.5">
          <button
            type="button"
            onClick={() => onToggleRightPanel('nowplaying')}
            aria-label="Toggle Now Playing sidebar"
            aria-pressed={rightPanelMode === 'nowplaying'}
            title="Now Playing view"
            className={`shrink-0 p-1 transition-colors lg:p-1.5 ${
              rightPanelMode === 'nowplaying' ? 'text-[#1DB954]' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <PanelRight className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={onToggleLyrics}
            aria-label="Toggle Lyrics view"
            aria-pressed={lyricsOpen}
            title="Lyrics"
            className={`shrink-0 p-1 transition-colors lg:p-1.5 ${
              lyricsOpen ? 'text-[#1DB954]' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Mic2 className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => onToggleRightPanel('queue')}
            aria-label="Toggle Queue sidebar"
            aria-pressed={rightPanelMode === 'queue'}
            title="Queue"
            className={`shrink-0 p-1 transition-colors lg:p-1.5 ${
              rightPanelMode === 'queue' ? 'text-[#1DB954]' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <ListMusic className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={onOpenVideo}
            aria-label="Watch music video"
            title="Music video"
            className="hidden shrink-0 p-1.5 text-zinc-400 transition-colors hover:text-white lg:inline-flex"
          >
            <Video className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={onShare}
            aria-label="Share track"
            title="Share"
            className="hidden shrink-0 p-1.5 text-zinc-400 transition-colors hover:text-white xl:inline-flex"
          >
            <Share2 className="h-4 w-4" />
          </button>

          <DownloadButton
            trackName={currentTrack?.name || 'current track'}
            downloaded={isDownloaded}
            downloading={isDownloading}
            onClick={onDownload}
            disabled={!currentTrack || currentTrack.offlineAvailable === false || currentTrack.sourceProvider === 'Jamendo'}
            disabledReason="This provider supports online listening only"
            size="xs"
            className="mx-0.5 lg:mx-1"
          />

          <button
            type="button"
            onClick={onCycleQuality}
            aria-label="Cycle audio quality"
            className="hidden shrink-0 font-mono-num rounded border border-white/15 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-300 hover:border-white hover:text-white lg:inline-flex"
          >
            {QUALITY_LABELS[quality]}
          </button>

          <div className="flex shrink-0 items-center gap-1 lg:gap-1.5">
            <button
              type="button"
              onClick={() => onVolumeChange(volume === 0 ? 85 : 0)}
              aria-label={volume === 0 ? 'Unmute audio' : 'Mute audio'}
              className="shrink-0 p-1 text-zinc-400 hover:text-white"
            >
              {volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <div className="group/bar relative flex w-12 items-center lg:w-16 xl:w-20">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white group-hover/bar:bg-[#1DB954]"
                style={{ width: `${volume}%` }}
              />
              <label htmlFor="sp-vol-slider" className="sr-only">
                Volume
              </label>
              <input
                id="sp-vol-slider"
                type="range"
                min={0}
                max={100}
                value={volume}
                onChange={(e) => onVolumeChange(Number(e.target.value))}
                className="sp-range relative z-10 w-full"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenExpanded}
            aria-label="Expand full screen player"
            title="Full screen player"
            className="shrink-0 p-1 text-zinc-400 transition-colors hover:text-white lg:p-1.5"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </footer>
  );
}
