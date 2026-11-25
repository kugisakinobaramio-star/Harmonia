import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { Track } from '../types/music';
import { sanitizeTrackForCloud } from './cloudSanitizer';

const RULES_PATH = path.resolve(process.cwd(), 'firestore.rules');
const RULES_TEXT = fs.readFileSync(RULES_PATH, 'utf8');

function extractBlock(text: string, marker: string): string {
  const idx = text.indexOf(marker);
  assert.notEqual(idx, -1, `Expected rule block "${marker}" to exist in firestore.rules`);
  return text.slice(idx, idx + 1800);
}

test('firestore.rules enforces global default deny and strict owner isolation on every collection', () => {
  assert.match(RULES_TEXT, /match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}/);
  assert.match(RULES_TEXT, /function isOwner\(userId\) \{\s*return isSignedIn\(\) && request\.auth\.uid == userId;\s*\}/);
  assert.match(RULES_TEXT, /match \/users\/\{userId\}[\s\S]*allow list: if false;/);

  for (const collectionName of [
    'playlists/{playlistId}',
    'entries/{entryId}',
    'likedSongs/{trackDocId}',
    'recentHistory/{trackDocId}',
    'playedTracks/{trackDocId}',
    'tasteStats/{statId}',
    'followedArtists/{artistDocId}',
  ]) {
    const block = extractBlock(RULES_TEXT, `match /${collectionName}`);
    assert.match(block, /allow get: if isOwner\(userId\)/, `${collectionName} get must require owner`);
    assert.match(
      block,
      /allow list: if isOwner\(userId\)[\s\S]*existing\(\)\.uid == request\.auth\.uid/,
      `${collectionName} list must check existing().uid == request.auth.uid`
    );
    assert.match(block, /allow create: if isOwner\(userId\)/, `${collectionName} create must require owner`);
    assert.match(block, /allow update: if isOwner\(userId\)/, `${collectionName} update must require owner`);
    assert.match(block, /allow delete: if isOwner\(userId\)/, `${collectionName} delete must require owner`);
  }
});

test('firestore.rules validates immutable fields, server timestamps, and forbidden credential/stream fields', () => {
  assert.match(RULES_TEXT, /incoming\(\)\.createdAt == request\.time/);
  assert.match(RULES_TEXT, /incoming\(\)\.updatedAt == request\.time/);
  assert.match(RULES_TEXT, /incoming\(\)\.uid == existing\(\)\.uid/);
  assert.match(RULES_TEXT, /incoming\(\)\.createdAt == existing\(\)\.createdAt/);

  const trackSchemaBlock = extractBlock(RULES_TEXT, 'function isValidSanitizedTrack(t)');
  assert.match(trackSchemaBlock, /t\.keys\(\)\.hasAll\(/);
  assert.match(trackSchemaBlock, /t\.keys\(\)\.hasOnly\(/);
  assert.equal(trackSchemaBlock.includes("'streamUrls'"), false);
  assert.equal(trackSchemaBlock.includes("'previewUrl'"), false);
  assert.equal(trackSchemaBlock.includes("'youtubeId'"), false);
  assert.equal(trackSchemaBlock.includes("'lyrics'"), false);

  // Confirm sanitized client payload satisfies the rule whitelist
  const clean = sanitizeTrackForCloud({
    id: 'jio_1',
    name: 'Kesariya',
    artist: 'Arijit Singh',
    albumName: 'Brahmastra',
    duration: 268,
    image: 'https://c.saavncdn.com/191/Brahmastra.jpg',
    streamUrls: { '320kbps': 'https://ephemeral.example.com/1.mp4' },
    previewUrl: 'https://ephemeral.example.com/preview.mp3',
    youtubeId: 'BddP6PYo2gs',
  } as Track);

  const allowedKeys = new Set([
    'id', 'name', 'artist', 'albumName', 'year', 'duration', 'playCount',
    'image', 'language', 'region', 'genre', 'bpm', 'energy', 'moods',
    'hasLyrics', 'metadataOnly', 'sourceProvider', 'sourceAvailability',
    'sourcePageUrl', 'sourceLicense', 'offlineAvailable', 'synthMood',
  ]);
  for (const key of Object.keys(clean)) {
    assert.equal(allowedKeys.has(key), true, `Unexpected field "${key}" in sanitized track`);
  }
});
