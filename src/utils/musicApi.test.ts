import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTrackStreams } from './musicApi.ts';
import type { Track } from '../types/music.ts';

function makeTrack(id: string): Track {
  return {
    id,
    name: 'Test Song',
    artist: 'Test Artist',
    albumName: 'Test Album',
    duration: 210,
    image: '/test.jpg',
    language: 'English',
    region: 'GLOBAL',
    genre: 'Pop',
    hasLyrics: true,
  };
}

test('resolveTrackStreams shares one in-flight lookup for concurrent requests', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    await Promise.resolve();
    return new Response(JSON.stringify({
      ok: true,
      streamUrls: { '320kbps': 'https://audio.example.test/test.mp3' },
      alternates: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  try {
    const track = makeTrack('resolver-coalesce-test');
    const [first, second] = await Promise.all([
      resolveTrackStreams(track),
      resolveTrackStreams(track),
    ]);
    assert.equal(calls, 1);
    assert.equal(first.streamUrls?.['320kbps'], 'https://audio.example.test/test.mp3');
    assert.equal(second.streamUrls?.['320kbps'], 'https://audio.example.test/test.mp3');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('resolveTrackStreams briefly caches failed lookups to avoid provider request storms', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ ok: false }), { status: 503 });
  }) as typeof fetch;

  try {
    const track = makeTrack('resolver-negative-cache-test');
    await resolveTrackStreams(track);
    await resolveTrackStreams(track);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
