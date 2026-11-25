import assert from 'node:assert/strict';
import fs from 'node:fs';
import test, { after, before } from 'node:test';
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

after(async () => {
  await env.cleanup();
});

test('a signed-in listener can create and read only their own profile', async () => {
  const alice = env.authenticatedContext('alice').firestore();
  await assertSucceeds(setDoc(doc(alice, 'users/alice'), profile('alice')));
  await assertSucceeds(getDoc(doc(alice, 'users/alice')));

  const bob = env.authenticatedContext('bob').firestore();
  await assertFails(getDoc(doc(bob, 'users/alice')));
  await assertFails(setDoc(doc(bob, 'users/alice'), profile('alice')));
});

test('unauthenticated access to user data is denied', async () => {
  const guest = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(guest, 'users/alice')));
  await assertFails(setDoc(doc(guest, 'users/alice'), profile('alice')));
});

test('playlist parents and ordered duplicate track entries can be written by their owner', async () => {
  const alice = env.authenticatedContext('alice').firestore();
  await assertSucceeds(setDoc(doc(alice, 'users/alice'), profile('alice')));
  await assertSucceeds(setDoc(doc(alice, 'users/alice/playlists/playlist_1'), playlist('alice')));

  // Same track ID is allowed at distinct entry IDs/positions; order and duplicates are preserved.
  await assertSucceeds(setDoc(doc(alice, 'users/alice/playlists/playlist_1/entries/e_0_track_1'), entry('alice', 'e_0_track_1', 0)));
  await assertSucceeds(setDoc(doc(alice, 'users/alice/playlists/playlist_1/entries/e_1_track_1'), entry('alice', 'e_1_track_1', 1)));

  const entries = await assertSucceeds(
    getDocs(query(
      collection(alice, 'users/alice/playlists/playlist_1/entries'),
      where('uid', '==', 'alice')
    ))
  );
  assert.equal(entries.size, 2);
  assert.deepEqual(entries.docs.map((item) => item.data().position).sort(), [0, 1]);
});

test('another account cannot read or write a listener playlist or its entries', async () => {
  const alice = env.authenticatedContext('alice').firestore();
  await assertSucceeds(setDoc(doc(alice, 'users/alice'), profile('alice')));
  await assertSucceeds(setDoc(doc(alice, 'users/alice/playlists/playlist_1'), playlist('alice')));

  const bob = env.authenticatedContext('bob').firestore();
  await assertFails(getDoc(doc(bob, 'users/alice/playlists/playlist_1')));
  await assertFails(setDoc(doc(bob, 'users/alice/playlists/playlist_1/entries/e_0_track_1'), entry('bob', 'e_0_track_1', 0)));
});

test('track documents containing transient stream URLs are rejected', async () => {
  const alice = env.authenticatedContext('alice').firestore();
  await assertSucceeds(setDoc(doc(alice, 'users/alice'), profile('alice')));
  const invalidTrack = { ...track, previewUrl: 'https://example.com/temporary.mp3' };
  await assertFails(setDoc(doc(alice, 'users/alice/likedSongs/track_1'), {
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
  const alice = env.authenticatedContext('alice').firestore();
  await assertSucceeds(setDoc(doc(alice, 'users/alice'), profile('alice')));
  await assertSucceeds(setDoc(doc(alice, 'users/alice/playlists/playlist_1'), playlist('alice')));

  await assertSucceeds(
    getDocs(query(collection(alice, 'users/alice/playlists'), where('uid', '==', 'alice')))
  );
  await assertFails(getDocs(collection(alice, 'users/alice/playlists')));
});
