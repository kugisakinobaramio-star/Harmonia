import assert from 'node:assert/strict';
import test from 'node:test';
import { parseYouTubeDataApiPlaylistPage, parseYouTubePlaylistContinuation, parseYouTubePlaylistPage } from './youtubePlaylist.ts';

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

test('extracts continuation tokens from the initial page', () => {
  const html = `<script>ytInitialData = {"contents":{"playlistVideoListRenderer":{"contents":[
    {"playlistVideoRenderer":{"videoId":"abcdefghijk","title":{"simpleText":"Song"}}},
    {"continuationItemRenderer":{"continuationEndpoint":{"continuationCommand":{"token":"next-page-token"}}}}
  ]}}};</script>`;
  const result = parseYouTubePlaylistPage(html);
  assert.ok(result);
  assert.equal(result.continuationToken, 'next-page-token');
});

test('parses continuation response rows and the next token', () => {
  const result = parseYouTubePlaylistContinuation({
    onResponseReceivedActions: [{
      appendContinuationItemsAction: {
        continuationItems: [
          { playlistVideoRenderer: { videoId: 'lmnopqrstuv', title: { simpleText: 'Next Song' }, lengthSeconds: '180' } },
          { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'third-page' } } } },
        ],
      },
    }],
  });
  assert.equal(result.entries.length, 1);
  assert.equal(result.sourceEntriesReceived, 1);
  assert.equal(result.entries[0].title, 'Next Song');
  assert.equal(result.continuationToken, 'third-page');
});

test('parses current lockup playlist rows', () => {
  const html = `<script>ytInitialData = {"contents":{"playlistVideoListRenderer":{"contents":[
    {"lockupViewModel":{"contentId":"abcdefghijk","contentType":"LOCKUP_CONTENT_TYPE_VIDEO","metadata":{"lockupMetadataViewModel":{"title":{"content":"Modern Song"}}}}}
  ]}}};</script>`;
  const result = parseYouTubePlaylistPage(html);
  assert.ok(result);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].title, 'Modern Song');
});


test('counts raw source rows even when a row has no importable video ID', () => {
  const html = `<script>ytInitialData = {"contents":{"playlistVideoListRenderer":{"contents":[
    {"playlistVideoRenderer":{"videoId":"abcdefghijk","title":{"simpleText":"Song"}}},
    {"playlistVideoRenderer":{"title":{"simpleText":"Unavailable row"}}}
  ]}}};</script>`;
  const result = parseYouTubePlaylistPage(html);
  assert.ok(result);
  assert.equal(result.sourceEntriesReceived, 2);
  assert.equal(result.entries.length, 1);
});

test('rejects pages without playlist renderer data', () => {
  assert.equal(parseYouTubePlaylistPage('<html><body>Unavailable</body></html>'), null);
});


test('parses public playlist RSS fallback entries', async () => {
  const { parseYouTubePlaylistRss } = await import('./youtubePlaylist.ts');
  const xml = `<?xml version="1.0"?><feed><title>Road &amp; Night</title>
    <entry><yt:videoId>abcdefghijk</yt:videoId><title>First &amp; Best</title><author><name>Artist One</name></author><media:thumbnail url="https://i.ytimg.com/one.jpg"/></entry>
    <entry><yt:videoId>lmnopqrstuv</yt:videoId><title>Second Song</title><author><name>Artist Two</name></author></entry>
    <entry><yt:videoId>abcdefghijk</yt:videoId><title>Duplicate</title></entry>
  </feed>`;
  const result = parseYouTubePlaylistRss(xml);
  assert.ok(result);
  assert.equal(result.title, 'Road & Night');
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].title, 'First & Best');
  assert.equal(result.entries[0].channel, 'Artist One');
  assert.equal(result.entries[0].image, 'https://i.ytimg.com/one.jpg');
});


test('parses official YouTube Data API playlist item pages and pagination metadata', () => {
  const result = parseYouTubeDataApiPlaylistPage({
    pageInfo: { totalResults: 78, resultsPerPage: 50 },
    nextPageToken: 'page-two',
    items: [
      {
        contentDetails: { videoId: 'abcdefghijk' },
        snippet: {
          title: 'First Song',
          videoOwnerChannelTitle: 'Artist One',
          thumbnails: { high: { url: 'https://i.ytimg.com/first.jpg' } },
        },
      },
      {
        snippet: { title: 'Private or deleted entry' },
      },
      {
        contentDetails: { videoId: 'lmnopqrstuv' },
        snippet: { title: 'Second Song', channelTitle: 'Artist Two' },
      },
    ],
  });
  assert.equal(result.sourceEntriesReceived, 3);
  assert.equal(result.sourceEntriesTotal, 78);
  assert.equal(result.nextPageToken, 'page-two');
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].title, 'First Song');
  assert.equal(result.entries[0].channel, 'Artist One');
  assert.equal(result.entries[0].image, 'https://i.ytimg.com/first.jpg');
});
