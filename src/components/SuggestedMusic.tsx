import { ListPlus, Plus, Sparkles } from 'lucide-react';
import { useMemo } from 'react';
import type { Track } from '../types/music';
import { rankSuggestedMusic } from '../utils/suggestedMusic';
import { CoverImage } from './CoverImage';

interface SuggestedMusicProps {
  title: string;
  description: string;
  sourceTracks: Track[];
  candidates: Track[];
  onPlay: (track: Track) => void;
  onEnqueue: (track: Track) => void;
  onAddToPlaylist: (track: Track) => void;
}

export { rankSuggestedMusic } from '../utils/suggestedMusic';

export function SuggestedMusic({ title, description, sourceTracks, candidates, onPlay, onEnqueue, onAddToPlaylist }: SuggestedMusicProps) {
  const suggestions = useMemo(() => rankSuggestedMusic(sourceTracks, candidates), [sourceTracks, candidates]);

  return (
    <section aria-label={title}>
      <div className="mb-3 flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[#86dba4]" />
        <div className="min-w-0">
          <h3 className="text-sm font-extrabold text-white">{title}</h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-400">{description}</p>
        </div>
      </div>
      {suggestions.length === 0 ? (
        <p className="rounded-lg border border-white/10 bg-black/20 px-3 py-3 text-xs text-zinc-400">
          Still learning this sound. Play or add a few more tracks with genre or mood details to unlock better matches.
        </p>
      ) : (
        <div className="flex snap-x gap-3 overflow-x-auto pb-2">
          {suggestions.map((track) => (
            <article key={track.id} className="w-36 shrink-0 snap-start rounded-lg bg-white/[0.04] p-2 transition-colors hover:bg-white/[0.08] sm:w-40">
              <button type="button" onClick={() => onPlay(track)} className="group block w-full text-left" aria-label={`Play suggested track ${track.name} by ${track.artist}`}>
                <div className="relative overflow-hidden rounded-md">
                  <CoverImage src={track.image} alt={track.name} className="aspect-square w-full object-cover transition-transform group-hover:scale-105" />
                  <span className="absolute bottom-2 right-2 grid h-8 w-8 place-items-center rounded-full bg-[#1DB954] text-black shadow-lg"><span className="text-sm">▶</span></span>
                </div>
                <div className="mt-2 truncate text-xs font-bold text-white">{track.name}</div>
                <div className="truncate text-[11px] text-zinc-400">{track.artist}</div>
                <div className="mt-1 truncate text-[10px] text-[#86dba4]">{track.language || track.genre || 'Similar sound'}</div>
              </button>
              <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-1.5">
                <button type="button" onClick={() => onEnqueue(track)} aria-label={`Add ${track.name} to queue`} title="Add to queue" className="rounded p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white"><ListPlus className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => onAddToPlaylist(track)} aria-label={`Add ${track.name} to playlist`} title="Add to playlist" className="rounded p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white"><Plus className="h-3.5 w-3.5" /></button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
