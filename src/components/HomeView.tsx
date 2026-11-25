import { Play, Sparkles } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { SEED_PLAYLISTS } from '../data/catalog';
import type {
  MusicLanguage,
  MusicRegion,
  Track,
} from '../types/music';
import { dedupeCanonicalTracks, extractPrimaryArtistName } from '../utils/artistProfile';
import { getGreetingForHour, normalizeDiscoverLanguage, REGION_LABELS } from '../utils/playerEngine';
import { CoverImage } from './CoverImage';
import { DownloadButton } from './DownloadButton';

interface HomeViewProps {
  displayName: string;
  personalizedFeedTracks: Track[];
  region: MusicRegion;
  languageFilter: MusicLanguage | 'All';
  onLanguageFilterChange: (lang: MusicLanguage | 'All') => void;
  recommendedTracks: Track[];
  recommendationReason: string;
  regionalTracks: Track[];
  recentlyPlayed: Track[];
  likedCount: number;
  likedTracks: Track[];
  playCounts: Record<string, number>;
  playedTracks: Track[];
  downloadedIds: Set<string>;
  downloadingIds: Set<string>;
  onPlayTrackList: (tracks: Track[], startIndex: number) => void;
  onToggleDownload: (track: Track) => void;
  onOpenLiked: () => void;
  onOpenRecent: () => void;
  onOpenPersonalise: () => void;
  onOpenArtistName?: (artistName: string) => void;
}

