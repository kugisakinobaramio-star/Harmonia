import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTrackStreams } from './musicApi.ts';
import type { Track } from '../types/music.ts';

test('failed forced stream refresh preserves last-known-good playback sources', async () => {
  const track: Track = {
    id: 'refresh-failure-regression',
    name: 'BIRDS OF A FEATHER',
    artist: 'Billie Eilish',
    albumName: 'HIT ME HARD AND SOFT',
    duration: 210,
    image: '/cover.jpg',
    language: 'English',
    region: 'US',
    genre: 'Pop',
    hasLyrics: true,
    streamUrls: { '320kbps': 'https://audio.example.com/original.m4a' },
    previewUrl: 'https://audio.example.com/original-preview.m4a',
    youtubeId: 'original-video-id',
    youtubeAlternates: ['alternate-video-id'],
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('upstream unavailable', { status: 503 });
  try {
    const refreshed = await resolveTrackStreams(track, { forceRefresh: true });
    assert.deepEqual(refreshed.streamUrls, track.streamUrls);
    assert.equal(refreshed.previewUrl, track.previewUrl);
    assert.equal(refreshed.youtubeId, track.youtubeId);
    assert.deepEqual(refreshed.youtubeAlternates, track.youtubeAlternates);
    assert.equal(refreshed.id, track.id);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
