import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildArtistPageData,
  buildRelatedArtists,
  dedupeArtistTracks,
  dedupeCanonicalTracks,
  doesTrackBelongToArtist,
  extractArtistAlbumsAndLatestRelease,
  isArtistFollowed,
  sortArtistTracks,
  toggleFollowedArtistMap,
} from './artistProfile.ts';
import type { ArtistProfile, FollowedArtist, Track } from '../types/music.ts';

const makeTrack = (overrides: Partial<Track>): Track => ({
  id: 'tr-1',
  name: 'Kesariya',
  artist: 'Arijit Singh, Pritam',
  albumName: 'Brahmastra',
  year: '2022',
  duration: 268,
  playCount: 1000,
  image: 'https://example.com/cover.jpg',
  language: 'Hindi',
  genre: 'Bollywood',
  ...overrides,
});

test('doesTrackBelongToArtist matches primary, featured, and normalized accents accurately', () => {
  assert.equal(doesTrackBelongToArtist(makeTrack({ artist: 'Arijit Singh, Pritam' }), 'Arijit Singh'), true);
  assert.equal(doesTrackBelongToArtist(makeTrack({ artist: 'YOASOBI feat. Arijit Singh' }), 'Arijit Singh'), true);
  assert.equal(doesTrackBelongToArtist(makeTrack({ artist: 'Shreya Ghoshal & Pritam' }), 'Arijit Singh'), false);
  assert.equal(doesTrackBelongToArtist(makeTrack({ artist: 'Beyoncé' }), 'Beyonce'), true);
});

test('dedupeArtistTracks keeps highest-quality stream and merges missing metadata cleanly', () => {
  const previewOnly = makeTrack({
    id: 'dz-1',
    name: 'Kesariya',
    artist: 'Arijit Singh',
    albumName: 'Single',
    year: undefined,
    playCount: 500000,
    previewUrl: 'https://cdn.example/preview.mp3',
    sourceAvailability: 'preview',
  });
  const fullAudio = makeTrack({
    id: 'saavn-1',
    name: 'Kesariya (From "Brahmastra")',
    artist: 'Arijit Singh',
    albumName: 'Brahmastra',
    year: '2022',
    playCount: 120000,
    streamUrls: { '320kbps': 'https://cdn.example/full.mp4' },
    sourceAvailability: 'full',
  });

  const merged = dedupeArtistTracks([previewOnly, fullAudio]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'saavn-1');
  assert.equal(merged[0].albumName, 'Brahmastra');
  assert.equal(merged[0].year, '2022');
  assert.equal(merged[0].playCount, 500000);
});

test('sortArtistTracks sorts properly by popular, newest, title, and duration', () => {
  const tOldPopular = makeTrack({ id: 'a', name: 'Zindagi', year: '2014', playCount: 900_000, duration: 210 });
  const tNewMedium = makeTrack({ id: 'b', name: 'Apna Bana Le', year: '2024', playCount: 400_000, duration: 295 });
  const tLongTitle = makeTrack({ id: 'c', name: 'Channa Mereya', year: '2016', playCount: 700_000, duration: 310 });

  assert.deepEqual(
    sortArtistTracks([tOldPopular, tNewMedium, tLongTitle], 'popular').map((t) => t.id),
    ['a', 'c', 'b']
  );
  assert.deepEqual(
    sortArtistTracks([tOldPopular, tNewMedium, tLongTitle], 'newest').map((t) => t.id),
    ['b', 'c', 'a']
  );
  assert.deepEqual(
    sortArtistTracks([tOldPopular, tNewMedium, tLongTitle], 'title').map((t) => t.id),
    ['b', 'c', 'a']
  );
  assert.deepEqual(
    sortArtistTracks([tOldPopular, tNewMedium, tLongTitle], 'duration').map((t) => t.id),
    ['c', 'b', 'a']
  );
});

