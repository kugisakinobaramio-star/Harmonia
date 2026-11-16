import { decodeHtmlEntities } from './playerEngine';

export interface VideoSearchHint {
  id?: string;
  title: string;
  channel: string;
}

export interface CanonicalEditionPlan {
  canonicalQueries: string[];
  artistHints: string[];
  coreTerms: string[];
}

const EDITION_STOP_WORDS = new Set([
  'edition',
  'version',
  'ver',
  'official',
  'audio',
  'video',
  'music',
  'song',
  'full',
  'lyric',
  'lyrics',
  'lyrical',
  'status',
  'reel',
  'reels',
  'shorts',
  'edit',
  'edits',
  'mashup',
  'mix',
  'remix',
  'lofi',
  'lo',
  'fi',
  'slowed',
  'reverb',
  '8d',
  '16d',
  'bass',
  'boosted',
  'hd',
  '4k',
  'mv',
  'pv',
  'ost',
  'soundtrack',
  'theme',
  'cover',
  'parody',
  'spoof',
  'feat',
  'ft',
  'featuring',
  'with',
  'and',
  'the',
  'brand',
  'new',
  'day',
]);

const GENERIC_CHANNEL_PATTERNS = [
  /sony\s*music/i,
  /t-series/i,
  /zee\s*music/i,
  /saregama/i,
  /tips\s*official/i,
  /yrf/i,
  /speed\s*records/i,
  /desimusicfactory/i,
  /\bedits?\b/i,
  /\blyrics?\b/i,
  /\btunes?\b/i,
  /\bmusic\s*india\b/i,
  /\bofficial\s*channel\b/i,
  /\bvarious\s*artists\b/i,
  /\bvevo\b/i,
];

function tokenizeNormalized(value: string): string[] {
  return decodeHtmlEntities(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 1 || /[^\x00-\x7f]/.test(token));
}

function cleanChannelName(channel: string): string {
  const cleaned = decodeHtmlEntities(channel)
    .replace(/\s+and\s+\d+\s+more$/i, '')
    .replace(/\s*-\s*topic$/i, '')
    .replace(/\bofficial\b/gi, '')
    .trim();
  if (!cleaned) return '';
  if (GENERIC_CHANNEL_PATTERNS.some((pattern) => pattern.test(cleaned))) return '';
  return cleaned;
}

