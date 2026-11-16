import assert from 'node:assert/strict';
import test from 'node:test';
import type { Track } from '../types/music';
import { getAudioProviderPriority, partitionStreamCandidates } from './streamCandidates.ts';

const baseTrack: Track = {
  id: 'dz-2936968281',
  name: 'propose',
  artist: '9Lana',
  albumName: 'propose',
  duration: 234,
  image: 'https://cdn-images.dzcdn.net/images/cover/example/500x500.jpg',
  previewUrl: 'https://cdnt-preview.dzcdn.net/api/1/1/b/d/0/0/propose.mp3',
  sourceProvider: 'Deezer',
  sourceAvailability: 'preview',
};

test('partitionStreamCandidates isolates 30s previews from full streams', () => {
  const onlyPreview = partitionStreamCandidates(
    baseTrack,
    '320kbps',
    ['https://audio-ssl.itunes.apple.com/itunes-assets/sample.m4a'],
    (url) => url
  );
  assert.equal(onlyPreview.full.length, 0);
  assert.deepEqual(onlyPreview.preview, [
    '/api/music/audio?url=' + encodeURIComponent(baseTrack.previewUrl!),
    baseTrack.previewUrl!,
    '/api/music/audio?url=' + encodeURIComponent('https://audio-ssl.itunes.apple.com/itunes-assets/sample.m4a'),
    'https://audio-ssl.itunes.apple.com/itunes-assets/sample.m4a',
  ]);
});

test('partitionStreamCandidates prefers full-length streams and keeps previews as fallback', () => {
  const mixed = partitionStreamCandidates(
    {
      ...baseTrack,
      streamUrls: {
        '320kbps': 'https://aac.saavncdn.com/123/propose_320.mp4',
      },
      sourceAvailability: 'full',
    },
    '320kbps',
    [baseTrack.previewUrl!],
    (url) => url
  );
  assert.deepEqual(mixed.full, [
    '/api/music/audio?url=' + encodeURIComponent('https://aac.saavncdn.com/123/propose_320.mp4'),
    'https://aac.saavncdn.com/123/propose_320.mp4',
  ]);
  assert.deepEqual(mixed.preview, [
    '/api/music/audio?url=' + encodeURIComponent(baseTrack.previewUrl!),
    baseTrack.previewUrl!,
  ]);
});


test('audio provider priority preserves JioSaavn first and keeps SoundCloud as a last-resort fallback', () => {
  const makeTrack = (sourceProvider: string): Track => ({
    ...baseTrack,
    sourceProvider,
    streamUrls: { '160kbps': `https://audio.example.com/${sourceProvider}.m4a` },
  });

  const priorities = ['JioSaavn', 'Audius', 'Jamendo', 'Funkwhale', 'SoundCloud']
    .map((provider) => getAudioProviderPriority(makeTrack(provider)));

  assert.deepEqual(priorities, [50, 40, 30, 20, 10]);
  assert.ok(getAudioProviderPriority(makeTrack('JioSaavn')) > getAudioProviderPriority(makeTrack('SoundCloud')));
});

test('preview-only and metadata-only tracks never win provider deduplication priority', () => {
  assert.equal(getAudioProviderPriority({ ...baseTrack, sourceProvider: 'JioSaavn' }), 0);
  assert.equal(getAudioProviderPriority({
    ...baseTrack,
    sourceProvider: 'SoundCloud',
    streamUrls: { '160kbps': 'https://audio.example.com/full.m4a' },
    metadataOnly: true,
  }), 10);
});