test('extractArtistAlbumsAndLatestRelease identifies latest release by newest year', () => {
  const tracks: Track[] = [
    makeTrack({ id: 't1', name: 'Tum Hi Ho', albumName: 'Aashiqui 2', year: '2013' }),
    makeTrack({ id: 't2', name: 'Chahun Main Ya Naa', albumName: 'Aashiqui 2', year: '2013' }),
    makeTrack({ id: 't3', name: 'Sajni', albumName: 'Laapataa Ladies', year: '2024' }),
  ];

  const { albums, latestRelease } = extractArtistAlbumsAndLatestRelease(tracks, [], 'Arijit Singh');
  assert.equal(albums.length, 2);
  assert.equal(latestRelease?.name, 'Laapataa Ladies');
  assert.equal(latestRelease?.year, '2024');
  assert.equal(latestRelease?.type, 'Single');
  const olderAlbum = albums.find((a) => a.name === 'Aashiqui 2');
  assert.equal(olderAlbum?.type, 'EP');
  assert.equal(olderAlbum?.tracks.length, 2);
});

test('buildRelatedArtists excludes self and prioritizes matching language and genre', () => {
  const seeds: ArtistProfile[] = [
    {
      id: 'art-arijit',
      name: 'Arijit Singh',
      genre: 'Bollywood · Romantic',
      language: 'Hindi',
      monthlyListeners: '80M',
      image: 'img1',
      bio: 'bio',
      topTrackIds: [],
    },
    {
      id: 'art-shreya',
      name: 'Shreya Ghoshal',
      genre: 'Bollywood · Melody',
      language: 'Hindi',
      monthlyListeners: '42M',
      image: 'img2',
      bio: 'bio',
      topTrackIds: [],
    },
    {
      id: 'art-yoasobi',
      name: 'YOASOBI',
      genre: 'J-Pop · Synthpop',
      language: 'Japanese',
      monthlyListeners: '28M',
      image: 'img3',
      bio: 'bio',
      topTrackIds: [],
    },
  ];

  const related = buildRelatedArtists('Arijit Singh', 'Hindi', 'Bollywood', seeds, []);
  assert.equal(related.some((r) => r.name === 'Arijit Singh'), false);
  assert.equal(related[0]?.name, 'Shreya Ghoshal');
});

test('isArtistFollowed and toggleFollowedArtistMap match across seed and remote provider IDs by normalized name', () => {
  const initial: Record<string, FollowedArtist> = {
    'art-arijit': {
      id: 'art-arijit',
      name: 'Arijit Singh',
      image: 'https://example.com/arijit.jpg',
      genre: 'Bollywood',
      followedAtMs: 1000,
    },
  };

  assert.equal(isArtistFollowed(initial, 'saavn-art:459320', 'Arijit Singh'), true);
  assert.equal(isArtistFollowed(initial, 'dz-art:123', 'Shreya Ghoshal'), false);

  const unfollowed = toggleFollowedArtistMap(initial, {
    id: 'saavn-art:459320',
    name: 'Arijit Singh',
    image: 'https://example.com/arijit.jpg',
  });
  assert.equal(unfollowed.followed, false);
  assert.equal(Object.keys(unfollowed.nextMap).length, 0);

  const refollowed = toggleFollowedArtistMap(unfollowed.nextMap, {
    id: 'saavn-art:459320',
    name: 'Arijit Singh',
    image: 'https://example.com/arijit.jpg',
    genre: 'Bollywood',
  }, 2000);
  assert.equal(refollowed.followed, true);
  assert.equal(refollowed.nextMap['saavn-art:459320']?.followedAtMs, 2000);
});

