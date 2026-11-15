import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTrackStreams } from './musicApi.ts';
import type { Track } from '../types/music.ts';

const staleTrack: Track = {
  id: 'stale-stream-test',
  name: 'Roots',
  artist: 'Bintu Pabra',
  albumName: 'Single',
  duration: 263,
  image: '/cover.jpg',
  streamUrls: { '320kbps': 'https://old.example.com/expired.mp3' },
};

test('forced stream refresh bypasses the client cache and replaces stale URLs', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requestedUrl = String(input);
    return new Response(
      JSON.stringify({
        ok: true,
        streamUrls: { '160kbps': 'https://new.example.com/roots.mp3' },
        previewUrl: 'https://preview.example.com/roots.m4a',
        alternates: ['https://new.example.com/roots-alt.mp3'],
        youtubeId: 'abcdefghijk',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  try {
    const refreshed = await resolveTrackStreams(staleTrack, { forceRefresh: true });
    assert.match(requestedUrl, /refresh=1/);
    assert.equal(refreshed.streamUrls?.['320kbps'], undefined);
    assert.equal(refreshed.streamUrls?.['160kbps'], 'https://new.example.com/roots.mp3');
    assert.equal(refreshed.youtubeId, 'abcdefghijk');
    assert.deepEqual(refreshed.alternates, ['https://new.example.com/roots-alt.mp3']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('forced stream refresh clears stale URLs when no replacement source is found', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: false, streamUrls: {}, alternates: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;

  try {
    const refreshed = await resolveTrackStreams(staleTrack, { forceRefresh: true });
    assert.equal(refreshed.streamUrls, undefined);
    assert.equal(refreshed.previewUrl, undefined);
    assert.equal(refreshed.youtubeId, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
