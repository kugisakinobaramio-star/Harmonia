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

test('explicit preferences guide taste without making language a similarity feature', () => {
  const taste = buildMusicTasteVector([], [], {
    preferredMoods: ['romantic'],
    favoriteArtists: ['Arijit Singh'],
    preferredLanguages: ['Hindi'],
  });
  assert.ok(taste.moods.romantic > 0);
  assert.ok(taste.artists.arijit > 0);
  assert.equal(taste.languageCounts.Hindi, 0.25);
});

test('contextual mood mix promotes matching musical tags without language filtering', () => {
  const liked = [track({ id: 'liked', genre: 'pop', moods: ['romantic'] })];
  const romantic = track({ id: 'romantic', genre: 'pop', moods: ['romantic'], language: 'Japanese' });
  const energetic = track({ id: 'energetic', genre: 'pop', moods: ['energetic'], language: 'Hindi' });
  const result = curateAIRecommendations([energetic, romantic], liked, [], 10, { targetMood: 'romantic' });
  assert.equal(result[0].track.id, 'romantic');
});

test('repeat listening gradually reduces repeated-track recommendations', () => {
  const liked = [track({ id: 'liked', genre: 'pop', moods: ['romantic'] })];
  const candidates = [track({ id: 'often', genre: 'pop', moods: ['romantic'] }), track({ id: 'fresh', genre: 'pop', moods: ['romantic'] })];
  const result = curateAIRecommendations(candidates, liked, [], 10, { playCounts: { often: 100 } });
  assert.equal(result[0].track.id, 'fresh');
});


test('listening feedback learns from skips and completed listens', () => {
  const liked = [track({ id: 'seed', genre: 'indie pop', moods: ['dreamy'] })];
  const candidates = [track({ id: 'skipped', genre: 'indie pop', moods: ['dreamy'] }), track({ id: 'completed', genre: 'indie pop', moods: ['dreamy'] })];
  const neutral = curateAIRecommendations(candidates, liked, [], 10);
  const learned = curateAIRecommendations(candidates, liked, [], 10, {
    listeningFeedback: { skipped: { skips: 12, completions: 0 }, completed: { skips: 0, completions: 8 } },
  });
  assert.equal(neutral[0].track.id, 'skipped');
  assert.equal(learned[0].track.id, 'completed');
});

test('AI curation deduplicates identical track IDs across combined pools', () => {
  const liked = [track({ id: 'seed', genre: 'romantic', moods: ['romantic'] })];
  const kesariya = track({ id: 'hin-kesariya', name: 'Kesariya', artist: 'Arijit Singh', genre: 'romantic', moods: ['romantic'] });
  const result = curateAIRecommendations([kesariya, { ...kesariya }], liked, [], 10);
  assert.equal(result.filter((item) => item.track.id === 'hin-kesariya').length, 1);
});
