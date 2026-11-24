import assert from 'node:assert/strict';
import test from 'node:test';
import type { Track } from '../types/music';
import { rankSuggestedMusic } from './suggestedMusic';

function track(id: string, overrides: Partial<Track> = {}): Track {
  return {
    id,
    name: `Track ${id}`,
    artist: `Artist ${id}`,
    albumName: 'Album',
    duration: 180,
    image: '',
    language: 'Hindi',
    genre: 'indie pop',
    ...overrides,
  };
}

test('suggestions prioritise shared sound metadata and exclude source tracks', () => {
  const source = track('source');
  const strongMatch = track('match', { language: 'Hindi', genre: 'indie pop' });
  const unrelated = track('unrelated', { language: 'Japanese', genre: 'metal' });
  const ranked = rankSuggestedMusic([source], [source, unrelated, strongMatch]);
  assert.deepEqual(ranked.map((item) => item.id), ['match']);
});

test('playlist recommendations blend metadata across multiple tracks', () => {
  const sources = [track('source-a', { language: 'Hindi', genre: 'indie pop' }), track('source-b', { language: 'Hindi', genre: 'indie pop' })];
  const match = track('match', { language: 'Hindi', genre: 'indie pop' });
  const otherLanguage = track('other-language', { language: 'Japanese', genre: 'indie pop' });
  const ranked = rankSuggestedMusic(sources, [match, otherLanguage]);
  assert.equal(ranked[0]?.id, 'match');
  assert.ok(!ranked.some((item) => item.id === 'source-a' || item.id === 'source-b'));
});

test('recommendations limit repeated artists', () => {
  const source = track('source');
  const candidates = [
    track('a1', { artist: 'Same Artist' }),
    track('a2', { artist: 'Same Artist' }),
    track('a3', { artist: 'Same Artist' }),
    track('b1', { artist: 'Another Artist' }),
  ];
  const ranked = rankSuggestedMusic([source], candidates);
  assert.ok(ranked.length <= 3);
  assert.equal(ranked.filter((item) => item.artist === 'Same Artist').length, 2);
});
