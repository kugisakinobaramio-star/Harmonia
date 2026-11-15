import { Heart, ListPlus, Play, Plus, Video } from 'lucide-react';
import type { Track } from '../types/music';
import { formatPlayCount, formatTime, hasFullAudioStream } from '../utils/playerEngine';
import { CoverImage } from './CoverImage';
import { DownloadButton } from './DownloadButton';

interface TrackRowProps {
  track: Track;
  index: number;
  isCurrent: boolean;
  isPlaying: boolean;
  isLiked: boolean;
  isDownloaded: boolean;
  isDownloading: boolean;
  onPlay: () => void;
  onEnqueue: () => void;
  onToggleLike: () => void;
  onToggleDownload: () => void;
  onAddToPlaylist: () => void;
  onOpenVideo: () => void;
}

export function TrackRow({
  track,
  index,
  isCurrent,
  isPlaying,
  isLiked,
  isDownloaded,
  isDownloading,
  onPlay,
  onEnqueue,
  onToggleLike,
  onToggleDownload,
  onAddToPlaylist,
  onOpenVideo,
}: TrackRowProps) {
  const playLabel = formatPlayCount(track.playCount);
  const sourceLabel =
    track.sourceAvailability === 'metadata' || track.metadataOnly
      ? 'Catalogue info only · source not confirmed'
      : track.sourceAvailability === 'preview'
        ? 'Preview only'
        : track.sourceAvailability === 'full' || hasFullAudioStream(track)
          ? 'Full stream listed'
          : 'Checks more sources when played';
  const sourceText = track.sourceProvider
    ? sourceLabel + ' · ' + track.sourceProvider
    : sourceLabel;
  const metaParts = [
    track.artist,
    track.albumName,
    track.language || '',
    playLabel ? `${playLabel} plays` : '',
  ].filter(Boolean);

  return (
    <div
      className={`group grid grid-cols-[28px_44px_1fr_auto] items-center gap-3 rounded-md px-3 py-2 transition-colors ${
        isCurrent ? 'bg-white/[0.1]' : 'hover:bg-white/[0.06]'
      }`}
    >
      <div className="font-mono-num text-center text-xs font-medium text-zinc-400">
        {isCurrent && isPlaying ? (
          <span className="text-[#1DB954]" aria-label="Now playing">
            ♫
          </span>
        ) : (
          index + 1
        )}
      </div>

      <button
        type="button"
        onClick={onPlay}
        aria-label={`Play ${track.name}`}
        className="relative h-11 w-11 overflow-hidden rounded bg-black"
      >
        <CoverImage
          src={track.image}
          alt={track.name}
          className="h-full w-full object-cover"
        />
        <span className="absolute inset-0 grid place-items-center bg-black/55 opacity-0 transition-opacity group-hover:opacity-100">
          <Play className="h-4 w-4 fill-white text-white" />
        </span>
      </button>

      <button type="button" onClick={onPlay} className="min-w-0 text-left focus:outline-none">
        <div
          className={`truncate text-sm font-semibold ${
            isCurrent ? 'text-[#1DB954]' : 'text-white'
          }`}
        >
          {track.name}
        </div>
        <div className="truncate text-xs text-zinc-400">{metaParts.join(' · ')}</div>
        <div
          className="truncate text-[10px] text-zinc-500"
          title={sourceText}
          aria-label={sourceText}
        >
          {sourceText}
        </div>
      </button>

      <div className="flex items-center gap-1 sm:gap-1.5">
        <span className="mr-1 hidden font-mono-num text-xs text-zinc-400 sm:inline">
          {track.duration > 0 ? formatTime(track.duration) : '—'}
        </span>

        <DownloadButton
          trackName={track.name}
          downloaded={isDownloaded}
          downloading={isDownloading}
          onClick={onToggleDownload}
          size="xs"
        />

        <button
          type="button"
          onClick={onToggleLike}
          aria-label={isLiked ? `Remove ${track.name} from liked songs` : `Like ${track.name}`}
          className={`grid h-8 w-8 place-items-center rounded-full transition-colors hover:bg-white/10 ${
            isLiked ? 'text-[#1DB954]' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Heart className={`h-4 w-4 ${isLiked ? 'fill-current' : ''}`} />
        </button>

        <button
          type="button"
          onClick={onEnqueue}
          aria-label={`Add ${track.name} to queue`}
          title="Add to queue"
          className="hidden h-8 w-8 place-items-center rounded-full text-zinc-400 transition-colors hover:bg-white/10 hover:text-white sm:grid"
        >
          <ListPlus className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={onAddToPlaylist}
          aria-label={`Add ${track.name} to playlist`}
          title="Add to playlist"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          <Plus className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={onOpenVideo}
          aria-label={`Watch music video for ${track.name}`}
          title="Watch video"
          className="hidden h-8 w-8 place-items-center rounded-full text-zinc-400 transition-colors hover:bg-white/10 hover:text-white md:grid"
        >
          <Video className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