export const HomeView = memo(function HomeView({
  displayName,
  personalizedFeedTracks,
  region,
  languageFilter,
  onLanguageFilterChange,
  recommendedTracks,
  recommendationReason,
  regionalTracks,
  recentlyPlayed,
  likedCount,
  likedTracks,
  playCounts,
  playedTracks,
  downloadedIds,
  downloadingIds,
  onPlayTrackList,
  onToggleDownload,
  onOpenLiked,
  onOpenRecent,
  onOpenPersonalise,
  onOpenArtistName,
}: HomeViewProps) {
  const [sessionSeed] = useState(() => Math.floor(Math.random() * 10000) + 1);
  const baseGreeting = getGreetingForHour(new Date().getHours());
  const cleanName = displayName.trim();
  const greeting =
    cleanName && cleanName.toLowerCase() !== 'listener'
      ? `${baseGreeting}, ${cleanName}`
      : baseGreeting;

  const filterByLang = (tracks: Track[]) => {
    if (languageFilter === 'All') return tracks;
    const targetLang = normalizeDiscoverLanguage(languageFilter) || languageFilter;
    return tracks.filter(
      (t) => (normalizeDiscoverLanguage(t.language) || t.language) === targetLang
    );
  };

  const visibleRecommended = filterByLang(recommendedTracks);
  const visibleRegional = filterByLang(regionalTracks);
  const randomDiscoverTracks = useMemo(() => {
    const excludeIds = new Set([
      ...visibleRecommended.slice(0, 5).map((t) => t.id),
      ...recentlyPlayed.slice(0, 5).map((t) => t.id),
    ]);
    const pool = dedupeCanonicalTracks(visibleRegional).filter(
      (track) => !excludeIds.has(track.id)
    );
    const hashScore = (id: string) => {
      let h = 2166136261 ^ sessionSeed;
      for (let i = 0; i < id.length; i += 1) {
        h ^= id.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return h >>> 0;
    };
    return [...pool]
      .sort((a, b) => hashScore(a.id) - hashScore(b.id))
      .slice(0, 5);
  }, [visibleRegional, visibleRecommended, recentlyPlayed, sessionSeed]);

  const smartTrackPool = useMemo(() => {
    const seen = new Set<string>();
    return [...playedTracks, ...likedTracks, ...recentlyPlayed, ...recommendedTracks, ...personalizedFeedTracks, ...regionalTracks]
      .filter((track) => {
        if (seen.has(track.id)) return false;
        seen.add(track.id);
        return true;
      });
  }, [playedTracks, likedTracks, recentlyPlayed, recommendedTracks, personalizedFeedTracks, regionalTracks]);

  const allTimeFavorites = useMemo(
    () => smartTrackPool
      .filter((track) => (playCounts[track.id] || 0) > 0)
      .sort((a, b) => (playCounts[b.id] || 0) - (playCounts[a.id] || 0))
      .slice(0, 10),
    [smartTrackPool, playCounts]
  );

  const repeatedLoves = useMemo(
    () => smartTrackPool
      .filter((track) => (playCounts[track.id] || 0) >= 2)
      .sort((a, b) => (playCounts[b.id] || 0) - (playCounts[a.id] || 0))
      .slice(0, 10),
    [smartTrackPool, playCounts]
  );

  const rediscoverLikes = useMemo(() => {
    const recentIds = new Set(recentlyPlayed.slice(0, 8).map((track) => track.id));
    return likedTracks.filter((track) => !recentIds.has(track.id)).slice(0, 10);
  }, [likedTracks, recentlyPlayed]);



  const usedQuickPickImages = new Set<string>([
    SEED_PLAYLISTS[4].image,
    ...(recentlyPlayed[0]?.image ? [recentlyPlayed[0].image] : []),
    ...(recommendedTracks[0]?.image ? [recommendedTracks[0].image] : []),
  ]);
  const distinctDiscoverQuickPick =
    regionalTracks.find((t) => t.image && !usedQuickPickImages.has(t.image)) || regionalTracks[0];

  const quickPicks = [
    {
      id: 'qp-liked',
      title: `Liked Songs (${likedCount})`,
      image: likedTracks[0]?.image || SEED_PLAYLISTS[4].image,
      onOpen: onOpenLiked,
      onPlay: likedTracks.length ? () => onPlayTrackList(likedTracks, 0) : null,
    },
    ...(recentlyPlayed.length
      ? [{
          id: 'qp-recent',
          title: 'Recently Played',
          image: recentlyPlayed[0].image || SEED_PLAYLISTS[0].image,
          onOpen: onOpenRecent,
          onPlay: () => onPlayTrackList(recentlyPlayed, 0),
        }]
      : []),
    ...(recommendedTracks.length
      ? [{
          id: 'qp-made-for-you',
          title: 'Made For You',
          image: recommendedTracks[0].image,
          onOpen: () => onPlayTrackList(recommendedTracks, 0),
          onPlay: () => onPlayTrackList(recommendedTracks, 0),
        }]
      : []),
    ...(distinctDiscoverQuickPick
      ? [{
          id: 'qp-discover',
          title: 'Discover Something New',
          image: distinctDiscoverQuickPick.image,
          onOpen: () => onPlayTrackList(regionalTracks, 0),
          onPlay: () => onPlayTrackList(regionalTracks, 0),
        }]
      : []),
  ].slice(0, 6);

  const renderTrackShelf = (title: string, subtitle: string, tracks: Track[]) => {
    const uniqueTracks = dedupeCanonicalTracks(tracks);
    if (!uniqueTracks.length) return null;
    return (
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-xl font-bold tracking-tight text-white">{title}</h2>
            {subtitle && <p className="text-xs text-zinc-400">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={() => onPlayTrackList(uniqueTracks, 0)}
            className="shrink-0 whitespace-nowrap text-xs font-bold text-zinc-400 hover:text-white"
          >
            Play all
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {uniqueTracks.slice(0, 5).map((track, idx) => {
            const isDownloaded = downloadedIds.has(track.id);
            const isDownloading = downloadingIds.has(track.id);
            const isOnlineOnly = track.offlineAvailable === false || track.sourceProvider === 'Jamendo';
            const primaryArtist = extractPrimaryArtistName(track.artist);
            return (
              <div
                key={`${title}-${track.id}`}
                className="harmonia-music-card group relative rounded-xl p-3"
              >
                <button
                  type="button"
                  onClick={() => onPlayTrackList(uniqueTracks, idx)}
                  className="w-full text-left focus:outline-none"
                >
                  <div className="relative aspect-square w-full overflow-hidden rounded-md bg-black shadow-lg">
                    <CoverImage
                      src={track.image}
                      alt={track.name}
                      className="h-full w-full object-cover"
                    />
                    <span
                      aria-hidden="true"
                      className="absolute bottom-2 right-2 grid h-9 w-9 place-items-center rounded-full bg-[#1DB954] text-black opacity-90 shadow-xl transition-all duration-150 sm:h-10 sm:w-10 sm:translate-y-2 sm:opacity-0 sm:group-hover:translate-y-0 sm:group-hover:opacity-100"
                    >
                      <Play className="h-4 w-4 fill-current pl-0.5" />
                    </span>
                  </div>
                  <div className="mt-3 truncate text-sm font-bold text-white">{track.name}</div>
                </button>
                {onOpenArtistName ? (
                  <button
                    type="button"
                    onClick={() => onOpenArtistName(primaryArtist)}
                    className="mt-0.5 block max-w-full truncate text-left text-xs text-zinc-400 hover:text-white hover:underline"
                  >
                    {track.artist}
                    {track.language ? ` · ${track.language}` : ''}
                  </button>
                ) : (
                  <div className="mt-0.5 truncate text-xs text-zinc-400">
                    {track.artist}
                    {track.language ? ` · ${track.language}` : ''}
                  </div>
                )}
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
      </section>
    );
  };

  return (
    <div className="space-y-7 pb-6">
      {/* Greeting + Spotify Filter Pills with subtle top ambient wash */}
      <div className="-mx-4 -mt-2 bg-gradient-to-b from-[#1e2a23]/65 via-[#121212] to-[#121212] px-4 pt-4 sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            {(['All', 'Hindi', 'English', 'J-Pop'] as const).map((lang) => {
              const active = languageFilter === lang;
              return (
                <button
                  key={lang}
                  type="button"
                  onClick={() => onLanguageFilterChange(lang)}
                  className={`harmonia-chip rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors ${
                    active
                      ? 'border-white bg-white text-black'
                      : 'bg-[#232327] text-zinc-200 hover:border-white/20 hover:bg-[#2e2e33]'
                  }`}
                >
                  {lang}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={onOpenPersonalise}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#232327] px-3.5 py-1.5 text-xs font-bold text-zinc-100 transition-colors hover:bg-[#2e2e33] hover:text-[#1DB954]"
          >
            <Sparkles className="h-3.5 w-3.5 text-[#1DB954]" />
            Personalise
          </button>
        </div>

        <h1 className="text-2xl font-extrabold tracking-tight text-white sm:text-[28px]">
          {greeting}
        </h1>

        {/* Spotify 2x3 Quick-Pick Grid */}
        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {quickPicks.map((item) => (
            <div
              key={item.id}
              className="harmonia-quick-pick group flex items-center overflow-hidden rounded-xl pr-3"
            >
              <button
                type="button"
                onClick={item.onOpen}
                className="flex min-w-0 flex-1 items-center gap-3 text-left focus:outline-none"
              >
                <CoverImage
                  src={item.image}
                  alt={item.title}
                  className="h-14 w-14 shrink-0 object-cover"
                />
                <span className="truncate text-[13.5px] font-bold text-white">
                  {item.title}
                </span>
              </button>

              {item.onPlay && (
                <button
                  type="button"
                  onClick={item.onPlay}
                  aria-label={`Play ${item.title}`}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#1DB954] text-black opacity-0 shadow-lg transition-all hover:scale-105 group-hover:opacity-100 focus:opacity-100"
                >
                  <Play className="h-4 w-4 fill-current pl-0.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Smart mixes generated from this listener's real play history */}
      {allTimeFavorites.length > 0 &&
        renderTrackShelf('All-Time Favourites', 'Your most-played tracks, ranked by your listening history', allTimeFavorites)}
      {repeatedLoves.length > 0 &&
        renderTrackShelf('Repeated Loves', 'Tracks you keep coming back to', repeatedLoves)}
      {rediscoverLikes.length > 0 &&
        renderTrackShelf('Rediscover Your Likes', 'Saved favourites you have not played lately', rediscoverLikes)}



      {/* User-Based Personalized Recommendations */}
      {visibleRecommended.length > 0 &&
        renderTrackShelf('Made For You', recommendationReason, visibleRecommended)}

      {randomDiscoverTracks.length > 0 &&
        renderTrackShelf('A Little Outside Your Usual', 'A rotating mix to help you discover something different', randomDiscoverTracks)}

      {/* Location-Based Regional Charts */}
      {renderTrackShelf(
        `Popular in ${REGION_LABELS[region]}`,
        'Location-tuned vocal tracks with verified lyrics',
        visibleRegional
      )}


    </div>
  );
});
