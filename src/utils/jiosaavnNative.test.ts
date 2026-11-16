import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSaavnDownloadUrls,
  buildSaavnImageList,
  decryptSaavnMediaUrl,
  mapNativeSaavnSong,
} from './jiosaavnNative.ts';

test('decryptSaavnMediaUrl decrypts JioSaavn DES-ECB URLs identically to CDN paths', () => {
  const encryptedPropose =
    'ID2ieOjCrwfgWvL5sXl4B1ImC5QfbsDyCfdxkf8IzbstZ8F3MOypdk/uor+ScvI9ft1qnQy4Ln/sZxCUFY3VYRw7tS9a8Gtq';
  const decrypted = decryptSaavnMediaUrl(encryptedPropose);
  assert.equal(
    decrypted,
    'https://aac.saavncdn.com/050/f9f948807a5b072ce58a1a4b123ff015_96.mp4'
  );

  const urls = buildSaavnDownloadUrls(decrypted, true);
  assert.deepEqual(
    urls.map((u) => [u.quality, u.url.split('/').pop()]),
    [
      ['12kbps', 'f9f948807a5b072ce58a1a4b123ff015_12.mp4'],
      ['48kbps', 'f9f948807a5b072ce58a1a4b123ff015_48.mp4'],
      ['96kbps', 'f9f948807a5b072ce58a1a4b123ff015_96.mp4'],
      ['160kbps', 'f9f948807a5b072ce58a1a4b123ff015_160.mp4'],
      ['320kbps', 'f9f948807a5b072ce58a1a4b123ff015_320.mp4'],
    ]
  );
});

test('mapNativeSaavnSong maps 9Lana JioSaavn tracks and excludes unavailable rights', () => {
  const mapped = mapNativeSaavnSong({
    id: 'OvQCkn8e',
    title: 'propose',
    year: '2024',
    language: 'japanese',
    play_count: '6547',
    image: 'https://c.saavncdn.com/050/propose-Japanese-2024-20240807161540-150x150.jpg',
    more_info: {
      album: 'propose',
      album_id: '56935079',
      duration: '234',
      '320kbps': 'true',
      encrypted_media_url:
        'ID2ieOjCrwfgWvL5sXl4B1ImC5QfbsDyCfdxkf8IzbstZ8F3MOypdk/uor+ScvI9ft1qnQy4Ln/sZxCUFY3VYRw7tS9a8Gtq',
      rights: { code: '0', reason: '' },
      artistMap: {
        primary_artists: [{ id: '17178101', name: '9lana', role: 'primary_artists' }],
      },
    },
  });

  assert.ok(mapped);
  assert.equal(mapped.id, 'saavn-OvQCkn8e'.replace('saavn-', ''));
  assert.equal(mapped.name, 'propose');
  assert.equal(mapped.duration, 234);
  assert.equal(mapped.artists.primary[0]?.name, '9lana');
  assert.equal(mapped.downloadUrl[4]?.quality, '320kbps');
  assert.equal(
    mapped.downloadUrl[4]?.url,
    'https://aac.saavncdn.com/050/f9f948807a5b072ce58a1a4b123ff015_320.mp4'
  );
  assert.equal(
    buildSaavnImageList(mapped.image[0]?.url)[2]?.url,
    'https://c.saavncdn.com/050/propose-Japanese-2024-20240807161540-500x500.jpg'
  );

  const unavailable = mapNativeSaavnSong({
    id: 'blocked1',
    title: 'Blocked',
    more_info: {
      encrypted_media_url:
        'ID2ieOjCrwfgWvL5sXl4B1ImC5QfbsDyCfdxkf8IzbstZ8F3MOypdk/uor+ScvI9ft1qnQy4Ln/sZxCUFY3VYRw7tS9a8Gtq',
      rights: { code: '1', reason: 'Unavailable' },
    },
  });
  assert.equal(unavailable, null);
});
