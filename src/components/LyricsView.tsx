import { useEffect, useRef } from 'react';
import type { LyricLine, Track } from '../types/music';
import { formatTime, resolveActiveLyricPair } from '../utils/playerEngine';
import { CoverImage } from './CoverImage';

interface LyricsViewProps {
  track: Track | null;
  lyrics: LyricLine[];
  lyricsSynced: boolean;
  currentTime: number;
  duration: number;
  onSeekTo: (seconds: number) => void;
}

export function LyricsView({
  track,
  lyrics,
  lyricsSynced,
  currentTime,
  duration,
  onSeekTo,
}: LyricsViewProps) {
  const activeLineRef = useRef<HTMLButtonElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const { activeIndex } = track
    ? resolveActiveLyricPair(lyrics, currentTime, duration)
    : { activeIndex: -1 };

  // Keep hooks unconditional: the player can move between an empty queue and
  // an active track without changing the number/order of hooks in this component.
  useEffect(() => {
    if (track && activeLineRef.current) {
      activeLineRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [activeIndex, track?.id]);

  if (!track) {
    return (
      <div className="rounded-lg bg-[#161619] p-8 text-center text-sm text-zinc-400">
        Play any song to view synced lyrics.
      </div>
    );
  }

  return (
    <section
      aria-label="Full canvas synced lyrics"
      className="min-h-[calc(100vh-220px)] rounded-lg bg-gradient-to-b from-[#1f2421] via-[#141715] to-[#121212] p-6 sm:p-10"
    >
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center gap-4 border-b border-white/[0.08] pb-5">
          <CoverImage
            src={track.image}
            alt={track.name}
            className="h-16 w-16 shrink-0 rounded-md object-cover shadow-xl"
          />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold uppercase tracking-wider text-[#1DB954]">
              {lyricsSynced ? 'Time-Synced Lyrics' : 'Lyrics'}
            </div>
            <h1 className="truncate text-2xl font-extrabold text-white">{track.name}</h1>
            <p className="truncate text-sm text-zinc-300">
              {track.artist} · {track.albumName}
            </p>
          </div>
        </div>

        {lyrics.length === 0 ? (
          <p className="text-base text-zinc-400">
            Lyrics unavailable for this recording. Try another vocal track in Hindi, English, or J-Pop.
          </p>
        ) : (
          <div ref={containerRef} className="space-y-4 py-12">
            {lyrics.map((line, idx) => {
              const isActive = idx === activeIndex;
              const isPast = idx < activeIndex;
              return (
                <button
                  key={`${idx}-${line.time}`}
                  ref={isActive ? activeLineRef : null}
                  type="button"
                  onClick={() => onSeekTo(line.time)}
                  className={`group flex w-full items-baseline gap-4 rounded-xl px-4 py-3 text-left transition-all duration-300 hover:bg-white/[0.06] ${
                    isActive
                      ? 'scale-[1.02] bg-white/[0.08] text-white shadow-lg'
                      : isPast
                        ? 'text-zinc-500 hover:text-zinc-200'
                        : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <span className="font-mono-num w-11 shrink-0 text-xs text-zinc-500 group-hover:text-zinc-300">
                    {formatTime(line.time)}
                  </span>
                  <span
                    className={`text-xl font-bold leading-relaxed sm:text-2xl transition-colors ${
                      isActive ? 'text-[#1DB954]' : ''
                    }`}
                  >
                    {line.text}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
