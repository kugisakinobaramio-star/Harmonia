import assert from 'node:assert/strict';
import test from 'node:test';
import type { CuratedPlaylist, Track } from '../types/music';
import {
  sanitizeAffinityMap,
  sanitizeFeedbackMap,
  sanitizeFollowedArtistForCloud,
  sanitizeTrackForCloud,
  toFirestoreDocId,
} from './cloudSanitizer';
import {
  computeMigrationDiff,
  createEmptySnapshot,
  createLocalBackup,
  enqueueSyncTask,
  getSyncQueue,
  hasDueSyncTask,
  listLocalBackups,
  loadAccountCache,
  loadGuestSnapshot,
  markSyncFailure,
  markSyncSuccess,
  mergeMusicSnapshots,
  mergePlaylistEntriesPreservingOrderAndDuplicates,
  restoreLocalBackup,
  saveAccountCache,
  saveGuestSnapshot,
  type MusicKKLocalSnapshot,
  type StorageLike,
} from './syncEngine';

class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

function makeTrack(id: string, overrides: Partial<Track> = {}): Track {
  return {
    id,
    name: `Song ${id}`,
    artist: `Artist ${id}`,
    albumName: `Album ${id}`,
    duration: 215,
    image: `https://c.saavncdn.com/${id}.jpg`,
    language: 'Hindi',
    genre: 'Pop',
    streamUrls: { '320kbps': 'https://ephemeral-stream.example.com/audio.mp4?token=secret' },
    previewUrl: 'https://ephemeral-preview.example.com/preview.mp3',
    youtubeId: 'dQw4w9WgXcQ',
    youtubeAlternates: ['abc12345678'],
    lyrics: [{ time: 0, text: 'La la la' }],
    ...overrides,
  };
}

test('cloudSanitizer strips temporary stream URLs, YouTube IDs, lyrics, and maps arbitrary IDs safely', () => {
  const dirty = makeTrack('mb-rec:abc/123.xyz');
  const clean = sanitizeTrackForCloud(dirty);

  assert.equal('streamUrls' in clean, false);
  assert.equal('previewUrl' in clean, false);
  assert.equal('youtubeId' in clean, false);
  assert.equal('youtubeAlternates' in clean, false);
  assert.equal('lyrics' in clean, false);
  assert.equal(clean.id, 'mb-rec:abc/123.xyz');
  assert.equal(clean.name, dirty.name);

  const docA = toFirestoreDocId('mb-rec:abc/123');
  const docB = toFirestoreDocId('mb-rec_abc_123');
  assert.match(docA, /^[a-zA-Z0-9_-]{1,128}$/);
  assert.match(docB, /^[a-zA-Z0-9_-]{1,128}$/);
  assert.notEqual(docA, docB, 'Distinct raw IDs must never collide after sanitization');
});

test('cloudSanitizer bounds taste affinity and feedback maps to Firestore rule limits', () => {
  const hugeArtists: Record<string, number> = {};
  const hugeFeedback: Record<string, { skips: number; completions: number }> = {};
  for (let i = 0; i < 250; i++) {
    hugeArtists[`Artist ${i}`] = i + 1;
    hugeFeedback[`track-${i}`] = { skips: 1, completions: i + 1 };
  }
  assert.equal(Object.keys(sanitizeAffinityMap(hugeArtists, 100)).length, 100);
  assert.equal(Object.keys(sanitizeFeedbackMap(hugeFeedback, 200)).length, 200);
});

test('Guest mode retains local library without Firebase and saves recoverable backups', () => {
  const storage = new MemoryStorage();
  const track1 = makeTrack('t1');
  const guest: MusicKKLocalSnapshot = {
    ...createEmptySnapshot(),
    displayName: 'Aarav',
    likedMap: { t1: track1 },
    playlists: [
      {
        id: 'guest-pl-1',
        name: 'Road Trip',
        description: 'Guest playlist',
        image: track1.image,
        tracks: [track1],
        isUserCreated: true,
      },
    ],
  };

  saveGuestSnapshot(guest, storage);
  const loaded = loadGuestSnapshot(storage);
  assert.ok(loaded);
  assert.equal(loaded.displayName, 'Aarav');
  assert.equal(loaded.playlists?.length, 1);
  assert.equal(loaded.likedMap?.t1.streamUrls, undefined);

  const backup = createLocalBackup(guest, 'Before login', null, storage, 1700000000000);
  const all = listLocalBackups(storage);
  assert.equal(all.length, 1);
  assert.equal(all[0].summary.playlists, 1);
  assert.equal(all[0].summary.likedSongs, 1);

  const restored = restoreLocalBackup(backup.id, storage);
  assert.ok(restored);
  assert.equal(restored.playlists?.[0]?.name, 'Road Trip');
});

