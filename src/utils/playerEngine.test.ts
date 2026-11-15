import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addTrackToPlaylist,
  cycleQuality,
  decodeHtmlEntities,
  extractSpotifySearchHint,
  filterAndRankTracks,
  formatPlayCount,
  formatTime,
  getGreetingForHour,
  hasFullAudioStream,
  isRemixOrKnockoff,
  isPlausibleSongDuration,
  isShortPreviewUrl,
  isSpotifyLinkOrUri,
  isUnnecessaryNoLyricsTrack,
  mapCoordsToRegion,
  parseLrcLyrics,
  parsePlainLyricsToLines,
  reorderQueueItem,
  resolveActiveLyricPair,
  resolveNextTrackIndex,
  scoreAuthenticTrackCandidate,
  scoreTrackForUser,
  selectStreamUrl,
  sortTracks,
  toggleTrackInLiked,
  toProxiedImageUrl,
} from './playerEngine.ts';
import type { CuratedPlaylist, Track, UserTasteProfile } from '../types/music.ts';

const sampleTracks: Track[] = [
  {
    id: 't1',
    name: 'Kesariya',
    artist: 'Arijit Singh, Pritam',
    albumName: 'Brahmastra',
    duration: 268,
    playCount: 620_000_000,
    image: '/cover1.jpg',
    language: 'Hindi',
    region: 'IN',
    genre: 'Bollywood Romance',
    hasLyrics: true,
    lyrics: [{ time: 0, text: 'Mujhko itna bataye koi' }],
  },
  {
    id: 't2',
    name: 'Blinding Lights',
    artist: 'The Weeknd',
    albumName: 'After Hours',
    duration: 200,
    playCount: 4_120_000_000,
    image: '/cover2.jpg',
    language: 'English',
    region: 'US',
    genre: 'Synthpop',
    hasLyrics: true,
    streamUrls: {
      '320kbps': 'https://cdn.example.com/t2-320.m4a',
      '160kbps': 'https://cdn.example.com/t2-160.m4a',
    },
  },
  {
    id: 't3',
    name: 'Idol',
    artist: 'YOASOBI',
    albumName: 'THE BOOK 3',
    duration: 213,
    playCount: 890_000_000,
    image: '/cover3.jpg',
    language: 'J-Pop',
    region: 'JP',
    genre: 'J-Pop',
    hasLyrics: true,
  },
  {
    id: 't4',
    name: 'Midnight Rain (Instrumental)',
    artist: 'Ambient Lab',
    albumName: 'No Vocal Sessions',
    duration: 180,
    playCount: 15_000,
    image: '/cover4.jpg',
    language: 'English',
    hasLyrics: false,
  },
];

test('formatTime and formatPlayCount format durations and billions cleanly', () => {
  assert.equal(formatTime(84), '1:24');
  assert.equal(formatTime(268), '4:28');
  assert.equal(formatPlayCount(4_120_000_000), '4.1B');
  assert.equal(formatPlayCount(620_000_000), '620M');
});

test('getGreetingForHour returns lowercase Spotify-style greeting', () => {
  assert.equal(getGreetingForHour(9), 'Good morning');
  assert.equal(getGreetingForHour(15), 'Good afternoon');
  assert.equal(getGreetingForHour(22), 'Good evening');
});

test('toProxiedImageUrl uses direct HTTPS for fast music CDNs and proxies unknown hosts', () => {
  assert.equal(toProxiedImageUrl('/assets/cover.jpg'), '/assets/cover.jpg');
  assert.equal(
    toProxiedImageUrl('https://c.saavncdn.com/123/art.jpg'),
    'https://c.saavncdn.com/123/art.jpg'
  );
  assert.equal(
    toProxiedImageUrl('https://unknown-host.example.com/cover.jpg'),
    '/api/music/image?url=https%3A%2F%2Funknown-host.example.com%2Fcover.jpg'
  );
  assert.equal(isSpotifyLinkOrUri('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'), true);
  assert.equal(isSpotifyLinkOrUri('spotify:track:0VjIjW4GlUZAMYd2vXMi3b'), true);
  assert.equal(isSpotifyLinkOrUri('Kesariya Arijit Singh'), false);
});

test('parseLrcLyrics parses synced LRC timestamps accurately', () => {
  const parsed = parseLrcLyrics('[00:12.50] First line\n[01:04.20] Second line\n[invalid] Skip');
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].time, 12.5);
  assert.equal(parsed[0].text, 'First line');
  assert.equal(parsed[1].time, 64.2);
});

test('isUnnecessaryNoLyricsTrack filters out instrumental and karaoke tracks', () => {
  assert.equal(isUnnecessaryNoLyricsTrack(sampleTracks[0]), false);
  assert.equal(isUnnecessaryNoLyricsTrack(sampleTracks[3]), true);
  assert.equal(
    isUnnecessaryNoLyricsTrack({ ...sampleTracks[1], name: 'Blinding Lights (Karaoke Version)' }),
    true
  );
});

