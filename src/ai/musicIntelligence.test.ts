import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMusicTasteVector, curateAIRecommendations, explainMusicSimilarity } from './musicIntelligence.ts';
import type { Track } from '../types/music.ts';

const track = (overrides: Partial<Track> = {}): Track => ({
  id: 'base', name: 'Track', artist: 'Artist', albumName: 'Album', duration: 200,
  image: '', ...overrides,
});

test('music taste vector learns genres and moods independently of language', () => {
  const liked = [track({ genre: 'indie pop', moods: ['romantic'], language: 'Hindi', energy: 0.5, bpm: 100 })];
  const taste = buildMusicTasteVector(liked, []);
  assert.ok(taste.genres.indie > 0);
  assert.ok(taste.moods.romantic > 0);
  assert.equal(taste.languageCounts.Hindi, 3);
});

test('cross-language tracks can be similar without language being a similarity signal', () => {
  const liked = [track({ id: 'liked', genre: 'indie pop', moods: ['dreamy', 'romantic'], language: 'Hindi' })];
  const candidate = track({ id: 'candidate', genre: 'indie pop', moods: ['dreamy', 'romantic'], language: 'Japanese' });
  const unrelated = track({ id: 'unrelated', genre: 'metal', moods: ['aggressive'], language: 'Hindi' });
  const taste = buildMusicTasteVector(liked, []);
  assert.ok(explainMusicSimilarity(candidate, taste).score > explainMusicSimilarity(unrelated, taste).score);
});

test('AI curation excludes recently played and liked tracks and diversifies artists', () => {
  const liked = [track({ id: 'liked', artist: 'A' })];
  const recent = [track({ id: 'recent', artist: 'B' })];
  const candidates = [
    ...Array.from({ length: 4 }, (_, i) => track({ id: 'a' + i, artist: 'Same Artist', genre: 'pop' })),
    track({ id: 'b', artist: 'Other Artist', genre: 'pop' }),
    ...liked, ...recent,
  ];
  const result = curateAIRecommendations(candidates, liked, recent, 20);
  assert.ok(!result.some((item) => item.track.id === 'liked' || item.track.id === 'recent'));
  assert.ok(result.filter((item) => item.track.artist === 'Same Artist').length <= 2);
});