test('Migration diff flags first-time merge preview accurately', () => {
  const t1 = makeTrack('t1');
  const t2 = makeTrack('t2');
  const local: MusicKKLocalSnapshot = {
    ...createEmptySnapshot(),
    displayName: 'Local Listener',
    likedMap: { t1 },
    playlists: [{ id: 'pl-1', name: 'Gym', description: '', image: '', tracks: [t1] }],
  };
  const cloud: MusicKKLocalSnapshot = {
    ...createEmptySnapshot(),
    displayName: 'Cloud Listener',
    likedMap: { t1, t2 },
    playlists: [
      { id: 'pl-1', name: 'Gym', description: '', image: '', tracks: [t1, t2] },
      { id: 'pl-2', name: 'Chill', description: '', image: '', tracks: [t2] },
    ],
  };

  const diff = computeMigrationDiff(local, cloud);
  assert.equal(diff.needsPreview, true);
  assert.equal(diff.overlappingPlaylists.length, 1);
  assert.equal(diff.overlappingLikedCount, 1);
  assert.equal(diff.cloudOnlyPlaylists, 1);
});

test('Playlist merging preserves exact order AND intentional duplicates while preventing redundant playlist copies', () => {
  const t1 = makeTrack('t1');
  const t2 = makeTrack('t2');
  const t3 = makeTrack('t3');

  // Playlist intentionally contains [t1, t2, t1]
  const mergedTracks = mergePlaylistEntriesPreservingOrderAndDuplicates(
    [t1, t2, t1],
    [t1, t2, t3]
  );
  assert.deepEqual(
    mergedTracks.map((t) => t.id),
    ['t1', 't2', 't1', 't3']
  );

  const local: MusicKKLocalSnapshot = {
    ...createEmptySnapshot(),
    updatedAtMs: 2000,
    playlists: [
      {
        id: 'pl-local-id',
        name: 'Late Night',
        description: '',
        image: '',
        sourcePageUrl: 'https://open.spotify.com/playlist/xyz',
        tracks: [t1, t2, t1],
      } as CuratedPlaylist,
    ],
  };
  const cloud: MusicKKLocalSnapshot = {
    ...createEmptySnapshot(),
    updatedAtMs: 1000,
    playlists: [
      {
        id: 'pl-cloud-id',
        name: 'late night',
        description: 'Cloud copy',
        image: '',
        sourcePageUrl: 'https://open.spotify.com/playlist/xyz',
        tracks: [t1, t2, t3],
      } as CuratedPlaylist,
    ],
  };

  const merged = mergeMusicSnapshots(local, cloud, { mode: 'merge', nowMs: 3000 });
  assert.equal(merged.playlists?.length, 1, 'Duplicate playlists with same name+sourcePageUrl must collapse into one');
  assert.deepEqual(
    merged.playlists?.[0]?.tracks.map((t) => t.id),
    ['t1', 't2', 't1', 't3']
  );
});

test('Conflict handling respects newer delete tombstones and combines play counts', () => {
  const t1 = makeTrack('t1');
  const t2 = makeTrack('t2');

  const local: MusicKKLocalSnapshot = {
    ...createEmptySnapshot(),
    updatedAtMs: 5000,
    likedMap: { t2 },
    likedTimestamps: { t2: 4000 },
    deletedPlaylistIds: { 'pl-old': 5000 },
    deletedLikedIds: { t1: 5000 },
    playCounts: { t1: 4, t2: 9 },
    playlists: [],
  };

  const cloud: MusicKKLocalSnapshot = {
    ...createEmptySnapshot(),
    updatedAtMs: 3000,
    likedMap: { t1, t2 },
    likedTimestamps: { t1: 2000, t2: 2000 },
    playlistUpdatedAtMs: { 'pl-old': 2000 },
    playCounts: { t1: 12, t2: 3 },
    playlists: [{ id: 'pl-old', name: 'Old Mix', description: '', image: '', tracks: [t1] }],
  };

  const merged = mergeMusicSnapshots(local, cloud, { mode: 'merge', nowMs: 6000 });
  assert.equal(merged.playlists?.some((p) => p.id === 'pl-old'), false);
  assert.equal(Boolean(merged.likedMap?.t1), false);
  assert.equal(Boolean(merged.likedMap?.t2), true);
  assert.equal(merged.playCounts?.t1, 12);
  assert.equal(merged.playCounts?.t2, 9);
});

