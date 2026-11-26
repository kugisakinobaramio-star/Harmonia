import type { Track } from '../types/music';

export interface MusicTasteVector {
  genres: Record<string, number>;
  moods: Record<string, number>;
  artists: Record<string, number>;
  energy: number | null;
  bpm: number | null;
  languageCounts: Record<string, number>;
  sampleSize: number;
}

export interface AIRecommendation {
  track: Track;
  score: number;
  confidence: number;
  reason: string;
  signals: string[];
}

