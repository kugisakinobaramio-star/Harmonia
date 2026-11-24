import type { Track } from '../types/music';

const normalize = (value?: string) => (value || '').toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim();
const primaryArtist = (track: Track) => normalize(track.artist.split(/,|&|\bfeat\.?\b|\bft\.?\b|\bwith\b/i)[0]);

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
