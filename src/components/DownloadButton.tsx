import { ArrowDown, Loader2 } from 'lucide-react';

interface DownloadButtonProps {
  trackName: string;
  downloaded: boolean;
  downloading: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  size?: 'xs' | 'sm' | 'md';
  variant?: 'circle' | 'pill';
  className?: string;
}

export function DownloadButton({
  trackName,
  downloaded,
  downloading,
  onClick,
  size = 'sm',
  variant = 'circle',
  className = '',
}: DownloadButtonProps) {
  const boxSize =
    size === 'xs'
      ? 'h-6 w-6'
      : size === 'md'
        ? 'h-9 w-9'
        : 'h-7 w-7';
  const iconSize =
    size === 'xs'
      ? 'h-3 w-3'
      : size === 'md'
        ? 'h-4 w-4'
        : 'h-3.5 w-3.5';

  const label = downloading
    ? `Downloading ${trackName}`
    : downloaded
      ? `Remove ${trackName} from downloads`
      : `Download ${trackName} for offline listening`;

  if (variant === 'pill') {
    return (
      <button
        type="button"
        disabled={downloading}
        onClick={(e) => {
          e.stopPropagation();
          onClick(e);
        }}
        aria-label={label}
        aria-pressed={downloaded}
        title={label}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition-all disabled:opacity-60 ${
          downloaded
            ? 'border-[#1DB954] bg-[#1DB954]/15 text-[#1DB954] hover:bg-[#1DB954]/25'
            : 'border-white/15 bg-white/[0.06] text-zinc-200 hover:border-white hover:text-white'
        } ${className}`}
      >
        {downloading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#1DB954]" />
        ) : (
          <span
            className={`grid h-4 w-4 place-items-center rounded-full ${
              downloaded ? 'bg-[#1DB954] text-black' : 'border border-zinc-400 text-zinc-300'
            }`}
          >
            <ArrowDown className="h-2.5 w-2.5 stroke-[2.6]" />
          </span>
        )}
        <span>{downloading ? 'Downloading…' : downloaded ? 'Downloaded' : 'Download'}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={downloading}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      aria-label={label}
      aria-pressed={downloaded}
      title={label}
      className={`grid shrink-0 place-items-center rounded-full transition-transform hover:scale-105 disabled:cursor-wait ${boxSize} ${
        downloaded
          ? 'bg-[#1DB954] text-black shadow-sm'
          : downloading
            ? 'border border-[#1DB954] bg-black/50 text-[#1DB954]'
            : 'border border-zinc-400/70 bg-black/40 text-zinc-200 hover:border-white hover:text-white'
      } ${className}`}
    >
      {downloading ? (
        <Loader2 className={`${iconSize} animate-spin`} />
      ) : (
        <ArrowDown className={`${iconSize} stroke-[2.5]`} />
      )}
    </button>
  );
}
