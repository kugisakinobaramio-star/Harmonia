import type { Track } from '../types/music';
import type { AIRecommendation, MusicTasteVector } from './types';

const STOP_WORDS = new Set(['music', 'song', 'songs', 'official', 'audio', 'video', 'album', 'single']);

function tokens(value?: string | string[]): string[] {
  const values = Array.isArray(value) ? value : [value || ''];
  return values.flatMap((entry) => entry.toLowerCase().normalize('NFKC')
    .split(/[^\p{L}\p{N}]+/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 1 && !STOP_WORDS.has(part)));
}

function addWeights(target: Record<string, number>, values: string[], weight: number) {
  for (const value of values) target[value] = (target[value] || 0) + weight;
}

function normalizeWeights(source: Record<string, number>): Record<string, number> {
  const max = Math.max(1, ...Object.values(source));
  return Object.fromEntries(Object.entries(source).map(([key, value]) => [key, value / max]));
}

export interface TasteGuidance { preferredMoods?: string[]; favoriteArtists?: string[]; preferredLanguages?: string[]; genreAffinity?: Record<string, number>; artistAffinity?: Record<string, number>; playCounts?: Record<string, number>; targetMood?: string; }

export function buildMusicTasteVector(liked: Track[], recent: Track[], guidance: TasteGuidance = {}): MusicTasteVector {
  const genres: Record<string, number> = {};
  const moods: Record<string, number> = {};
  const artists: Record<string, number> = {};
  const languageCounts: Record<string, number> = {};
  let energyTotal = 0, energyWeight = 0, bpmTotal = 0, bpmWeight = 0;
  const addTrack = (track: Track, weight: number) => {
    addWeights(genres, tokens(track.genre), weight);
    addWeights(moods, tokens(track.moods || []), weight);
    addWeights(moods, tokens(track.synthMood), weight * 0.7);
    addWeights(artists, tokens(track.artist), weight * 0.45);
    if (track.language) languageCounts[track.language] = (languageCounts[track.language] || 0) + weight;
    if (typeof track.energy === 'number' && Number.isFinite(track.energy)) {
      energyTotal += track.energy * weight; energyWeight += weight;
    }
    if (typeof track.bpm === 'number' && track.bpm > 0) {
      bpmTotal += track.bpm * weight; bpmWeight += weight;
    }
  };
  liked.forEach((track) => addTrack(track, 3));
  recent.forEach((track, index) => addTrack(track, Math.max(0.35, 1.4 - index * 0.07)));
  addWeights(moods, tokens(guidance.preferredMoods || []), 0.65);
  addWeights(artists, tokens(guidance.favoriteArtists || []), 0.65);
  for (const language of guidance.preferredLanguages || []) languageCounts[language] = (languageCounts[language] || 0) + 0.25;
  for (const [genre, count] of Object.entries(guidance.genreAffinity || {})) addWeights(genres, tokens(genre), Math.log1p(Math.max(0, count)) * 0.35);
  for (const [artist, count] of Object.entries(guidance.artistAffinity || {})) addWeights(artists, tokens(artist), Math.log1p(Math.max(0, count)) * 0.25);
  if (guidance.targetMood) addWeights(moods, tokens(guidance.targetMood), 1.5);
  return {
    genres: normalizeWeights(genres),
    moods: normalizeWeights(moods),
    artists: normalizeWeights(artists),
    energy: energyWeight ? energyTotal / energyWeight : null,
    bpm: bpmWeight ? bpmTotal / bpmWeight : null,
    languageCounts,
    sampleSize: liked.length + recent.length,
  };
}

function weightedOverlap(values: string[], preferences: Record<string, number>): number {
  if (!values.length || !Object.keys(preferences).length) return 0;
  const unique = [...new Set(values)];
  return unique.reduce((sum, value) => sum + (preferences[value] || 0), 0) / Math.sqrt(unique.length);
}

