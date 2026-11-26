import assert from 'node:assert/strict';
import test from 'node:test';
import { mapSpotifyEmbedTrackList, type SpotifyEmbedTrackEntry } from './spotifyEmbed.ts';

const inferLanguage = () => 'Other' as const;

test('Spotify import preserves all 223 source entries in order', () => {
  const entries: SpotifyEmbedTrackEntry[] = Array.from({ length: 223 }, (_, index) => ({
    uri: `spotify:track:track-${index}`,
    title: `Song ${index}`,
    subtitle: 'Artist',
    duration: 180_000,
  }));

  const tracks = mapSpotifyEmbedTrackList(entries, 'playlist-223', 'Test Mix', 'cover.jpg', inferLanguage);
  assert.equal(tracks.length, 223);
  assert.equal(tracks[0].name, 'Song 0');
  assert.equal(tracks[222].name, 'Song 222');
});

test('Spotify import retains source-region inference', () => {
  const entries: SpotifyEmbedTrackEntry[] = [{ uri: 'spotify:track:india', title: 'Song', subtitle: 'Artist' }];
  const tracks = mapSpotifyEmbedTrackList(entries, 'playlist-india', 'Hindi Hits India', '', inferLanguage);
  assert.equal(tracks[0].region, 'IN');
});

test('Spotify import preserves duplicate track entries at distinct positions', () => {
  const entries: SpotifyEmbedTrackEntry[] = [
    { uri: 'spotify:track:same-id', title: 'Repeat', subtitle: 'Artist' },
    { uri: 'spotify:track:other-id', title: 'Other', subtitle: 'Artist' },
    { uri: 'spotify:track:same-id', title: 'Repeat', subtitle: 'Artist' },
  ];

  const tracks = mapSpotifyEmbedTrackList(entries, 'playlist-duplicates', 'Mix', '', inferLanguage);
  assert.equal(tracks.length, 3);
  assert.equal(tracks[0].id, tracks[2].id);
  assert.deepEqual(tracks.map((track) => track.name), ['Repeat', 'Other', 'Repeat']);
});

test('Spotify import retains unavailable and unplayable entries as metadata', () => {
  const entries: SpotifyEmbedTrackEntry[] = [
    { uri: 'spotify:track:unavailable', title: 'Unavailable', subtitle: 'Artist', isPlayable: false },
    { title: 'No URI entry', subtitle: 'Artist' },
    { uri: 'spotify:local:artist:album:title:180000', title: 'Local File', subtitle: 'Artist' },
  ];

  const tracks = mapSpotifyEmbedTrackList(entries, 'playlist-partial', 'Mix', '', inferLanguage);
  assert.equal(tracks.length, 2);
  assert.equal(tracks[0].sourceAvailability, 'lookup');
  assert.equal(tracks[1].id, 'sp-playlist-partial-entry-1');
  assert.equal(tracks[2].id, 'sp-playlist-partial-entry-2');
});
