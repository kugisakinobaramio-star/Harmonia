import { apiUrl } from './apiUrl';
import type {
  AudioQuality,
  CuratedPlaylist,
  LyricLine,
  MusicLanguage,
  MusicRegion,
  RepeatMode,
  Track,
  UserTasteProfile,
} from '../types/music';

export const QUALITY_ORDER: AudioQuality[] = ['320kbps', '160kbps', '96kbps', 'auto'];

export const QUALITY_LABELS: Record<AudioQuality, string> = {
  '320kbps': '320k',
  '160kbps': '160k',
  '96kbps': '96k',
  auto: 'Auto',
};

export const REGION_LABELS: Record<MusicRegion, string> = {
  IN: 'India (IN)',
  JP: 'Japan (JP)',
  US: 'United States (US)',
  GB: 'United Kingdom (UK)',
  GLOBAL: 'Worldwide',
};

export function isPlausibleSongDuration(seconds: number): boolean {
  return Number.isFinite(seconds) && seconds >= 45 && seconds <= 15 * 60;
}

export function isSearchableTrackDuration(track: Pick<Track, 'duration' | 'metadataOnly' | 'previewUrl' | 'streamUrls'>): boolean {
  if (isPlausibleSongDuration(track.duration)) return true;
  if (track.duration !== 0) return false;
  return Boolean(
    track.metadataOnly ||
    track.previewUrl ||
    (track.streamUrls && Object.values(track.streamUrls).some(Boolean))
  );
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export function formatPlayCount(count?: number): string {
  if (!count || !Number.isFinite(count) || count <= 0) return '';
  if (count >= 1_000_000_000) {
    return `${(count / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  }
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return String(Math.round(count));
}

export function getGreetingForHour(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function decodeHtmlEntities(input: string): string {
  return String(input || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

const FAST_CDN_HOSTS = [
  'mzstatic.com',
  'saavncdn.com',
  'scdn.co',
  'spotifycdn.com',
  'dzcdn.net',
  'ytimg.com',
  'audius.co',
  'audiusindex.org',
  'coverartarchive.org',
  'archive.org',
];

export function isFastImageCdn(url: string): boolean {
  try {
    const parsed = new URL(url);
    return FAST_CDN_HOSTS.some((host) => parsed.hostname.endsWith(host));
  } catch {
    return false;
  }
}

export function toProxiedImageUrl(url?: string): string {
  if (!url) return '';
  if (url.startsWith('/api/')) return apiUrl(url);
  if (
    url.startsWith('/') ||
    url.startsWith('data:') ||
    url.startsWith('blob:') ||
    url.startsWith(apiUrl('/api/music/image'))
  ) {
    return url;
  }
  if (/^https?:\/\//i.test(url)) {
    if (url.startsWith('https://') && isFastImageCdn(url)) {
      return url;
    }
    return apiUrl(`/api/music/image?url=${encodeURIComponent(url)}`);
  }
  return url;
}

export function cycleQuality(current: AudioQuality): AudioQuality {
  const idx = QUALITY_ORDER.indexOf(current);
  if (idx < 0) return '320kbps';
  return QUALITY_ORDER[(idx + 1) % QUALITY_ORDER.length];
}

export function isShortPreviewUrl(url?: string): boolean {
  if (!url) return false;
  return /p\.scdn\.co\/mp3-preview|audio-ssl\.itunes\.apple\.com|cdnt-preview\.dzcdn\.net|cdns-preview-[a-z0-9]+\.dzcdn\.net|dzcdn\.net\/stream\/c-/i.test(
    url
  );
}

export function hasFullAudioStream(track: Track | null | undefined): boolean {
  if (!track) return false;
  if (track.streamUrls) {
    const urls = Object.values(track.streamUrls).filter((u): u is string => Boolean(u));
    if (urls.some((u) => !isShortPreviewUrl(u))) {
      return true;
    }
  }
  return Boolean(track.previewUrl && !isShortPreviewUrl(track.previewUrl));
}

/**
 * Audio readiness is deliberately independent from YouTube video availability.
 * A YouTube ID belongs to the video experience and is never a direct audio source.
 */
export function hasFullPlaybackSource(track: Track | null | undefined): boolean {
  return hasFullAudioStream(track);
}

export function selectStreamUrl(
  track: Track | null | undefined,
  preferred: AudioQuality,
  measuredSpeedKbps = 99999
): string {
  if (!track) return '';
  if (track.streamUrls) {
    const map = track.streamUrls;
    let target: Exclude<AudioQuality, 'auto'>;
    if (preferred === 'auto') {
      if (measuredSpeedKbps < 400) target = '96kbps';
      else if (measuredSpeedKbps < 1200) target = '160kbps';
      else target = '320kbps';
    } else {
      target = preferred;
    }

    const found =
      map[target] ||
      map['320kbps'] ||
      map['160kbps'] ||
      map['96kbps'] ||
      map['48kbps'] ||
      map['12kbps'];
    if (found) return found;
  }
  return track.previewUrl || '';
}

export function createShuffleBag(
  tracks: Track[],
  currentTrackId?: string,
  randomFn: () => number = Math.random
): string[] {
  const seen = new Set<string>();
  const bag = tracks
    .map((track) => track.id)
    .filter((id) => {
      if (!id || id === currentTrackId || seen.has(id)) return false;
      seen.add(id);
      return true;
    });

  for (let i = bag.length - 1; i > 0; i--) {
    const random = Math.max(0, Math.min(0.999999999, randomFn()));
    const j = Math.floor(random * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

export function resolveNextTrackIndex(params: {
  queueLength: number;
  currentIndex: number;
  direction: 1 | -1;
  shuffle: boolean;
  repeatMode: RepeatMode;
  autoAdvance: boolean;
  randomFn?: () => number;
}): number | null {
  const {
    queueLength,
    currentIndex,
    direction,
    shuffle,
    repeatMode,
    autoAdvance,
    randomFn = Math.random,
  } = params;

  if (queueLength <= 0) return null;
  if (queueLength === 1) {
    if (autoAdvance && repeatMode === 0 && direction === 1) return null;
    return 0;
  }

  if (autoAdvance && repeatMode === 2 && direction === 1) {
    return currentIndex >= 0 ? currentIndex : 0;
  }

  if (shuffle) {
    let candidate = Math.floor(randomFn() * queueLength);
    if (candidate === currentIndex) {
      candidate = (currentIndex + 1) % queueLength;
    }
    return candidate;
  }

  if (autoAdvance && repeatMode === 0 && direction === 1 && currentIndex >= queueLength - 1) {
    return null;
  }

  const next = currentIndex + direction;
  if (repeatMode === 1) {
    return ((next % queueLength) + queueLength) % queueLength;
  }

  return Math.max(0, Math.min(queueLength - 1, next));
}

export function isAllowedJamendoNonCommercialLicense(value: string): boolean {
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.hostname.toLowerCase() !== 'creativecommons.org'
    ) return false;
    const parts = url.pathname.toLowerCase().split('/').filter(Boolean);
    return (
      parts.length === 3 &&
      parts[0] === 'licenses' &&
      /^by-nc(?:-sa|-nd)?$/.test(parts[1]) &&
      /^\d+(?:\.\d+)*$/.test(parts[2])
    );
  } catch {
    return false;
  }
}

export function getSearchFallbackQueries(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  // Explicit "title - artist", "artist - title", "title by artist", and
  // comma-separated searches give us a reliable boundary to try both sides.
  const parts = trimmed.split(/\s+(?:-|–|—|by)\s+|,\s*/i).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 2) {
    return [...new Set([parts[0], parts[1], `${parts[1]} ${parts[0]}`])];
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length < 3) return [];

  // Free-text searches have no dependable title/artist boundary. Try
  // prefixes and suffixes so title-first and artist-first input both work.
  return [
    tokens.slice(0, -1).join(' '),
    tokens.slice(0, -2).join(' '),
    tokens.slice(-1).join(' '),
    tokens.slice(-2).join(' '),
  ].filter((candidate, index, all) => Boolean(candidate) && all.indexOf(candidate) === index);
}

export function isRelevantSongSearchCandidate(
  itemTitle: string,
  itemArtist: string,
  query: string
): boolean {
  const normalize = (value: string) =>
    decodeHtmlEntities(value)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter((token) => token.length > 1);
  const queryTokens = [...new Set(normalize(query))];
  const titleTokens = new Set(normalize(itemTitle));
  const artistTokens = new Set(normalize(itemArtist));
  if (!queryTokens.length) return false;
  const titleHits = queryTokens.filter((token) => titleTokens.has(token));
  const artistHits = queryTokens.filter((token) => artistTokens.has(token));
  const totalHits = new Set([...titleHits, ...artistHits]).size;
  const minimumHits = queryTokens.length <= 2 ? queryTokens.length : Math.ceil(queryTokens.length * 0.65);
  return totalHits >= minimumHits && (titleHits.length > 0 || artistHits.length > 0);
}

export function isMatchingLyricsCandidate(
  candidate: { trackName?: string; artistName?: string; duration?: number },
  requestedTitle: string,
  requestedArtist: string,
  requestedDurationSec = 0
): boolean {
  const normalize = (value: string) =>
    decodeHtmlEntities(value)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
      .replace(/\b(remaster(ed)?|radio edit|explicit|clean version)\b/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');

  const title = normalize(candidate.trackName || '');
  const requested = normalize(requestedTitle);
  const artist = normalize(requestedArtist);
  if (!title || !requested || !artist || title !== requested) return false;

  const artistNames = (candidate.artistName || '')
    .split(/,|&|\bfeat\.?\b|\bft\.?\b|\bwith\b/i)
    .map(normalize)
    .filter(Boolean);
  if (!artistNames.includes(artist)) return false;

  const candidateDuration = Number(candidate.duration) || 0;
  if (
    requestedDurationSec > 30 &&
    candidateDuration > 30 &&
    Math.abs(candidateDuration - requestedDurationSec) > 25
  ) {
    return false;
  }
  return true;
}

export function parseLrcLyrics(lrcText: string): LyricLine[] {
  const out: LyricLine[] = [];
  const lines = String(lrcText || '').split('\n');
  for (const raw of lines) {
    const match = raw.match(/^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]\s*(.*)$/);
    if (!match) continue;
    const mins = Number(match[1]);
    const secs = Number(match[2]);
    const msPart = match[3] ? Number(match[3].padEnd(3, '0')) / 1000 : 0;
    const text = match[4].trim();
    if (!text) continue;
    out.push({
      time: Math.round((mins * 60 + secs + msPart) * 10) / 10,
      text,
    });
  }
  return out.sort((a, b) => a.time - b.time);
}

export function parsePlainLyricsToLines(rawLyrics: string, durationSec: number): LyricLine[] {
  const cleaned = String(rawLyrics || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 120);

  if (!cleaned.length) return [];
  const effectiveDuration = durationSec > 10 ? durationSec : 180;
  const interval = effectiveDuration / cleaned.length;
  return cleaned.map((text, idx) => ({
    time: Math.round(idx * interval * 10) / 10,
    text,
  }));
}

export function resolveActiveLyricPair(
  lines: LyricLine[],
  currentTimeSec: number,
  durationSec: number
): { activeIndex: number; current: string; next: string } {
  if (!lines.length) {
    return { activeIndex: -1, current: '', next: '' };
  }

  const hasTimedLines = lines.some((l) => l.time > 0);
  if (!hasTimedLines && durationSec > 0) {
    const progress = Math.max(0, Math.min(0.9999, currentTimeSec / durationSec));
    const idx = Math.floor(progress * lines.length);
    return {
      activeIndex: idx,
      current: lines[idx]?.text || '',
      next: lines[idx + 1]?.text || '',
    };
  }

  let activeIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= currentTimeSec + 0.15) {
      activeIdx = i;
    } else {
      break;
    }
  }

  return {
    activeIndex: activeIdx,
    current: lines[activeIdx]?.text || '',
    next: lines[activeIdx + 1]?.text || '',
  };
}

const KNOCKOFF_TITLE_PATTERNS: RegExp[] = [
  /\bremix(?:es|ed)?\b/i,
  /\brmx\b/i,
  /\bbootleg\b/i,
  /\bmashup\b/i,
  /\bmegamix\b/i,
  /\brework\b/i,
  /\bflip\b/i,
  /\bclub\s+mix\b/i,
  /\bdance\s+mix\b/i,
  /\bfestival\s+mix\b/i,
  /\bextended\s+mix\b/i,
  /\blive\s+set\b/i,
  /\btechno\b/i,
  /\blofi\b/i,
  /\blo-fi\b/i,
  /\bambient\b/i,
  /\bnightcore\b/i,
  /\b8d\b/i,
  /\bslowed\b/i,
  /\bsped\s+up\b/i,
  /\breverb\b/i,
  /\b432\s*hz\b/i,
  /\bcover\b/i,
  /\bcoverz\b/i,
  /\bbossa\s+nova\b/i,
  /\btribute\b/i,
  /\boriginally\s+performed\b/i,
  /\bperfomed\b/i,
  /\bmade\s+famous\b/i,
  /\bin\s+the\s+style\s+of\b/i,
  /\b8-?bit\b/i,
  /\b16-?bit\b/i,
  /\bemulation\b/i,
  /\bfitness\b/i,
  /\bworkout\b/i,
  /\binstrumental\b/i,
  /\bkaraoke\b/i,
  /\boff\s+vocal\b/i,
  /\bno\s+vocal\b/i,
  /\btype\s+beat\b/i,
  /\bminus\s+one\b/i,
  /\bpiano\s+version\b/i,
  /\bacoustic\s+version\b/i,
  /\bepic\s+version\b/i,
  /\bhappy\s+diwali\b/i,
  /\btabata\b/i,
  /\bquartet\b/i,
  /\bmusic\s+box\b/i,
  /\bringtone\b/i,
  /\blullaby\b/i,
  /\bwhite\s+noise\b/i,
  /\brain\s+sound\b/i,
];

const KNOCKOFF_ARTIST_PATTERNS: RegExp[] = [
  /(?:^|[\s_-])dj(?:$|[\s_-])/i,
  /\bkaraoke\b/i,
  /\btribute\b/i,
  /\blo-?fi\b/i,
  /\b8-?bit\b/i,
  /\bringtone\b/i,
  /\blullaby\b/i,
  /\binstrumental\b/i,
  /\bpiano\s+version\b/i,
];

export function isRemixOrKnockoff(
  itemTitle: string,
  requestedTitle = '',
  itemArtist = '',
  requestedArtist = ''
): boolean {
  const titleClean = decodeHtmlEntities(itemTitle);
  const reqTitleClean = decodeHtmlEntities(requestedTitle);
  const artistClean = decodeHtmlEntities(itemArtist);
  const reqArtistClean = decodeHtmlEntities(requestedArtist);
  const reqContext = `${reqTitleClean} ${reqArtistClean}`;

  for (const pat of KNOCKOFF_TITLE_PATTERNS) {
    if (pat.test(titleClean) && !pat.test(reqContext)) {
      return true;
    }
  }
  if (/(?:^|[\s_-])dj(?:$|[\s_-])/i.test(titleClean) && !/\bdj\b/i.test(reqContext)) {
    return true;
  }
  if (artistClean) {
    for (const pat of KNOCKOFF_ARTIST_PATTERNS) {
      if (pat.test(artistClean) && !pat.test(reqContext)) {
        return true;
      }
    }
  }
  return false;
}

export function selectSaavnArtistForMatch(
  primary: Array<{ name?: string }> | undefined,
  all: Array<{ name?: string }> | undefined,
  requestedArtist: string
): string {
  const primaryNames = (primary || []).map((artist) => (artist.name || '').trim()).filter(Boolean);
  if (primaryNames.length) return primaryNames.join(', ');

  // The "all" list can contain composers, lyricists, and producers. Only use it
  // when it unambiguously contains one artist and that name exactly matches the
  // requested artist; never promote a partial/ambiguous credit to lead artist.
  const allNames = (all || []).map((artist) => decodeHtmlEntities(artist.name || '').trim()).filter(Boolean);
  const normalize = (value: string) =>
    decodeHtmlEntities(value).toLowerCase().normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  if (allNames.length === 1 && normalize(allNames[0]) === normalize(requestedArtist)) {
    return allNames[0];
  }
  return '';
}

export function splitArtistTokens(artist: string): string[] {
  const cleaned = decodeHtmlEntities(artist).toLowerCase();
  const tokens = cleaned
    .split(/[,&/]|\bfeat\.?\b|\bft\.?\b|\bwith\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);
  if (tokens.length > 0) return tokens;
  const fallback = cleaned.trim();
  return fallback.length >= 2 ? [fallback] : [];
}

export function scoreAuthenticTrackCandidate(params: {
  itemTitle: string;
  itemArtist: string;
  requestedTitle: string;
  requestedArtist: string;
  itemDurationSec?: number;
  targetDurationSec?: number;
  allowCjkDurationMatch?: boolean;
}): number | null {
  const itemTitle = decodeHtmlEntities(params.itemTitle).trim();
  const itemArtist = decodeHtmlEntities(params.itemArtist).trim();
  const reqTitle = decodeHtmlEntities(params.requestedTitle).trim();
  const reqArtist = decodeHtmlEntities(params.requestedArtist).trim();

  if (!itemTitle) return null;
  if (isRemixOrKnockoff(itemTitle, reqTitle, itemArtist, reqArtist)) {
    return null;
  }

  const itemTitleLow = itemTitle.toLowerCase();
  const reqTitleLow = reqTitle.toLowerCase();
  const itemArtistLow = itemArtist.toLowerCase();

  // Strictly match requestedArtist tokens ONLY against itemArtist (never itemTitle!)
  const artistTokens = splitArtistTokens(reqArtist);
  if (artistTokens.length > 0) {
    if (!itemArtistLow) return null;
    const artistMatched = artistTokens.some((tok) => itemArtistLow.includes(tok));
    if (!artistMatched) return null;
  }

  // Match title words
  const significantWords = reqTitleLow
    .replace(/[()[\].,!?'"-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  const titleWords =
    significantWords.length > 0
      ? significantWords
      : reqTitleLow
          .replace(/[()[\].,!?'"-]/g, ' ')
          .split(/\s+/)
          .filter((w) => w.length >= 2);

  const hasCjk = /[\u3040-\u30ff\u4e00-\u9faf]/.test(itemTitle);
  const itemDur = params.itemDurationSec || 0;
  const targetDur = params.targetDurationSec || 0;

  // Music search endpoints occasionally return podcasts, mixes, or long-form uploads.
  // Never accept those as a song, and reject candidates whose runtime is far from
  // the requested catalogue track instead of merely applying a small score penalty.
  if (itemDur > 0 && itemDur > 15 * 60) return null;
  if (targetDur > 35 && itemDur > 0 && Math.abs(itemDur - targetDur) > 180) return null;

  const cjkExactArtistAndDuration =
    Boolean(params.allowCjkDurationMatch) &&
    hasCjk &&
    artistTokens.length > 0 &&
    targetDur > 35 &&
    itemDur > 0 &&
    Math.abs(itemDur - targetDur) <= 15;

  if (titleWords.length > 0 && !cjkExactArtistAndDuration) {
    const matchedWords = titleWords.filter((w) => itemTitleLow.includes(w)).length;
    if (matchedWords === 0) return null;
    if (titleWords.length >= 2 && matchedWords < Math.ceil(titleWords.length / 2)) {
      return null;
    }
  }

  let score = 0;
  const baseItemTitle = itemTitleLow.split('(')[0]?.split('-')[0]?.trim() || itemTitleLow;
  const baseReqTitle = reqTitleLow.split('(')[0]?.split('-')[0]?.trim() || reqTitleLow;

  if (itemTitleLow === reqTitleLow) score += 100;
  else if (baseItemTitle === baseReqTitle) score += 60;
  else if (itemTitleLow.includes(reqTitleLow)) score += 35;

  if (itemTitleLow.includes('(') && !reqTitleLow.includes('(')) {
    score -= 25;
  }

  const matchedArtistTokens = artistTokens.filter((tok) => itemArtistLow.includes(tok)).length;
  score += matchedArtistTokens * 25;
  if (reqArtist && itemArtistLow === reqArtist.toLowerCase()) {
    score += 30;
  }

  if (targetDur > 35 && itemDur > 0) {
    const diff = Math.abs(itemDur - targetDur);
    if (diff <= 10) score += 30;
    else if (diff <= 25) score += 15;
    else if (diff > 120) score -= 30;
  }
  if (cjkExactArtistAndDuration) score += 45;

  return score;
}

/**
 * Detects instrumental / karaoke / no-lyrics / low-value spam tracks
 * so they are removed or demoted from priority recommendations and search.
 */
export function isInstrumentalOrLowValueTrack(track: Track): boolean {
  const hay = `${track.name} ${track.albumName} ${track.genre || ''}`.toLowerCase();
  const bannedPatterns = [
    'instrumental',
    'karaoke',
    'off vocal',
    'no vocal',
    'type beat',
    'minus one',
    'sped up',
    'slowed + reverb',
    'white noise',
    'rain sound',
  ];
  return bannedPatterns.some((pat) => hay.includes(pat));
}

export function isUnnecessaryNoLyricsTrack(track: Track): boolean {
  return track.hasLyrics === false || isInstrumentalOrLowValueTrack(track);
}

export function isRelevantTrackTitle(itemTitle: string, query: string, itemArtist = ''): boolean {
  const normalize = (value: string) =>
    decodeHtmlEntities(value)
      .toLowerCase()
      .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter((token) => token.length > 1);

  const titleTokens = normalize(itemTitle);
  const artistTokens = normalize(itemArtist);
  const queryTokens = normalize(query);
  if (titleTokens.length === 0 || queryTokens.length === 0) return false;

  const querySet = new Set(queryTokens);
  const titleOverlap = titleTokens.filter((token) => querySet.has(token)).length;
  const titleCoverage = titleOverlap / titleTokens.length;
  const matchedTokens = new Set([
    ...titleTokens.filter((token) => querySet.has(token)),
    ...artistTokens.filter((token) => querySet.has(token)),
  ]);
  const queryCoverage = matchedTokens.size / queryTokens.length;

  // Keep title matching strict, while allowing artist tokens to complete
  // a title-plus-artist query such as "Maharani Arpit Bala".
  return titleCoverage >= 0.6 && queryCoverage >= 0.5;
}

export function filterAndRankTracks(
  tracks: Track[],
  query: string,
  options: { prioritizeLyrics?: boolean; languageFilter?: MusicLanguage | 'All' } = {}
): Track[] {
  const { prioritizeLyrics = true, languageFilter = 'All' } = options;

  let pool = tracks.filter(
    (t) => !isRemixOrKnockoff(t.name, query, t.artist, query)
  );
  if (languageFilter !== 'All') {
    pool = pool.filter((t) => t.language === languageFilter);
  }
  // Lyrics are a ranking preference, not a hard filter: valid tracks without
  // lyric metadata must remain discoverable.
  const q = query.trim().toLowerCase();
  if (!q) {
    return prioritizeLyrics
      ? pool.sort((a, b) => Number(isUnnecessaryNoLyricsTrack(a)) - Number(isUnnecessaryNoLyricsTrack(b)))
      : pool;
  }

  pool = pool.filter((track) => isRelevantTrackTitle(track.name, q, track.artist));
  if (pool.length === 0) return [];

  const terms = q.split(/\s+/).filter(Boolean);
  const scored: Array<{ track: Track; score: number }> = [];

  for (const track of pool) {
    const title = track.name.toLowerCase();
    const artist = track.artist.toLowerCase();
    const album = track.albumName.toLowerCase();
    const genre = (track.genre || '').toLowerCase();
    const lang = (track.language || '').toLowerCase();
    const haystack = `${title} ${artist} ${album} ${genre} ${lang}`;

    let score = 0;
    if (title === q) score += 110;
    else if (title.startsWith(q)) score += 65;
    else if (title.includes(q)) score += 45;

    if (artist.includes(q)) score += 38;
    if (album.includes(q)) score += 20;
    if (genre.includes(q) || lang.includes(q)) score += 18;

    for (const term of terms) {
      if (haystack.includes(term)) score += 12;
    }

    if (score > 0) {
      // Prefer complete, playable recordings over previews and metadata-only entries.
      if (hasFullAudioStream(track)) score += 34;
      else if (track.previewUrl || (track.streamUrls && Object.values(track.streamUrls).some(Boolean))) score -= 24;
      else if (track.metadataOnly) score -= 12;
      if (isPlausibleSongDuration(track.duration)) score += 5;
      if (prioritizeLyrics) {
        if (track.hasLyrics || (track.lyrics && track.lyrics.length > 0)) score += 12;
        if (isUnnecessaryNoLyricsTrack(track)) score -= 80;
      }
      // Popularity is a tie-breaker, not a substitute for title/artist relevance.
      const popBoost = track.playCount ? Math.min(4, Math.log10(track.playCount) * 0.8) : 0;
      scored.push({ track, score: score + popBoost });
    }
  }

  return scored.sort((a, b) => b.score - a.score).map((item) => item.track);
}

export function mapCoordsToRegion(lat: number, lng: number): MusicRegion {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 'GLOBAL';
  // India & South Asia bounding box
  if (lat >= 6 && lat <= 37 && lng >= 68 && lng <= 98) return 'IN';
  // Japan bounding box
  if (lat >= 24 && lat <= 46 && lng >= 122 && lng <= 150) return 'JP';
  // UK bounding box
  if (lat >= 49.5 && lat <= 61 && lng >= -8.5 && lng <= 2) return 'GB';
  // North America / US
  if (lat >= 24 && lat <= 50 && lng >= -126 && lng <= -66) return 'US';
  return 'GLOBAL';
}

export function scoreTrackForUser(track: Track, profile: UserTasteProfile): number {
  if (isInstrumentalOrLowValueTrack(track)) return -500;
  if (isRemixOrKnockoff(track.name, '', track.artist, '')) return -500;

  let score = 0;
  // Lyrics are a preference, not a hard eligibility rule.
  if (profile.prioritizeLyrics !== false) {
    if (track.hasLyrics || (track.lyrics && track.lyrics.length > 0)) {
      score += 40;
    } else if (track.hasLyrics === false) {
      score -= 28;
    }
  }

  // Language and region are light discovery preferences, not musical similarity.
  // Keep them as tie-breakers so a language label cannot dominate recommendations.
  if (track.language && track.language !== 'Other') {
    const prefIdx = profile.preferredLanguages.indexOf(track.language);
    if (prefIdx >= 0) score += Math.max(1, 3 - prefIdx * 0.5);
    const langAff = Math.max(0, profile.languageAffinity[track.language] || 0);
    score += Math.min(2.5, Math.log1p(langAff) * 0.8);
  }
  if (track.region === profile.region) score += 1.5;

  // Artist affinity from user's plays, likes & explicit personalisation picks
  const primaryArtist = track.artist.split(',')[0]?.trim().toLowerCase() || '';
  const trackArtistLow = track.artist.toLowerCase();
  for (const [artName, weight] of Object.entries(profile.artistAffinity)) {
    if (primaryArtist.includes(artName.toLowerCase()) || trackArtistLow.includes(artName.toLowerCase())) {
      score += Math.min(24, Math.log1p(weight) * 8);
    }
  }
  for (const favArt of profile.favoriteArtists || []) {
    const tok = favArt.toLowerCase();
    if (tok && (primaryArtist.includes(tok) || trackArtistLow.includes(tok))) {
      score += 24;
    }
  }

  // Match musical descriptors, never language labels or album names, as mood signals.
  const normalizeTokens = (value: string) => value.toLowerCase()
    .normalize('NFKD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
  const genreTokens = new Set(normalizeTokens(track.genre || ''));
  const moodTokens = new Set((track.moods || []).flatMap(normalizeTokens));
  for (const mood of profile.preferredMoods || []) {
    const tokens = normalizeTokens(mood);
    if (tokens.some((token) => genreTokens.has(token) || moodTokens.has(token))) score += 8;
  }
  for (const [genreKey, weight] of Object.entries(profile.genreAffinity)) {
    const affinityTokens = normalizeTokens(genreKey);
    const overlap = affinityTokens.filter((token) => genreTokens.has(token)).length;
    if (overlap > 0 && affinityTokens.length) {
      score += Math.min(18, Math.max(0, weight) * 2.5 * (overlap / affinityTokens.length));
    }
  }
  if (profile.preferredMoods?.length && moodTokens.size) {
    const preferred = new Set(profile.preferredMoods.flatMap(normalizeTokens));
    const overlap = [...moodTokens].filter((token) => preferred.has(token)).length;
    score += Math.min(12, overlap * 4);
  }

  // Liked tracks boost & mild novelty penalty if just played very recently
  if (profile.likedIds.includes(track.id)) {
    score += 18;
  }
  const recentIdx = profile.recentIds.indexOf(track.id);
  if (recentIdx === 0) score -= 22;
  else if (recentIdx > 0 && recentIdx < 3) score -= 8;

  // Popularity tie-breaker
  if (track.playCount) {
    score += Math.min(12, Math.log10(track.playCount));
  }

  return score;
}

export function deriveDynamicTasteHighlights(profile: UserTasteProfile): {
  topArtists: string[];
  topLanguage: MusicLanguage | null;
  topGenre: string | null;
  repeatFocusedArtist: string | null;
  reason: string;
} {
  const artistEntries = Object.entries(profile.artistAffinity)
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1]);

  const topArtists = Array.from(
    new Set([
      ...artistEntries.map(([name]) => name),
      ...(profile.favoriteArtists || []),
    ])
  ).slice(0, 5);

  const topArtistEntry = artistEntries[0];
  const repeatFocusedArtist =
    topArtistEntry && topArtistEntry[1] >= 2 ? topArtistEntry[0] : null;

  const langEntries = Object.entries(profile.languageAffinity)
    .filter(([k, w]) => w > 0 && k !== 'Other')
    .sort((a, b) => b[1] - a[1]);
  const topLanguage =
    (langEntries[0]?.[0] as MusicLanguage | undefined) ||
    profile.preferredLanguages[0] ||
    null;

  const genreEntries = Object.entries(profile.genreAffinity)
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1]);
  const topGenre = genreEntries[0]?.[0] || null;

  let reason = `Tailored for ${REGION_LABELS[profile.region]}`;
  if (repeatFocusedArtist && topLanguage) {
    reason = `Because you keep listening to ${repeatFocusedArtist} · ${topLanguage} · ${REGION_LABELS[profile.region]}`;
  } else if (topArtists.length && topLanguage) {
    reason = `Based on ${topArtists[0]} · ${topLanguage} · ${REGION_LABELS[profile.region]}`;
  }

  return {
    topArtists,
    topLanguage,
    topGenre,
    repeatFocusedArtist,
    reason,
  };
}

export function isSpotifyLinkOrUri(input: string): boolean {
  const trimmed = String(input || '').trim();
  return (
    /open\.spotify\.com\/(?:intl-[a-z-]+\/)?(track|album|playlist|artist)\/[a-zA-Z0-9]+/i.test(
      trimmed
    ) || /^spotify:(track|album|playlist|artist):[a-zA-Z0-9]+$/i.test(trimmed)
  );
}

export function extractSpotifySearchHint(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';

  const spotifyMatch = trimmed.match(/open\.spotify\.com\/(track|album|playlist|artist)\/([a-zA-Z0-9]+)/i);
  if (spotifyMatch) {
    const withoutUrl = trimmed.replace(/https?:\/\/\S+/gi, '').trim();
    if (withoutUrl.length >= 2) return withoutUrl;
    return `${spotifyMatch[1]} hits`;
  }

  return trimmed.slice(0, 120);
}

export function toggleTrackInLiked(
  likedMap: Record<string, Track>,
  track: Track
): { nextMap: Record<string, Track>; added: boolean } {
  const exists = Boolean(likedMap[track.id]);
  const nextMap = { ...likedMap };
  if (exists) {
    delete nextMap[track.id];
    return { nextMap, added: false };
  }
  nextMap[track.id] = track;
  return { nextMap, added: true };
}

export function addTrackToPlaylist(
  playlists: CuratedPlaylist[],
  playlistId: string,
  track: Track
): { playlists: CuratedPlaylist[]; added: boolean } {
  let added = false;
  const next = playlists.map((pl) => {
    if (pl.id !== playlistId) return pl;
    if (pl.tracks.some((t) => t.id === track.id)) return pl;
    added = true;
    return { ...pl, tracks: [...pl.tracks, track] };
  });
  return { playlists: next, added };
}

export function removeQueueItem(
  queue: Track[],
  currentIndex: number,
  removeIndex: number
): { queue: Track[]; currentIndex: number; removedCurrent: boolean } {
  if (!Number.isInteger(removeIndex) || removeIndex < 0 || removeIndex >= queue.length) {
    return { queue, currentIndex, removedCurrent: false };
  }
  const next = queue.filter((_, index) => index !== removeIndex);
  const removedCurrent = removeIndex === currentIndex;
  if (!next.length) return { queue: next, currentIndex: 0, removedCurrent };
  const nextIndex = removeIndex < currentIndex
    ? currentIndex - 1
    : removedCurrent
      ? Math.min(removeIndex, next.length - 1)
      : Math.min(Math.max(0, currentIndex), next.length - 1);
  return { queue: next, currentIndex: nextIndex, removedCurrent };
}

export function reorderQueueItem(
  queue: Track[],
  currentIndex: number,
  fromIndex: number,
  toIndex: number
): { queue: Track[]; currentIndex: number } {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= queue.length ||
    toIndex >= queue.length ||
    fromIndex === toIndex
  ) {
    return { queue, currentIndex };
  }

  const next = queue.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);

  let nextIdx = currentIndex;
  if (currentIndex === fromIndex) {
    nextIdx = toIndex;
  } else if (fromIndex < currentIndex && toIndex >= currentIndex) {
    nextIdx = currentIndex - 1;
  } else if (fromIndex > currentIndex && toIndex <= currentIndex) {
    nextIdx = currentIndex + 1;
  }

  return { queue: next, currentIndex: nextIdx };
}

export function sortTracks(
  tracks: Track[],
  mode: 'default' | 'title' | 'artist' | 'duration'
): Track[] {
  if (mode === 'default') return tracks;
  const copy = tracks.slice();
  if (mode === 'title') {
    return copy.sort((a, b) => a.name.localeCompare(b.name));
  }
  if (mode === 'artist') {
    return copy.sort((a, b) => a.artist.localeCompare(b.artist));
  }
  return copy.sort((a, b) => a.duration - b.duration);
}


export type DiscoverMood =
  | 'Bollywood Romantic'
  | 'Anime & J-Pop'
  | 'Late Night Dark'
  | 'Acoustic Unplugged'
  | 'Workout Energy'
  | 'Indie & R&B';

/** Normalize language labels and ISO-style codes from catalogue metadata only. */
export function normalizeDiscoverLanguage(value?: string): MusicLanguage | null {
  const key = (value || '').toLocaleLowerCase().trim().replace(/_/g, '-');
  const aliases: Record<string, MusicLanguage> = {
    hi: 'Hindi', hin: 'Hindi', hindi: 'Hindi',
    pa: 'Punjabi', pan: 'Punjabi', punjabi: 'Punjabi',
    en: 'English', eng: 'English', english: 'English',
    ja: 'Japanese', jpn: 'Japanese', 'ja-jp': 'Japanese', japanese: 'Japanese', 'j-pop': 'Japanese', jpop: 'Japanese',
    ko: 'Korean', kor: 'Korean', korean: 'Korean',
    fr: 'French', french: 'French', es: 'Spanish', spanish: 'Spanish',
    bn: 'Bengali', bengali: 'Bengali', bangla: 'Bengali',
    ta: 'Tamil', tamil: 'Tamil', te: 'Telugu', telugu: 'Telugu',
    mr: 'Marathi', marathi: 'Marathi', ur: 'Urdu', urdu: 'Urdu',
    gu: 'Gujarati', gujarati: 'Gujarati', ml: 'Malayalam', malayalam: 'Malayalam',
    kn: 'Kannada', kannada: 'Kannada', zh: 'Chinese', chinese: 'Chinese', mandarin: 'Chinese',
    ar: 'Arabic', arabic: 'Arabic', pt: 'Portuguese', portuguese: 'Portuguese',
    de: 'German', german: 'German', it: 'Italian', italian: 'Italian',
    tr: 'Turkish', turkish: 'Turkish', th: 'Thai', thai: 'Thai',
    id: 'Indonesian', indonesian: 'Indonesian', bhojpuri: 'Bhojpuri', haryanvi: 'Haryanvi',
  };
  return aliases[key] || null;
}

/**
 * Match moods from explicit mood tags and sound metadata only.
 * Track titles and album names are deliberately excluded.
 */
export function trackMatchesDiscoverMood(track: Track, mood: DiscoverMood): boolean {
  const genre = (track.genre || '').toLocaleLowerCase();
  const tags = (track.moods || []).map((tag) => tag.toLocaleLowerCase().trim());
  const hasTag = (pattern: RegExp) => tags.some((tag) => pattern.test(tag));
  const bpm = typeof track.bpm === 'number' ? track.bpm : null;
  const energy = typeof track.energy === 'number' ? track.energy : null;
  const synthMood = track.synthMood;

  switch (mood) {
    case 'Bollywood Romantic':
      return hasTag(/bollywood|romantic|love|ballad/) ||
        /bollywood.*(romance|romantic|love|ballad)|(romance|romantic|love|ballad).*bollywood/.test(genre) ||
        (normalizeDiscoverLanguage(track.language) === 'Hindi' && /romance|romantic|ballad/.test(genre));
    case 'Anime & J-Pop':
      return hasTag(/anime|j-?pop/) || /j-?pop|anime/.test(genre) || synthMood === 'jpop';
    case 'Late Night Dark':
      return hasTag(/late.?night|dark|ambient|downtempo|chill|lo.?fi/) ||
        /ambient|dark|downtempo|lo-fi|lofi|chill|trip-hop/.test(genre) ||
        synthMood === 'ambient' || synthMood === 'lofi';
    case 'Acoustic Unplugged':
      return hasTag(/acoustic|unplugged|folk/) || /acoustic|unplugged|singer.?songwriter|folk/.test(genre);
    case 'Workout Energy':
      return hasTag(/workout|energetic|high.?energy/) ||
        /dance|edm|electronic|workout|hard rock|hip.?hop/.test(genre) ||
        (bpm !== null && bpm >= 125 && energy !== null && energy >= 0.72) ||
        synthMood === 'energetic';
    case 'Indie & R&B':
      return hasTag(/indie|r.?&.?b|soul/) || /indie|r.?&.?b|soul|alternative/.test(genre);
    default:
      return false;
  }
}

/** Strict Discover eligibility: complete playable songs with credible metadata. */
export function isQualityDiscoverTrack(track: Track): boolean {
  return Boolean(
    track?.id &&
    track.name &&
    track.artist &&
    !track.metadataOnly &&
    track.sourceAvailability !== 'metadata' &&
    track.sourceAvailability !== 'preview' &&
    hasFullAudioStream(track) &&
    isPlausibleSongDuration(track.duration) &&
    !isInstrumentalOrLowValueTrack(track)
  );
}

export interface DiscoverTasteSignals {
  likedTracks: Track[];
  playCounts: Record<string, number>;
  artistAffinity: Record<string, number>;
  genreAffinity: Record<string, number>;
  preferredLanguages: MusicLanguage[];
  favoriteArtists: string[];
  preferredMoods: string[];
}

/** Rank catalogue results with local listener signals and a greedy diversity pass. */
export function rankDiscoverTracks(
  tracks: Track[],
  recentlyPlayed: Track[],
  taste: DiscoverTasteSignals,
  rotation = 0
): Track[] {
  const normalize = (value: string) =>
    value.toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim();
  const artistKey = (track: Track) =>
    normalize(track.artist.split(/,|&|\bfeat\.?\b|\bft\.?\b|\bwith\b/i)[0] || track.artist);
  const genreKey = (track: Track) => normalize((track.genre || '').split(/[,/&]/)[0] || '');
  const recentIds = new Set(recentlyPlayed.slice(0, 8).map((track) => track.id));
  const likedArtists = new Set(taste.likedTracks.map(artistKey));
  const likedGenres = new Set(taste.likedTracks.map(genreKey).filter(Boolean));
  const favoriteArtists = taste.favoriteArtists.map(normalize).filter(Boolean);
  const preferredLanguages = taste.preferredLanguages.map(normalize);
  const preferredMoods = taste.preferredMoods;
  const artistWeights = Object.entries(taste.artistAffinity).map(([key, value]) => [normalize(key), value] as const);
  const genreWeights = Object.entries(taste.genreAffinity).map(([key, value]) => [normalize(key), value] as const);
  const likedWithBpm = taste.likedTracks.map((track) => track.bpm).filter((bpm): bpm is number => typeof bpm === 'number' && bpm > 0);
  const likedWithEnergy = taste.likedTracks.map((track) => track.energy).filter((energy): energy is number => typeof energy === 'number' && energy >= 0 && energy <= 1);
  const averageBpm = likedWithBpm.length ? likedWithBpm.reduce((sum, bpm) => sum + bpm, 0) / likedWithBpm.length : null;
  const averageEnergy = likedWithEnergy.length ? likedWithEnergy.reduce((sum, energy) => sum + energy, 0) / likedWithEnergy.length : null;
  const likedMoodTokens = new Set(taste.likedTracks.flatMap((track) => (track.moods || []).flatMap((mood) => normalize(mood).split(/[^a-z0-9]+/).filter((token) => token.length >= 3))));

  const score = (track: Track): number => {
    const artist = artistKey(track);
    const genre = genreKey(track);
    const language = normalize(track.language || '');
    let value = 0;
    if (likedArtists.has(artist)) value += 3.5;
    if (favoriteArtists.some((name) => artist === name || artist.includes(name) || name.includes(artist))) value += 4.5;
    for (const [name, weight] of artistWeights) {
      if (name && (artist === name || artist.includes(name) || name.includes(artist))) {
        value += Math.min(4, Math.log1p(Math.max(0, weight)) * 1.5);
        break;
      }
    }
    if (likedGenres.has(genre) && genre) value += 2.5;
    const candidateGenreTokens = new Set(genre.split(/[^a-z0-9]+/).filter((token) => token.length >= 3));
    for (const [name, weight] of genreWeights) {
      const affinityTokens = name.split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
      const overlap = affinityTokens.filter((token) => candidateGenreTokens.has(token)).length;
      if (overlap > 0 && affinityTokens.length) {
        value += Math.min(3, Math.log1p(Math.max(0, weight)) * 1.2 * (overlap / affinityTokens.length));
      }
    }
    // Language is only a small tie-breaker; similarity comes from sound and genre.
    const languageIndex = preferredLanguages.indexOf(language);
    if (languageIndex >= 0) value += Math.max(0.15, 0.65 - languageIndex * 0.1);
    if (preferredMoods.some((mood) => trackMatchesDiscoverMood(track, mood as DiscoverMood))) value += 1.6;
    const candidateMoodTokens = new Set((track.moods || []).flatMap((mood) => normalize(mood).split(/[^a-z0-9]+/).filter((token) => token.length >= 3)));
    const sharedMoodCount = [...candidateMoodTokens].filter((token) => likedMoodTokens.has(token)).length;
    value += Math.min(2.4, sharedMoodCount * 0.8);
    if (averageBpm !== null && typeof track.bpm === 'number') value += Math.max(0, 1.8 - Math.abs(track.bpm - averageBpm) / 18);
    if (averageEnergy !== null && typeof track.energy === 'number') value += Math.max(0, 1.5 - Math.abs(track.energy - averageEnergy) * 5);
    const plays = Math.max(0, taste.playCounts[track.id] || 0);
    value -= Math.min(2.8, Math.log1p(plays) * 0.9);
    if (recentIds.has(track.id)) value -= 5;
    if (track.playCount && Number.isFinite(track.playCount)) value += Math.min(0.35, Math.log1p(Math.max(0, track.playCount)) * 0.025);
    return value;
  };

  const unique = new Map<string, Track>();
  for (const track of tracks) {
    if (!track || !track.id || !track.name || !track.artist) continue;
    const key = `${normalize(track.name)}::${artistKey(track)}`;
    if (!unique.has(key)) unique.set(key, track);
  }
  let pool = [...unique.values()];
  const freshPool = pool.filter((track) => !recentIds.has(track.id));
  if (freshPool.length) pool = freshPool;
  if (!pool.length) return [];

  const hash = (value: string) => {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      result ^= value.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return result >>> 0;
  };
  const baseScores = new Map(pool.map((track) => [
    track.id,
    score(track) + (hash(`${track.id}:${rotation}`) / 0xffffffff) * 0.08,
  ]));
  const artistCounts = new Map<string, number>();
  const genreCounts = new Map<string, number>();
  const ranked: Track[] = [];

  while (pool.length) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < pool.length; index += 1) {
      const track = pool[index];
      const artist = artistKey(track);
      const genre = genreKey(track);
      const diversityPenalty = (artistCounts.get(artist) || 0) * 2.2 + (genre ? (genreCounts.get(genre) || 0) * 0.65 : 0);
      const candidateScore = (baseScores.get(track.id) || 0) - diversityPenalty;
      if (candidateScore > bestScore) {
        bestScore = candidateScore;
        bestIndex = index;
      }
    }
    const [selected] = pool.splice(bestIndex, 1);
    ranked.push(selected);
    const artist = artistKey(selected);
    const genre = genreKey(selected);
    artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1);
    if (genre) genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
  }
  return ranked;
}
