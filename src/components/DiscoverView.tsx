import { Compass, Play, Shuffle } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { MusicLanguage, Track } from '../types/music';
import { dedupeCanonicalTracks, extractPrimaryArtistName } from '../utils/artistProfile';
import { isQualityDiscoverTrack, normalizeDiscoverLanguage, type DiscoverMood } from '../utils/playerEngine';
import { curateAIRecommendations } from '../ai';
import { CoverImage } from './CoverImage';
import { DownloadButton } from './DownloadButton';

interface DiscoverViewProps {
  tracks: Track[];
  globalTracks: Track[];
  globalTracksLoading: boolean;
  regionalTracks: Track[];
  recentlyPlayed: Track[];
  downloadedIds: Set<string>;
  downloadingIds: Set<string>;
  onPlayTrackList: (tracks: Track[], startIndex: number) => void;
  onToggleDownload: (track: Track) => void;
  onRefresh: () => Promise<void>;
  onOpenArtistName?: (artistName: string) => void;
  likedTracks: Track[];
  playCounts: Record<string, number>;
  listeningFeedback: Record<string, { skips: number; completions: number }>;
  artistAffinity: Record<string, number>;
  genreAffinity: Record<string, number>;
  preferredLanguages: MusicLanguage[];
  favoriteArtists: string[];
  preferredMoods: string[];
}