test('filterAndRankTracks removes no-lyrics tracks when prioritizeLyrics is true', () => {
  const filtered = filterAndRankTracks(sampleTracks, '', { prioritizeLyrics: true });
  assert.equal(filtered.some((t) => t.id === 't4'), false);
  assert.equal(filtered.length, 3);

  const jpop = filterAndRankTracks(sampleTracks, '', { languageFilter: 'J-Pop' });
  assert.deepEqual(
    jpop.map((t) => t.id),
    ['t3']
  );
});

test('mapCoordsToRegion maps India, Japan, UK, US, and Global coordinates', () => {
  assert.equal(mapCoordsToRegion(19.076, 72.877), 'IN'); // Mumbai
  assert.equal(mapCoordsToRegion(35.676, 139.65), 'JP'); // Tokyo
  assert.equal(mapCoordsToRegion(51.507, -0.127), 'GB'); // London
  assert.equal(mapCoordsToRegion(40.712, -74.006), 'US'); // NYC
  assert.equal(mapCoordsToRegion(-33.868, 151.209), 'GLOBAL'); // Sydney
});

test('scoreTrackForUser ranks tracks by user affinity, region, and lyrics priority', () => {
  const profile: UserTasteProfile = {
    region: 'JP',
    preferredLanguages: ['J-Pop', 'Hindi', 'English'],
    artistAffinity: { YOASOBI: 4 },
    languageAffinity: { 'J-Pop': 5 },
    genreAffinity: { 'J-Pop': 3 },
    playCounts: {},
    likedIds: ['t3'],
    recentIds: [],
  };

  const sJpop = scoreTrackForUser(sampleTracks[2], profile);
  const sHindi = scoreTrackForUser(sampleTracks[0], profile);
  const sNoLyrics = scoreTrackForUser(sampleTracks[3], profile);

  assert.ok(sJpop > sHindi);
  assert.ok(sHindi > sNoLyrics);
  assert.ok(sNoLyrics < 0);
});

test('player controls, lyrics sync, quality selection, and sorting behave cleanly', () => {
  assert.equal(decodeHtmlEntities('Arijit &amp; Pritam'), 'Arijit & Pritam');
  assert.equal(cycleQuality('320kbps'), '160kbps');
  assert.equal(selectStreamUrl(sampleTracks[1], '160kbps'), 'https://cdn.example.com/t2-160.m4a');
  assert.equal(
    resolveNextTrackIndex({
      queueLength: 3,
      currentIndex: 2,
      direction: 1,
      shuffle: false,
      repeatMode: 1,
      autoAdvance: true,
    }),
    0
  );

  const plain = parsePlainLyricsToLines('Line 1\nLine 2', 60);
  assert.equal(resolveActiveLyricPair(plain, 35, 60).activeIndex, 1);

  assert.equal(extractSpotifySearchHint('https://open.spotify.com/track/abc123'), 'track hits');

  const sortedByDur = sortTracks(sampleTracks.slice(0, 3), 'duration');
  assert.deepEqual(
    sortedByDur.map((t) => t.id),
    ['t2', 't3', 't1']
  );

  const liked = toggleTrackInLiked({}, sampleTracks[0]);
  assert.equal(liked.added, true);
  const pl: CuratedPlaylist[] = [
    { id: 'p1', name: 'Favs', description: '', image: '', tracks: [] },
  ];
  assert.equal(addTrackToPlaylist(pl, 'p1', sampleTracks[0]).added, true);
  assert.equal(reorderQueueItem(sampleTracks.slice(0, 3), 0, 0, 2).currentIndex, 2);
});

test('isShortPreviewUrl and hasFullAudioStream distinguish 30s previews from full-length streams', () => {
  assert.equal(
    isShortPreviewUrl('https://p.scdn.co/mp3-preview/abc123?cid=999'),
    true
  );
  assert.equal(
    isShortPreviewUrl('https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview115/sample.m4a'),
    true
  );
  assert.equal(
    isShortPreviewUrl('https://cdnt-preview.dzcdn.net/api/1/1/abc.mp3'),
    true
  );
  assert.equal(
    isShortPreviewUrl('https://aac.saavncdn.com/123/full_320.mp4'),
    false
  );

  const previewOnlyTrack: Track = {
    ...sampleTracks[0],
    previewUrl: 'https://p.scdn.co/mp3-preview/abc123',
    streamUrls: undefined,
  };
  assert.equal(hasFullAudioStream(previewOnlyTrack), false);

  const fullStreamTrack: Track = {
    ...previewOnlyTrack,
    streamUrls: { '320kbps': 'https://aac.saavncdn.com/123/full_320.mp4' },
  };
  assert.equal(hasFullAudioStream(fullStreamTrack), true);
  assert.equal(hasFullAudioStream(sampleTracks[1]), true);
});

