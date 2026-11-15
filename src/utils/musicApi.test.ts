import assert from 'node:assert/strict';
import test from 'node:test';
import { preserveTrackAfterFailedRefresh } from './streamRefresh.ts';

test('failed refresh preserves all last-known-good source metadata', () => {
  const track = {
    id: 'refresh-failure-regression',
    name: 'BIRDS OF A FEATHER',
    artist: 'Billie Eilish',
    streamUrls: { '320kbps': 'https://audio.example.com/original.m4a' },
    previewUrl: 'https://audio.example.com/preview.m4a',
    youtubeId: 'original-video-id',
    youtubeAlternates: ['alternate-video-id'],
    provider: 'saavn',
  };

  const preserved = preserveTrackAfterFailedRefresh(track);
  assert.strictEqual(preserved, track);
  assert.deepEqual(preserved.streamUrls, track.streamUrls);
  assert.equal(preserved.previewUrl, track.previewUrl);
  assert.equal(preserved.youtubeId, track.youtubeId);
  assert.deepEqual(preserved.youtubeAlternates, track.youtubeAlternates);
  assert.equal(preserved.provider, 'saavn');
});
