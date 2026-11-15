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
  GLOBAL: 'Global Mix',
};

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
  if (
    url.startsWith('/') ||
    url.startsWith('data:') ||
    url.startsWith('blob:') ||
    url.startsWith('/api/music/image')
  ) {
    return url;
  }
  if (/^https?:\/\//i.test(url)) {
    if (url.startsWith('https://') && isFastImageCdn(url)) {
      return url;
    }
    return `/api/music/image?url=${encodeURIComponent(url)}`;
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

export function hasFullPlaybackSource(track: Track | null | undefined): boolean {
  if (!track) return false;
  return hasFullAudioStream(track) || Boolean(track.youtubeId);
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
export function isUnnecessaryNoLyricsTrack(track: Track): boolean {
  if (track.hasLyrics === false) return true;
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
  if (prioritizeLyrics) {
    const withLyrics = pool.filter((t) => !isUnnecessaryNoLyricsTrack(t));
    if (withLyrics.length > 0) {
      pool = withLyrics;
    }
  }

  const q = query.trim().toLowerCase();
  if (!q) return pool;

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
      if (track.hasLyrics || (track.lyrics && track.lyrics.length > 0)) {
        score += 20;
      }
      if (isUnnecessaryNoLyricsTrack(track)) {
        score -= 80;
      }
      const popBoost = track.playCount ? Math.min(10, Math.log10(track.playCount)) : 0;
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
  if (isUnnecessaryNoLyricsTrack(track)) return -500;
  if (isRemixOrKnockoff(track.name, '', track.artist, '')) return -500;

  let score = 0;
  // Lyrics priority boost
  if (track.hasLyrics || (track.lyrics && track.lyrics.length > 0)) {
    score += 40;
  }

  // Preferred languages boost (Hindi, English, J-Pop prioritized)
  if (track.language && track.language !== 'Other') {
    const prefIdx = profile.preferredLanguages.indexOf(track.language);
    if (prefIdx >= 0) {
      score += 36 - prefIdx * 6;
    }
    const langAff = profile.languageAffinity[track.language] || 0;
    score += Math.min(75, langAff * 8);
  }

  // Regional match boost
  if (track.region === profile.region) {
    score += 24;
  } else if (profile.region === 'IN' && track.language === 'Hindi') {
    score += 24;
  } else if (profile.region === 'JP' && track.language === 'J-Pop') {
    score += 24;
  } else if ((profile.region === 'US' || profile.region === 'GB') && track.language === 'English') {
    score += 20;
  }

  // Artist affinity from user's plays, likes & explicit personalisation picks
  const primaryArtist = track.artist.split(',')[0]?.trim().toLowerCase() || '';
  const trackArtistLow = track.artist.toLowerCase();
  for (const [artName, weight] of Object.entries(profile.artistAffinity)) {
    if (primaryArtist.includes(artName.toLowerCase()) || trackArtistLow.includes(artName.toLowerCase())) {
      score += Math.min(120, weight * 14);
    }
  }
  for (const favArt of profile.favoriteArtists || []) {
    const tok = favArt.toLowerCase();
    if (tok && (primaryArtist.includes(tok) || trackArtistLow.includes(tok))) {
      score += 50;
    }
  }

  // Preferred moods & Genre affinity
  const genreOrAlbum = `${track.genre || ''} ${track.albumName || ''}`.toLowerCase();
  for (const mood of profile.preferredMoods || []) {
    const mTokens = mood.toLowerCase().split(/[\s&/]+/).filter((t) => t.length >= 3);
    if (mTokens.some((tok) => genreOrAlbum.includes(tok) || (track.language || '').toLowerCase().includes(tok))) {
      score += 22;
    }
  }
  if (track.genre) {
    for (const [genreKey, weight] of Object.entries(profile.genreAffinity)) {
      if (track.genre.toLowerCase().includes(genreKey.toLowerCase())) {
        score += Math.min(40, weight * 5);
      }
    }
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
    .filter(([k, w]) => w > 0 && (k === 'Hindi' || k === 'English' || k === 'J-Pop'))
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
