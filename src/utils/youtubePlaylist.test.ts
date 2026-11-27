import assert from 'node:assert/strict';
import test from 'node:test';
import { parseYouTubePlaylistPage } from './youtubePlaylist.ts';

test('parses legacy playlist rows and preserves order and durations', () => {
  const html = `<script>var ytInitialData = {
    "metadata":{"playlistMetadataRenderer":{"title":"Test Mix"}},
    "contents":{"playlistVideoListRenderer":{"contents":[
      {"playlistVideoRenderer":{"videoId":"abcdefghijk","title":{"runs":[{"text":"First Song"}]},"shortBylineText":{"simpleText":"Artist One"},"lengthSeconds":"215","thumbnail":{"thumbnails":[{"url":"https://i.ytimg.com/one.jpg"}]}}},
      {"playlistVideoRenderer":{"videoId":"lmnopqrstuv","title":{"simpleText":"Second Song"},"lengthSeconds":"0","isPlayable":false}}
    ]}}
  };</script>`;
  const result = parseYouTubePlaylistPage(html);
  assert.ok(result);
  assert.equal(result.title, 'Test Mix');
  assert.equal(result.sourceEntriesReceived, 2);
  assert.equal(result.entries[0].videoId, 'abcdefghijk');
  assert.equal(result.entries[0].duration, 215);
  assert.equal(result.entries[1].playable, false);
});

test('parses current lockup playlist rows and flags continuation', () => {
  const html = `<script>ytInitialData = {"contents":{"playlistVideoListRenderer":{"contents":[
    {"lockupViewModel":{"contentId":"abcdefghijk","contentType":"LOCKUP_CONTENT_TYPE_VIDEO","metadata":{"lockupMetadataViewModel":{"title":{"content":"Modern Song"}}}}},
    {"continuationItemRenderer":{"continuationEndpoint":{"continuationCommand":{"token":"next"}}}}
  ]}}};</script>`;
  const result = parseYouTubePlaylistPage(html);
  assert.ok(result);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].title, 'Modern Song');
  assert.equal(result.hasContinuation, true);
});

test('rejects pages without playlist renderer data', () => {
  assert.equal(parseYouTubePlaylistPage('<html><body>Unavailable</body></html>'), null);
});
