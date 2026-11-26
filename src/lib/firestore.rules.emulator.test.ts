import assert from 'node:assert/strict';
import fs from 'node:fs';
import test, { after, before, beforeEach } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';

let env: RulesTestEnvironment;

// Match the named Firestore database used by firebase-applet-config.json.
const TEST_DATABASE_ID = 'ai-studio-harmonia-3a784f23-51f6-4abd-a2b2-b3a4b19fc834';

const track = {
  id: 'track_1',
  name: 'Example Song',
  artist: 'Example Artist',
  albumName: 'Example Album',
  duration: 210,
  image: 'https://example.com/cover.jpg',
};

function profile(uid: string) {
  return {
    uid,
    schemaVersion: 2,
    displayName: 'Listener',
    region: 'IN',
    preferredLanguages: [],
    favoriteArtists: [],
    preferredMoods: [],
    prioritizeLyrics: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

function playlist(uid: string) {
  return {
    uid,
    id: 'playlist_1',
    schemaVersion: 2,
    name: 'Test Playlist',
    description: '',
    image: '',
    trackCount: 2,
    orderIndex: 0,
    updatedAtMs: Date.now(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

function entry(uid: string, entryId: string, position: number) {
  return {
    uid,
    entryId,
    playlistId: 'playlist_1',
    position,
    schemaVersion: 2,
    track,
    addedAtMs: Date.now(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-musick',
    firestore: {
      rules: fs.readFileSync('firestore.rules', 'utf8'),
    },
  });
});

beforeEach(async () => {
  await env.clearFirestore(TEST_DATABASE_ID);
});

after(async () => {
  await env.cleanup();
});

test('a signed-in listener can create and read only their own profile', async () => {
  const alice = env.authenticatedContext('alice').firestore(TEST_DATABASE_ID);
  await assertSucceeds(setDoc(doc(alice, 'users/alice'), profile('alice')));
  await assertSucceeds(getDoc(doc(alice, 'users/alice')));

  const bob = env.authenticatedContext('bob').firestore(TEST_DATABASE_ID);
  await assertFails(getDoc(doc(bob, 'users/alice')));
  await assertFails(setDoc(doc(bob, 'users/alice'), profile('alice')));
});

test('unauthenticated access to user data is denied', async () => {
  const guest = env.unauthenticatedContext().firestore(TEST_DATABASE_ID);
  await assertFails(getDoc(doc(guest, 'users/alice')));
  await assertFails(setDoc(doc(guest, 'users/alice'), profile('alice')));
});

test('playlist parents and ordered duplicate track entries can be written by their owner', async () => {
  const alice = env.authenticatedContext('alice_playlist').firestore(TEST_DATABASE_ID);
  await assertSucceeds(setDoc(doc(alice, 'users/alice_playlist'), profile('alice_playlist')));
  await assertSucceeds(setDoc(doc(alice, 'users/alice_playlist/playlists/playlist_1'), playlist('alice_playlist')));

  // Same track ID is allowed at distinct entry IDs/positions; order and duplicates are preserved.
  await assertSucceeds(setDoc(doc(alice, 'users/alice_playlist/playlists/playlist_1/entries/e_0_track_1'), entry('alice_playlist', 'e_0_track_1', 0)));
  await assertSucceeds(setDoc(doc(alice, 'users/alice_playlist/playlists/playlist_1/entries/e_1_track_1'), entry('alice_playlist', 'e_1_track_1', 1)));

  const entries = await assertSucceeds(
    getDocs(query(
      collection(alice, 'users/alice_playlist/playlists/playlist_1/entries'),
      where('uid', '==', 'alice_playlist')
    ))
  );
  assert.equal(entries.size, 2);
  assert.deepEqual(entries.docs.map((item) => item.data().position).sort(), [0, 1]);
});

test('another account cannot read or write a listener playlist or its entries', async () => {
  const alice = env.authenticatedContext('alice_owner').firestore(TEST_DATABASE_ID);
  await assertSucceeds(setDoc(doc(alice, 'users/alice_owner'), profile('alice_owner')));
  await assertSucceeds(setDoc(doc(alice, 'users/alice_owner/playlists/playlist_1'), playlist('alice_owner')));

  const bob = env.authenticatedContext('bob_owner').firestore(TEST_DATABASE_ID);
  await assertFails(getDoc(doc(bob, 'users/alice_owner/playlists/playlist_1')));
  await assertFails(setDoc(doc(bob, 'users/alice_owner/playlists/playlist_1/entries/e_0_track_1'), entry('bob_owner', 'e_0_track_1', 0)));
});

test('track documents containing transient stream URLs are rejected', async () => {
  const alice = env.authenticatedContext('alice_sanitized').firestore(TEST_DATABASE_ID);
  await assertSucceeds(setDoc(doc(alice, 'users/alice_sanitized'), profile('alice_sanitized')));
  const invalidTrack = { ...track, previewUrl: 'https://example.com/temporary.mp3' };
  await assertFails(setDoc(doc(alice, 'users/alice_sanitized/likedSongs/track_1'), {
    uid: 'alice',
    id: 'track_1',
    schemaVersion: 2,
    track: invalidTrack,
    likedAtMs: Date.now(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
});

test('playlist collection queries must constrain results to the signed-in owner', async () => {
  const alice = env.authenticatedContext('alice_query').firestore(TEST_DATABASE_ID);
  await assertSucceeds(setDoc(doc(alice, 'users/alice_query'), profile('alice_query')));
  await assertSucceeds(setDoc(doc(alice, 'users/alice_query/playlists/playlist_1'), playlist('alice_query')));

  await assertSucceeds(
    getDocs(query(collection(alice, 'users/alice_query/playlists'), where('uid', '==', 'alice_query')))
  );
  await assertFails(getDocs(collection(alice, 'users/alice_query/playlists')));
});
