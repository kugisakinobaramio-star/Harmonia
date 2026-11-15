import assert from 'node:assert/strict';
import test from 'node:test';

import { apiUrl } from './apiUrl';

test('keeps same-origin API paths when no API base is configured', () => {
  assert.equal(apiUrl('/api/music/search?query=test'), '/api/music/search?query=test');
});

test('normalizes relative API paths with a leading slash', () => {
  assert.equal(apiUrl('api/music/resolve'), '/api/music/resolve');
});

test('does not rewrite absolute URLs', () => {
  assert.equal(apiUrl('https://example.com/audio.mp3'), 'https://example.com/audio.mp3');
});