test('buildArtistPageData combines seed, detail, searched, and local tracks cleanly', () => {
  const seedTrack = makeTrack({ id: 's1', name: 'Tum Hi Ho', albumName: 'Aashiqui 2', year: '2013', playCount: 900 });
  const searchedTrack = makeTrack({ id: 'r1', name: 'Satranga', albumName: 'Animal', year: '2023', playCount: 1500 });
  const unrelatedTrack = makeTrack({ id: 'x1', name: 'Idol', artist: 'YOASOBI', albumName: 'Idol', year: '2023' });

  const page = buildArtistPageData({
    target: { id: 'art-arijit', name: 'Arijit Singh', image: 'https://example.com/arijit.jpg' },
    seedArtist: {
      id: 'art-arijit',
      name: 'Arijit Singh',
      genre: 'Bollywood · Romantic',
      language: 'Hindi',
      monthlyListeners: '80M monthly listeners',
      image: 'https://example.com/arijit.jpg',
      bio: 'Acclaimed playback singer',
      topTrackIds: ['s1'],
    },
    seedTracks: [seedTrack, unrelatedTrack],
    seedAlbums: [],
    seedArtists: [],
    searchedSongs: [searchedTrack, unrelatedTrack],
  });

  assert.equal(page.artist.name, 'Arijit Singh');
  assert.equal(page.artist.isVerified, true);
  assert.equal(page.allSongs.length, 2);
  assert.equal(page.popularTracks[0].id, 'r1');
  assert.equal(page.latestRelease?.name, 'Animal');
});

test('dedupeArtistTracks merges co-credited duplicates while keeping distinct acoustic variants', () => {
  const coCredited = makeTrack({
    id: 'saavn-tum-1',
    name: 'Tum Hi Ho (From "Aashiqui 2")',
    artist: 'Mithoon, Arijit Singh',
    duration: 262,
    streamUrls: { '320kbps': 'https://cdn.example/tum1.mp4' },
  });
  const soloCredit = makeTrack({
    id: 'saavn-tum-2',
    name: 'Tum Hi Ho (From "Aashiqui 2")',
    artist: 'Arijit Singh',
    duration: 261,
    streamUrls: { '160kbps': 'https://cdn.example/tum2.mp4' },
  });
  const acousticVariant = makeTrack({
    id: 'saavn-tum-acoustic',
    name: 'Tum Hi Ho (Unplugged)',
    artist: 'Arijit Singh',
    duration: 240,
  });

  const merged = dedupeArtistTracks([coCredited, soloCredit, acousticVariant]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, 'saavn-tum-1');
  assert.equal(merged[1].id, 'saavn-tum-acoustic');
});

test('extractArtistAlbumsAndLatestRelease prefers real studio releases over generic compilations', () => {
  const realRelease = {
    id: 'alb-real',
    name: 'Laapataa Ladies',
    artist: 'Arijit Singh',
    year: '2024',
    image: 'https://example.com/real.jpg',
    trackCount: 1,
    type: 'Single' as const,
    tracks: [],
  };
  const compilation = {
    id: 'alb-comp',
    name: 'Arijit Singh All Time Best Hits Collection',
    artist: 'Arijit Singh',
    year: '2026',
    image: 'https://example.com/comp.jpg',
    trackCount: 12,
    type: 'Album' as const,
    tracks: [],
  };

  const { latestRelease } = extractArtistAlbumsAndLatestRelease([], [compilation, realRelease], 'Arijit Singh');
  assert.equal(latestRelease?.id, 'alb-real');
});

test('dedupeCanonicalTracks merges dash-formatted soundtrack suffixes and prefers JioSaavn over SoundCloud uploads', () => {
  const scReupload = makeTrack({
    id: 'sc-1',
    name: 'Kesariya - From "Brahmastra"',
    artist: 'Arijit Singh',
    duration: 268,
    sourceProvider: 'SoundCloud',
    streamUrls: { '160kbps': 'https://cdn.example/sc.mp3' },
  });
  const officialSaavn = makeTrack({
    id: 'saavn-official',
    name: 'Kesariya (From "Brahmastra")',
    artist: 'Pritam, Arijit Singh',
    duration: 268,
    sourceProvider: 'JioSaavn',
    streamUrls: { '320kbps': 'https://cdn.example/saavn.mp4' },
  });
  const remix = makeTrack({
    id: 'saavn-remix',
    name: 'Kesariya (DJ Remix)',
    artist: 'Arijit Singh',
    duration: 210,
    sourceProvider: 'JioSaavn',
    streamUrls: { '320kbps': 'https://cdn.example/remix.mp4' },
  });

  const merged = dedupeCanonicalTracks([scReupload, officialSaavn, remix]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, 'saavn-official');
  assert.equal(merged[1].id, 'saavn-remix');
});