test('Offline durable sync queue tracks retries with exponential backoff and clears on success', () => {
  const storage = new MemoryStorage();
  const uid = 'user-offline-1';

  enqueueSyncTask(uid, 'like-track', storage, 1000);
  assert.equal(getSyncQueue(uid, storage).length, 1);
  assert.equal(hasDueSyncTask(uid, storage, 1000), true);

  const failed1 = markSyncFailure(uid, 'network-request-failed', storage, 2000);
  assert.ok(failed1);
  assert.equal(failed1.attempts, 1);
  assert.equal(failed1.nextAttemptAtMs, 4000);
  assert.equal(hasDueSyncTask(uid, storage, 3000), false);
  assert.equal(hasDueSyncTask(uid, storage, 4000), true);

  const failed2 = markSyncFailure(uid, 'unavailable', storage, 4000);
  assert.ok(failed2);
  assert.equal(failed2.attempts, 2);
  assert.equal(failed2.nextAttemptAtMs, 9000);

  markSyncSuccess(uid, storage);
  assert.equal(getSyncQueue(uid, storage).length, 0);
});

test('Account switching isolates caches so Account A private data never leaks into Account B', () => {
  const storage = new MemoryStorage();
  const privateTrackA = makeTrack('secret-a');
  const privateTrackB = makeTrack('secret-b');

  saveAccountCache('uid-A', {
    ...createEmptySnapshot(),
    displayName: 'User A',
    likedMap: { 'secret-a': privateTrackA },
  }, storage);

  saveAccountCache('uid-B', {
    ...createEmptySnapshot(),
    displayName: 'User B',
    likedMap: { 'secret-b': privateTrackB },
  }, storage);

  const cacheA = loadAccountCache('uid-A', storage);
  const cacheB = loadAccountCache('uid-B', storage);

  assert.ok(cacheA?.likedMap?.['secret-a']);
  assert.equal(cacheA?.likedMap?.['secret-b'], undefined);
  assert.ok(cacheB?.likedMap?.['secret-b']);
  assert.equal(cacheB?.likedMap?.['secret-a'], undefined);
});

test('followedArtists cloud sanitizer and snapshot merge respect unfollow tombstones and dedupe names', () => {
  const sanitized = sanitizeFollowedArtistForCloud({
    id: 'art-arijit',
    name: '  Arijit Singh  ',
    image: 'https://example.com/arijit.jpg',
    genre: 'Bollywood',
    followedAtMs: 5000,
  });
  assert.equal(sanitized.name, 'Arijit Singh');
  assert.equal(sanitized.followedAtMs, 5000);

  const local: MusicKKLocalSnapshot = {
    ...createEmptySnapshot(),
    updatedAtMs: 8000,
    followedArtists: {
      'art-shreya': {
        id: 'art-shreya',
        name: 'Shreya Ghoshal',
        image: 'https://example.com/shreya.jpg',
        followedAtMs: 8000,
      },
    },
    deletedFollowedArtistIds: {
      'art-arijit': 7000,
      'name:arijit singh': 7000,
    },
  };

  const cloud: MusicKKLocalSnapshot = {
    ...createEmptySnapshot(),
    updatedAtMs: 6000,
    followedArtists: {
      'art-arijit': {
        id: 'art-arijit',
        name: 'Arijit Singh',
        image: 'https://example.com/arijit.jpg',
        followedAtMs: 4000,
      },
      'saavn-art:shreya': {
        id: 'saavn-art:shreya',
        name: 'Shreya Ghoshal',
        image: 'https://example.com/shreya2.jpg',
        followedAtMs: 5000,
      },
    },
  };

  const merged = mergeMusicSnapshots(local, cloud, { mode: 'merge', nowMs: 9000 });
  assert.equal(Boolean(merged.followedArtists?.['art-arijit']), false);
  assert.equal(Object.keys(merged.followedArtists || {}).length, 1);
  assert.equal(merged.followedArtists?.['art-shreya']?.name, 'Shreya Ghoshal');
});