const LANGUAGES: Array<MusicLanguage | 'All'> = ['All', 'Hindi', 'Punjabi', 'Haryanvi', 'Marathi', 'Bengali', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Gujarati', 'Bhojpuri', 'Urdu', 'English', 'Japanese', 'Korean', 'French', 'Spanish', 'Chinese', 'Arabic'];
const DISCOVER_MODES = ['Global Charts', 'Global Discover', 'Language Mix', 'Mood Mix', 'Regional Discover'] as const;
type DiscoverMode = typeof DISCOVER_MODES[number];
const MOODS: Array<DiscoverMood | 'All'> = ['All', 'Bollywood Romantic', 'Anime & J-Pop', 'Late Night Dark', 'Acoustic Unplugged', 'Workout Energy', 'Indie & R&B'];


export function DiscoverView({
  tracks,
  globalTracks,
  globalTracksLoading,
  regionalTracks,
  recentlyPlayed,
  downloadedIds,
  downloadingIds,
  onPlayTrackList,
  onToggleDownload,
  onRefresh,
  onOpenArtistName,
  likedTracks,
  playCounts,
  listeningFeedback,
  artistAffinity,
  genreAffinity,
  preferredLanguages,
  favoriteArtists,
  preferredMoods,
}: DiscoverViewProps) {
  const [mode, setMode] = useState<DiscoverMode>('Global Charts');
  const [language, setLanguage] = useState<MusicLanguage | 'All'>('All');
  const [mood, setMood] = useState<DiscoverMood | 'All'>('All');
  const [rotation, setRotation] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const candidatePool = useMemo(() => {
    const rawPool =
      mode === 'Global Charts'
        ? globalTracks
        : mode === 'Regional Discover'
          ? regionalTracks
          : [...globalTracks, ...regionalTracks, ...tracks];
    return dedupeCanonicalTracks(rawPool.filter(isQualityDiscoverTrack));
  }, [mode, globalTracks, regionalTracks, tracks]);

  const varied = useMemo(
    () => curateAIRecommendations(
      candidatePool,
      likedTracks,
      recentlyPlayed,
      80,
      {
        preferredMoods,
        favoriteArtists,
        preferredLanguages,
        genreAffinity,
        artistAffinity,
        playCounts,
        listeningFeedback,
        targetMood: mode === 'Mood Mix' && mood !== 'All' ? mood : undefined,
        rotation,
      },
    ).map((recommendation) => recommendation.track),
    [candidatePool, likedTracks, recentlyPlayed, preferredMoods, favoriteArtists, preferredLanguages, genreAffinity, artistAffinity, playCounts, listeningFeedback, mode, mood, rotation]
  );

  const modePool = useMemo(() => dedupeCanonicalTracks(varied.filter(isQualityDiscoverTrack)), [varied]);

  const visible = modePool.filter((track) =>
    mode !== 'Language Mix' || language === 'All' || normalizeDiscoverLanguage(track.language) === language
  );

  return (
    <section className="space-y-5 pb-8" aria-label="Discover music">
      <div className="rounded-xl bg-gradient-to-br from-[#1d3028] via-[#171d20] to-[#171719] p-5 sm:p-7">
        <div className="flex items-center gap-2 text-[#7ee2a8]">
          <Compass className="h-5 w-5" />
          <span className="text-xs font-bold uppercase tracking-[0.18em]">MusicKK Discover</span>
        </div>
        <h1 className="mt-3 text-2xl font-extrabold text-white sm:text-3xl">Discover by Language &amp; Mood</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-300">Explore worldwide charts, new discoveries, language mixes, sound-based moods and regional music.</p>
        <button type="button" disabled={refreshing} onClick={async () => {
          setRefreshing(true);
          try { await onRefresh(); setRotation((value) => value + 7); }
          finally { setRefreshing(false); }
        }} className="mt-4 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-bold text-black hover:bg-zinc-200 disabled:opacity-60">
          <Shuffle className="h-4 w-4" /> {refreshing ? 'Finding new tracks…' : 'Refresh discoveries'}
        </button>
      </div>

      {mode === 'Global Charts' && globalTracksLoading && (
        <p role="status" className="text-xs text-zinc-400">Loading worldwide chart data…</p>
      )}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {DISCOVER_MODES.map((item) => (
          <button key={item} type="button" onClick={() => setMode(item)} aria-pressed={mode === item} className={`shrink-0 rounded-full border px-3 py-2 text-xs font-semibold ${mode === item ? 'border-[#7ee2a8] bg-[#7ee2a8] text-black' : 'border-white/10 bg-[#242428] text-zinc-300'}`}>{item}</button>
        ))}
      </div>
      {mode === 'Language Mix' && (
        <div className="space-y-2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Choose a language</div>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {LANGUAGES.map((item) => <button key={item} type="button" onClick={() => setLanguage(item)} aria-pressed={language === item} className={`shrink-0 rounded-full border px-3 py-2 text-xs font-semibold ${language === item ? 'border-[#7ee2a8] bg-[#7ee2a8] text-black' : 'border-white/10 bg-[#242428] text-zinc-300'}`}>{item}</button>)}
          </div>
        </div>
      )}
      {mode === 'Mood Mix' && (
        <div className="space-y-2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Choose a sound or mood</div>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {MOODS.map((item) => <button key={item} type="button" onClick={() => setMood(item)} aria-pressed={mood === item} className={`shrink-0 rounded-full border px-3 py-2 text-xs font-semibold ${mood === item ? 'border-[#7ee2a8] bg-[#7ee2a8] text-black' : 'border-white/10 bg-[#242428] text-zinc-300'}`}>{item}</button>)}
          </div>
        </div>
      )}
      <p className="text-[11px] text-zinc-500">Filters use catalogue language, genre, tempo and explicit mood tags. Unknown metadata stays unclassified.</p>

      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-white">{mode}</h2>
          <p className="text-xs text-zinc-400">Chart data ranks popular tracks; discovery pools diversify repeated artists.</p>
        </div>
        {visible.length > 0 && <button type="button" onClick={() => onPlayTrackList(visible, 0)} className="shrink-0 whitespace-nowrap text-xs font-bold text-zinc-300 hover:text-white"><Play className="mr-1 inline h-3.5 w-3.5 fill-current" /> Play all</button>}
      </div>

      {visible.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {visible.slice(0, 40).map((track, index) => {
            const isDownloaded = downloadedIds.has(track.id);
            const isDownloading = downloadingIds.has(track.id);
            const isOnlineOnly = track.offlineAvailable === false || track.sourceProvider === 'Jamendo';
            const primaryArtist = extractPrimaryArtistName(track.artist);
            return (
              <div
                key={track.id}
                className="group relative min-w-0 rounded-lg bg-[#18181b] p-3 text-left transition-colors hover:bg-[#252529]"
              >
                <button
                  type="button"
                  onClick={() => onPlayTrackList(visible, index)}
                  className="w-full text-left focus:outline-none"
                >
                  <div className="relative aspect-square overflow-hidden rounded-md bg-black">
                    <CoverImage src={track.image} alt={track.name} className="h-full w-full object-cover" />
                    <span className="absolute bottom-2 right-2 grid h-9 w-9 place-items-center rounded-full bg-[#1DB954] text-black opacity-90 shadow-lg transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                      <Play className="h-4 w-4 fill-current" />
                    </span>
                  </div>
                  <div className="mt-2 truncate text-sm font-bold text-white">{track.name}</div>
                </button>
                {onOpenArtistName ? (
                  <button
                    type="button"
                    onClick={() => onOpenArtistName(primaryArtist)}
                    className="mt-0.5 block max-w-full truncate text-left text-xs text-zinc-400 hover:text-white hover:underline"
                  >
                    {track.artist}
                  </button>
                ) : (
                  <div className="mt-0.5 truncate text-xs text-zinc-400">{track.artist}</div>
                )}
                <div className="mt-1 truncate text-[10px] text-zinc-500">
                  {[track.language, track.genre].filter(Boolean).join(' · ') || 'Explore'}
                </div>
                <DownloadButton
                  trackName={track.name}
                  downloaded={isDownloaded}
                  downloading={isDownloading}
                  onClick={() => onToggleDownload(track)}
                  disabled={isOnlineOnly}
                  disabledReason="This provider supports online listening only"
                  size="xs"
                  className={`absolute right-4.5 top-4.5 z-10 shadow-md transition-opacity ${
                    isDownloaded || isDownloading
                      ? 'opacity-100'
                      : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100'
                  }`}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg bg-[#18181b] p-6 text-sm text-zinc-400">No fresh tracks in this filter yet. Try All or check back after discovery sources refresh.</div>
      )}
    </section>
  );
}
