import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectDownloadCandidateUrls,
  formatStorageBytes,
  isCollectionFullyDownloaded,
  offlineItemToTrack,
  normalizeImportedAudioBlob,
  sanitizeDownloadFilename,
} from './offlineHelpers';

test('sanitizeDownloadFilename strips invalid filename characters cleanly', () => {
  assert.equal(
    sanitizeDownloadFilename('Kesariya / (Film): *Live*?', 'Arijit Singh'),
    'Arijit Singh - Kesariya (Film) Live'
  );
  assert.equal(sanitizeDownloadFilename('   '), 'harmonia-track');
});

test('formatStorageBytes formats KB and MB cleanly', () => {
  assert.equal(formatStorageBytes(0), '0 KB');
  assert.equal(formatStorageBytes(512000), '500 KB');
  assert.equal(formatStorageBytes(3 * 1024 * 1024), '3.0 MB');
});

test('collectDownloadCandidateUrls prefers full-length quality streams before previews and deduplicates', () => {
  const urls = collectDownloadCandidateUrls(
    {
      id: 't1',
      name: 'Kesariya',
      artist: 'Arijit Singh',
      albumName: 'Brahmastra',
      duration: 268,
      image: '',
      previewUrl: 'https://cdns-preview-a.dzcdn.net/stream/c-123.mp3',
      streamUrls: {
        '96kbps': 'https://aac.saavncdn.com/96.mp4',
        '320kbps': 'https://aac.saavncdn.com/320.mp4',
      },
      alternates: [
        'https://aac.saavncdn.com/320.mp4',
        'https://discoveryprovider.audius.co/v1/tracks/1/stream',
        'blob:http://localhost/local-only',
      ],
    },
    '320kbps'
  );

  assert.deepEqual(urls, [
    'https://aac.saavncdn.com/320.mp4',
    'https://aac.saavncdn.com/96.mp4',
    'https://discoveryprovider.audius.co/v1/tracks/1/stream',
    'https://cdns-preview-a.dzcdn.net/stream/c-123.mp3',
  ]);
});

test('isCollectionFullyDownloaded returns true only when every downloadable track in non-empty list is downloaded', () => {
  const downloaded = new Set(['a', 'b']);
  assert.equal(isCollectionFullyDownloaded([], downloaded), false);
  assert.equal(isCollectionFullyDownloaded([{ id: 'a' }, { id: 'b' }], downloaded), true);
  assert.equal(
    isCollectionFullyDownloaded(
      [{ id: 'a' }, { id: 'j1', offlineAvailable: false, sourceProvider: 'Jamendo' }],
      downloaded
    ),
    true
  );
  assert.equal(
    isCollectionFullyDownloaded(
      [{ id: 'j1', offlineAvailable: false, sourceProvider: 'Jamendo' }],
      downloaded
    ),
    false
  );
  assert.equal(
    isCollectionFullyDownloaded(
      [{ id: 'sc-1', offlineAvailable: false, sourceProvider: 'SoundCloud' }],
      new Set(['sc-1'])
    ),
    false
  );
  assert.equal(isCollectionFullyDownloaded([{ id: 'a' }, { id: 'c' }], downloaded), false);
});

test('offlineItemToTrack restores offline metadata with local object URL', () => {
  const blob = new Blob(['audio'], { type: 'audio/mpeg' });
  const track = offlineItemToTrack(
    {
      id: 'track-9',
      name: 'Night Drive',
      artist: 'Kavinsky',
      albumName: 'OutRun',
      image: '/cover.jpg',
      duration: 245,
      language: 'English',
      size: 5,
      blob,
    },
    'blob:http://localhost:3000/abc'
  );

  assert.equal(track.id, 'track-9');
  assert.equal(track.albumName, 'OutRun');
  assert.equal(track.language, 'English');
  assert.equal(track.streamUrls?.['320kbps'], 'blob:http://localhost:3000/abc');
});

test('normalizeImportedAudioBlob assigns a playable MIME type when file metadata is generic', () => {
  const unknownM4a = new Blob(['audio-bytes'], { type: 'application/octet-stream' });
  const normalized = normalizeImportedAudioBlob(unknownM4a, 'recording.m4a');
  assert.equal(normalized.type, 'audio/mp4');
  assert.equal(normalized.size, unknownM4a.size);

  const known = new Blob(['audio-bytes'], { type: 'audio/ogg' });
  assert.strictEqual(normalizeImportedAudioBlob(known, 'recording.opus'), known);
});