function stripBracketedMeta(text: string): string {
  return decodeHtmlEntities(text)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/【[^】]*】/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isParodyOrNoisyVideo(title: string): boolean {
  const low = decodeHtmlEntities(title).toLowerCase();
  return /\b(parody|spoof|16d|8d|reaction|explained|trailer|breakdown)\b/i.test(low);
}

export function extractEditionCoreQuery(query: string): string {
  const tokens = tokenizeNormalized(query).filter((token) => !EDITION_STOP_WORDS.has(token));
  if (tokens.length === 0) return '';
  return tokens.join(' ');
}

export function buildCanonicalEditionPlan(
  query: string,
  videoHints: VideoSearchHint[] = []
): CanonicalEditionPlan {
  const cleanQuery = decodeHtmlEntities(query).trim();
  const queryTokens = tokenizeNormalized(cleanQuery);
  const queryTokenSet = new Set(queryTokens);
  const coreTerms = queryTokens.filter((token) => !EDITION_STOP_WORDS.has(token));
  const coreSet = new Set(coreTerms);

  const canonicalQueries: string[] = [];
  const artistHints: string[] = [];
  const seenQueries = new Set<string>([cleanQuery.toLowerCase()]);
  const seenArtists = new Set<string>();

  const pushQuery = (candidate: string) => {
    const trimmed = candidate.replace(/\s+/g, ' ').trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seenQueries.has(key)) return;
    seenQueries.add(key);
    canonicalQueries.push(trimmed);
  };

  const pushArtist = (artist: string) => {
    const trimmed = artist.replace(/\s+/g, ' ').trim();
    if (!trimmed || trimmed.length < 2) return;
    const tokens = tokenizeNormalized(trimmed);
    if (!tokens.length) return;
    // Do not promote pure stop-words or query edition words as artist names
    if (tokens.every((token) => EDITION_STOP_WORDS.has(token) || queryTokenSet.has(token))) return;
    const key = tokens.join(' ');
    if (seenArtists.has(key)) return;
    seenArtists.add(key);
    artistHints.push(trimmed);
  };

  // Sort non-parody video hints first, preferring videos that share core tokens with the query.
  const rankedVideos = [...videoHints]
    .filter((v) => v.title && !isParodyOrNoisyVideo(v.title))
    .sort((a, b) => {
      const aTokens = new Set(tokenizeNormalized(a.title));
      const bTokens = new Set(tokenizeNormalized(b.title));
      const aOverlap = coreTerms.filter((t) => aTokens.has(t)).length;
      const bOverlap = coreTerms.filter((t) => bTokens.has(t)).length;
      return bOverlap - aOverlap;
    });

  for (const video of rankedVideos.slice(0, 4)) {
    const channelArtist = cleanChannelName(video.channel);
    const titleNoBrackets = stripBracketedMeta(video.title);
    // Split video title on separators: "|", "—", "–", " - "
    const pipeParts = titleNoBrackets
      .split(/\s*(?:\||—|–|\s-\s)\s*/)
      .map((part) => part.trim())
      .filter(Boolean);

    // Split each part further on crossover tokens (" x ", " × ")
    const subSegments: string[] = [];
    for (const part of pipeParts) {
      for (const seg of part.split(/\s+[x×]\s+/i)) {
        const cleanedSeg = seg.trim();
        if (cleanedSeg) subSegments.push(cleanedSeg);
      }
    }

    const matchedTitleParts: string[] = [];
    const candidateArtists: string[] = [];
    if (channelArtist) candidateArtists.push(channelArtist);

    for (const seg of subSegments) {
      const segTokens = tokenizeNormalized(seg);
      if (!segTokens.length) continue;
      if (segTokens.every((t) => EDITION_STOP_WORDS.has(t))) continue;

      const overlapsCore = segTokens.some((t) => coreSet.has(t));
      const nonQueryTokens = segTokens.filter((t) => !queryTokenSet.has(t) && !EDITION_STOP_WORDS.has(t));
      const matchedQueryTokens = segTokens.filter((t) => queryTokenSet.has(t) && !EDITION_STOP_WORDS.has(t));

      if (overlapsCore && matchedQueryTokens.length > 0 && nonQueryTokens.length === 0) {
        matchedTitleParts.push(seg);
      } else if (overlapsCore && nonQueryTokens.length > 0 && segTokens.length <= 4) {
        // Crossover segment mixing song + collaborator/franchise (e.g. "Barsaat Spider-Man")
        const cleanSongTokens = segTokens.filter((t) => coreSet.has(t) && !EDITION_STOP_WORDS.has(t));
        if (cleanSongTokens.length) matchedTitleParts.push(cleanSongTokens.join(' '));
      } else if (!overlapsCore && nonQueryTokens.length > 0 && segTokens.length <= 3) {
        // Likely an artist name segment before "|" such as "Banjaare | Barsaat x Spider-Man"
        candidateArtists.push(seg);
      }
    }

    const bestTitle = matchedTitleParts[0] || coreTerms[0] || '';
    for (const artist of candidateArtists) {
      pushArtist(artist);
      if (bestTitle) {
        pushQuery(`${bestTitle} ${artist}`);
      }
    }
  }

  // Fallback progressive stripping if no video hint resolved or as extra recall
  if (coreTerms.length >= 2) {
    pushQuery(coreTerms.join(' '));
    pushQuery(coreTerms[0]);
  } else if (coreTerms.length === 1) {
    pushQuery(coreTerms[0]);
  }

  return {
    canonicalQueries,
    artistHints,
    coreTerms,
  };
}

export function isCanonicalEditionTrackMatch(
  track: { name: string; artist: string; albumName?: string },
  plan: CanonicalEditionPlan
): boolean {
  const titleTokens = new Set(tokenizeNormalized(track.name));
  const artistTokens = new Set(tokenizeNormalized(track.artist));
  const albumTokens = new Set(tokenizeNormalized(track.albumName || ''));

  const coreHits = plan.coreTerms.filter(
    (term) => titleTokens.has(term) || artistTokens.has(term) || albumTokens.has(term)
  );
  if (coreHits.length === 0) return false;

  if (plan.artistHints.length > 0) {
    const artistMatched = plan.artistHints.some((hint) => {
      const hintTokens = tokenizeNormalized(hint);
      return hintTokens.length > 0 && hintTokens.every((t) => artistTokens.has(t) || titleTokens.has(t));
    });
    if (artistMatched) return true;
  }

  // Fallback when no artist hints matched: require a strong title match on the first core term
  return plan.coreTerms.length > 0 && titleTokens.has(plan.coreTerms[0]);
}

export function scoreCanonicalEditionTrack(
  track: { name: string; artist: string; playCount?: number },
  plan: CanonicalEditionPlan
): number {
  const titleTokens = tokenizeNormalized(track.name);
  const artistTokens = tokenizeNormalized(track.artist);
  const titleSet = new Set(titleTokens);
  const artistSet = new Set(artistTokens);

  let score = 0;
  for (const term of plan.coreTerms) {
    if (titleSet.has(term)) score += 35;
    if (artistSet.has(term)) score += 15;
  }

  if (plan.coreTerms.length > 0 && titleTokens.join(' ') === plan.coreTerms[0]) {
    score += 40;
  }

  for (const hint of plan.artistHints) {
    const hintTokens = tokenizeNormalized(hint);
    if (hintTokens.length > 0 && hintTokens.every((t) => artistSet.has(t))) {
      score += 120;
    }
  }

  score += Math.min(12, Math.log10(Math.max(1, track.playCount || 1)) * 2);
  return score;
}