test('scoreTrackForUser boosts tracks matching explicit favoriteArtists and preferredMoods', () => {
  const baseProfile: UserTasteProfile = {
    region: 'GLOBAL',
    preferredLanguages: ['Hindi', 'English', 'J-Pop'],
    favoriteArtists: [],
    preferredMoods: [],
    artistAffinity: {},
    languageAffinity: {},
    genreAffinity: {},
    playCounts: {},
    likedIds: [],
    recentIds: [],
  };

  const personalisedProfile: UserTasteProfile = {
    ...baseProfile,
    favoriteArtists: ['YOASOBI'],
    preferredMoods: ['Anime & J-Pop'],
  };

  const baseScore = scoreTrackForUser(sampleTracks[2], baseProfile);
  const customScore = scoreTrackForUser(sampleTracks[2], personalisedProfile);
  assert.ok(customScore >= baseScore + 70);
});

test('isRemixOrKnockoff and scoreAuthenticTrackCandidate enforce original-artist authenticity', () => {
  // Rejects techno/nightcore/karaoke/DJ knockoffs
  assert.equal(isRemixOrKnockoff('Blinding Lights (Techno)', 'Blinding Lights', 'Error404', 'The Weeknd'), true);
  assert.equal(isRemixOrKnockoff('Alan Walker - Faded 2020 DjBlack', 'Faded', 'dr-robertino-dj', 'Alan Walker'), true);
  assert.equal(isRemixOrKnockoff('Kavinsky - Nightcall _ 432hz', 'Nightcall', 'bauti', 'Kavinsky'), true);
  assert.equal(isRemixOrKnockoff('Kesariya (Happy Diwali)', 'Kesariya', 'Arijit Singh', 'Arijit Singh'), true);

  // Allows authentic original artist & explicit DJ artist requests
  assert.equal(isRemixOrKnockoff('Blinding Lights', 'Blinding Lights', 'The Weeknd', 'The Weeknd'), false);
  assert.equal(isRemixOrKnockoff('Turn Down for What', 'Turn Down for What', 'DJ Snake', 'DJ Snake'), false);

  // Rejects community re-upload even when artist name is stuffed inside track title
  assert.equal(
    scoreAuthenticTrackCandidate({
      itemTitle: 'The Weeknd - Blinding Lights (Club Mix)',
      itemArtist: 'DJRedd',
      requestedTitle: 'Blinding Lights',
      requestedArtist: 'The Weeknd',
    }),
    null
  );
  assert.equal(
    scoreAuthenticTrackCandidate({
      itemTitle: 'Blinding Lights',
      itemArtist: 'Glowave Town',
      requestedTitle: 'Blinding Lights',
      requestedArtist: 'The Weeknd',
    }),
    null
  );

  // Prefers clean exact title match over extra parenthetical version
  const exactScore = scoreAuthenticTrackCandidate({
    itemTitle: 'Kesariya',
    itemArtist: 'Pritam, Arijit Singh',
    requestedTitle: 'Kesariya',
    requestedArtist: 'Arijit Singh, Pritam',
    itemDurationSec: 268,
    targetDurationSec: 268,
  });
  const liveScore = scoreAuthenticTrackCandidate({
    itemTitle: 'Kesariya (Live)',
    itemArtist: 'Arijit Singh',
    requestedTitle: 'Kesariya',
    requestedArtist: 'Arijit Singh, Pritam',
    itemDurationSec: 290,
    targetDurationSec: 268,
  });
  assert.ok(exactScore !== null && liveScore !== null && exactScore > liveScore);

  // Reject long-form results and duration mismatches rather than accidentally
  // selecting podcasts, mixes, or unrelated uploads as a song stream.
  assert.equal(
    scoreAuthenticTrackCandidate({
      itemTitle: 'Sapphire',
      itemArtist: 'Ed Sheeran',
      requestedTitle: 'Sapphire',
      requestedArtist: 'Ed Sheeran',
      itemDurationSec: 55 * 60,
      targetDurationSec: 210,
    }),
    null
  );
  assert.equal(
    scoreAuthenticTrackCandidate({
      itemTitle: 'Roots',
      itemArtist: 'Bintu Pabra',
      requestedTitle: 'Roots',
      requestedArtist: 'Bintu Pabra',
      itemDurationSec: 900,
      targetDurationSec: 210,
    }),
    null
  );
  assert.equal(
    scoreAuthenticTrackCandidate({
      itemTitle: 'Sapphire',
      itemArtist: 'Ed Sheeran',
      requestedTitle: 'Sapphire',
      requestedArtist: 'Ed Sheeran',
      itemDurationSec: 550,
      targetDurationSec: 210,
    }),
    null
  );
});


test('isPlausibleSongDuration rejects long-form and invalid catalogue results', () => {
  assert.equal(isPlausibleSongDuration(210), true);
  assert.equal(isPlausibleSongDuration(45), true);
  assert.equal(isPlausibleSongDuration(55 * 60), false);
  assert.equal(isPlausibleSongDuration(16 * 60), false);
  assert.equal(isPlausibleSongDuration(0), false);
  assert.equal(isPlausibleSongDuration(Number.NaN), false);
});