export function explainMusicSimilarity(track: Track, taste: MusicTasteVector): { score: number; confidence: number; reason: string; signals: string[] } {
  const genres = tokens(track.genre);
  const moods = [...tokens(track.moods || []), ...tokens(track.synthMood)];
  const artists = tokens(track.artist);
  const genreScore = weightedOverlap(genres, taste.genres);
  const moodScore = weightedOverlap(moods, taste.moods);
  const artistScore = weightedOverlap(artists, taste.artists);
  const signals: string[] = [];
  let score = genreScore * 0.43 + moodScore * 0.37 + artistScore * 0.12;
  let knownSignals = 0;
  if (genres.length) { knownSignals++; if (genreScore > 0.05) signals.push('related genre'); }
  if (moods.length) { knownSignals++; if (moodScore > 0.05) signals.push('similar mood'); }
  if (artists.length) { knownSignals++; if (artistScore > 0.05) signals.push('artist connection'); }
  if (taste.energy !== null && typeof track.energy === 'number') {
    score += Math.max(0, 1 - Math.abs(taste.energy - track.energy)) * 0.05;
    knownSignals++;
    if (Math.abs(taste.energy - track.energy) < 0.18) signals.push('similar energy');
  }
  if (taste.bpm !== null && typeof track.bpm === 'number') {
    score += Math.max(0, 1 - Math.abs(taste.bpm - track.bpm) / 90) * 0.03;
    knownSignals++;
    if (Math.abs(taste.bpm - track.bpm) < 12) signals.push('similar tempo');
  }
  // Language is intentionally excluded from musical similarity. It is only
  // used later to encourage cross-language exploration.
  const confidence = Math.min(0.95, knownSignals / 4 * 0.9 + (taste.sampleSize ? 0.05 : 0));
  const reason = signals.length
    ? `Because it shares ${signals.slice(0, 2).join(' and ')} with music you've enjoyed.`
    : 'A fresh discovery selected to broaden your music taste.';
  return { score, confidence, reason, signals };
}

export function curateAIRecommendations(
  candidates: Track[],
  liked: Track[],
  recent: Track[],
  limit = 40,
  guidance: TasteGuidance = {},
): AIRecommendation[] {
  const taste = buildMusicTasteVector(liked, recent, guidance);
  const likedIds = new Set(liked.map((track) => track.id));
  const recentIds = new Set(recent.slice(0, 3).map((track) => track.id));
  const ranked = candidates
    .filter((track) => track.id && !likedIds.has(track.id) && !recentIds.has(track.id))
    .map((track) => {
      const result = explainMusicSimilarity(track, taste);
      const popularity = Math.min(0.04, Math.log10(Math.max(1, track.playCount || 1)) / 100);
      const exploration = result.confidence < 0.25 ? 0.08 : 0;
      const repeatPenalty = Math.min(0.12, Math.log1p(Math.max(0, guidance.playCounts?.[track.id] || 0)) * 0.025);
      const targetMoodMatch = guidance.targetMood
        ? weightedOverlap([...tokens(track.moods || []), ...tokens(track.synthMood), ...tokens(track.genre)], Object.fromEntries(tokens(guidance.targetMood).map((token) => [token, 1])))
        : 0;
      const moodBoost = guidance.targetMood ? targetMoodMatch * 0.24 : 0;
      const signals = [...result.signals];
      if (targetMoodMatch > 0.05 && guidance.targetMood) signals.unshift(`fits ${guidance.targetMood}`);
      return { track, score: result.score + popularity + exploration + moodBoost - repeatPenalty, confidence: result.confidence, reason: signals.length ? `Selected for ${signals.slice(0, 2).join(' and ')}.` : result.reason, signals };
    })
    .sort((a, b) => b.score - a.score);
  const selected: AIRecommendation[] = [];
  const artistCounts = new Map<string, number>();
  const languageCounts = new Map<string, number>();
  for (const item of ranked) {
    const artistKey = tokens(item.track.artist).join(' ');
    if ((artistCounts.get(artistKey) || 0) >= 2) continue;
    // Soft language diversification: language never increases similarity score.
    const languageKey = item.track.language || 'unknown';
    const languagePenalty = (languageCounts.get(languageKey) || 0) * 0.012;
    selected.push({ ...item, score: Math.max(0, item.score - languagePenalty) });
    artistCounts.set(artistKey, (artistCounts.get(artistKey) || 0) + 1);
    languageCounts.set(languageKey, (languageCounts.get(languageKey) || 0) + 1);
    if (selected.length >= limit) break;
  }
  return selected.sort((a, b) => b.score - a.score);
}
