import { ListPlus, Plus, Sparkles } from 'lucide-react';
import { useMemo } from 'react';
import type { Track } from '../types/music';
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

const normalize = (value?: string) => (value || '').toLocaleLowerCase().normalize('NFKD').replace(/[\\u0300-\\u036f]/g, '').trim();
const primaryArtist = (track: Track) => normalize(track.artist.split(/,|&|\\bfeat\\.?\\b|\\bft\\.?\\b|\\bwith\\b/i)[0]);

function similarityScore(candidate: Track, sources: Track[]): number {
  let score = 0;
  let evidence = 0;
  for (const source of sources) {
    let sourceScore = 0;
    if (source.genre && candidate.genre) {
      const sourceGenres = normalize(source.genre).split(/[,/&]/).map((v) => v.trim()).filter(Boolean);
      const candidateGenres = normalize(candidate.genre).split(/[,/&]/).map((v) => v.trim()).filter(Boolean);
      if (sourceGenres.some((genre) => candidateGenres.some((other) => genre === other || genre.includes(other) || other.includes(genre)))) sourceScore += 3.2;
      evidence += 1;
    }
    if (source.language && candidate.language) {
      sourceScore += source.language === candidate.language ? 2.4 : 0;
      evidence += 1;
    }
    if (source.synthMood && candidate.synthMood) {
      sourceScore += source.synthMood === candidate.synthMood ? 2.2 : 0;
      evidence += 1;
    }
    if (typeof source.bpm === 'number' && typeof candidate.bpm === 'number') {
      const gap = Math.abs(source.bpm - candidate.bpm);
      sourceScore += gap <= 8 ? 2.1 : gap <= 18 ? 1.2 : gap <= 30 ? 0.4 : 0;
      evidence += 1;
    }
    if (primaryArtist(source) && primaryArtist(source) === primaryArtist(candidate)) sourceScore += 0.55;
    score += sourceScore;
  }
  if (!sources.length) return 0;
  const average = score / sources.length;
  return evidence ? average : 0;
}

export function rankSuggestedMusic(sourceTracks: Track[], candidates: Track[]): Track[] {
  const sources = sourceTracks.filter(Boolean).slice(0, 12);
  if (!sources.length) return [];
  const excludedIds = new Set(sources.map((track) => track.id));
  const excludedNames = new Set(sources.map((track) => `${normalize(track.name)}::${primaryArtist(track)}`));
  const ranked = candidates
    .filter((track) => track && track.id && track.name && track.artist && !excludedIds.has(track.id))
    .filter((track) => !excludedNames.has(`${normalize(track.name)}::${primaryArtist(track)}`))
    .map((track) => ({ track, score: similarityScore(track, sources) }))
    .filter((item) => item.score >= 1.15)
    .sort((a, b) => b.score - a.score);

  const selected: Track[] = [];
  const artistCounts = new Map<string, number>();
  for (const item of ranked) {
    const artist = primaryArtist(item.track);
    if ((artistCounts.get(artist) || 0) >= 2) continue;
    selected.push(item.track);
    artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1);
    if (selected.length >= 8) break;
  }
  return selected;
}

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
