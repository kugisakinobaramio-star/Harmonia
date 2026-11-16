import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCanonicalEditionPlan,
  extractEditionCoreQuery,
  isCanonicalEditionTrackMatch,
  scoreCanonicalEditionTrack,
} from './editionSearch';

test('buildCanonicalEditionPlan extracts Barsaat + Banjaare from Spider-Man Edition video titles', () => {
  const plan = buildCanonicalEditionPlan('barsaat spiderman edition', [
    {
      id: 'I53Cz8m6G14',
      title: 'Chhat Pe Thi Makdi Badi - Full Version | Barsaat Parody | Realistic MCU Lyrics by Vishvesh Moghia',
      channel: 'Vishvesh Moghia',
    },
    {
      id: '42r8Stt-30w',
      title: 'Banjaare | Barsaat x Spider-Man (Brand New Day Edition)',
      channel: 'Sony Music India and 2 more',
    },
    {
      id: 'tMDWRDt2GTE',
      title: 'Barsaat X Spider-Man (Brand New Day Edition)',
      channel: 'Banjaare',
    },
  ]);

  assert.equal(plan.artistHints.includes('Banjaare'), true);
  assert.equal(plan.canonicalQueries[0], 'Barsaat Banjaare');
  assert.equal(plan.canonicalQueries.includes('barsaat'), true);
});

test('extractEditionCoreQuery removes edition/lofi/lyrics noise tokens', () => {
  assert.equal(extractEditionCoreQuery('Barsaat Official Lyrics Video Edition'), 'barsaat');
  assert.equal(extractEditionCoreQuery('Kesariya Lofi Slowed Reverb'), 'kesariya');
});

test('isCanonicalEditionTrackMatch and scoreCanonicalEditionTrack rank Banjaare Barsaat above unrelated Barsaat songs', () => {
  const plan = buildCanonicalEditionPlan('barsaat spiderman edition', [
    {
      id: '42r8Stt-30w',
      title: 'Banjaare | Barsaat x Spider-Man (Brand New Day Edition)',
      channel: 'Sony Music India and 2 more',
    },
  ]);

  const banjaare = { name: 'Barsaat', artist: 'Banjaare, Roni', playCount: 500000 };
  const other = { name: 'Barsaat Ki Dhun', artist: 'Jubin Nautiyal', playCount: 5000000 };

  assert.equal(isCanonicalEditionTrackMatch(banjaare, plan), true);
  assert.ok(scoreCanonicalEditionTrack(banjaare, plan) > scoreCanonicalEditionTrack(other, plan));
});
