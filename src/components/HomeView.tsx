import { Play, Sparkles } from 'lucide-react';
import { memo, useMemo } from 'react';
import { SEED_PLAYLISTS } from '../data/catalog';
import type {
  MusicLanguage,
  MusicRegion,
  Track,
} from '../types/music';
import { getGreetingForHour, REGION_LABELS } from '../utils/playerEngine';
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
}: HomeViewProps) {
  const baseGreeting = getGreetingForHour(new Date().getHours());
  const cleanName = displayName.trim();
  const greeting =
    cleanName && cleanName.toLowerCase() !== 'listener'
      ? `${baseGreeting}, ${cleanName}`
      : baseGreeting;

  const filterByLang = (tracks: Track[]) =>
    languageFilter === 'All'
      ? tracks
      : tracks.filter((t) => t.language === languageFilter);

  const visibleRecommended = filterByLang(recommendedTracks);
  const visibleRegional = filterByLang(regionalTracks);
  const randomDiscoverTracks = useMemo(() => {
    const recentIds = new Set([...recommendedTracks, ...recentlyPlayed].map((track) => track.id));
    const pool = regionalTracks.filter((track) => !recentIds.has(track.id));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, 5);
  }, [regionalTracks, recommendedTracks, recentlyPlayed]);

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



  const quickPicks = [
    {
      id: 'qp-liked',
      title: `Liked Songs (${likedCount})`,
      image: SEED_PLAYLISTS[4].image,
      onOpen: onOpenLiked,
      onPlay: onOpenLiked,
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
    ...(regionalTracks.length
      ? [{
          id: 'qp-discover',
          title: 'Discover Something New',
          image: regionalTracks[0].image,
          onOpen: () => onPlayTrackList(regionalTracks, 0),
          onPlay: () => onPlayTrackList(regionalTracks, 0),
        }]
      : []),
  ].slice(0, 6);

  const renderTrackShelf = (title: string, subtitle: string, tracks: Track[]) => {
    const seenShelfIds = new Set<string>();
    const uniqueTracks = tracks.filter((track) => {
      if (!track?.id || seenShelfIds.has(track.id)) return false;
      seenShelfIds.add(track.id);
      return true;
    });
    if (!uniqueTracks.length) return null;
    return (
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-white">{title}</h2>
            {subtitle && <p className="text-xs text-zinc-400">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={() => onPlayTrackList(uniqueTracks, 0)}
            className="text-xs font-bold text-zinc-400 hover:text-white"
          >
            Play all
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {uniqueTracks.slice(0, 5).map((track, idx) => {
            const isDownloaded = downloadedIds.has(track.id);
            const isDownloading = downloadingIds.has(track.id);
            const isOnlineOnly = track.offlineAvailable === false || track.sourceProvider === 'Jamendo';
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
                      className="absolute bottom-2 right-2 grid h-10 w-10 translate-y-2 place-items-center rounded-full bg-[#1DB954] text-black opacity-0 shadow-xl transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100"
                    >
                      <Play className="h-4 w-4 fill-current pl-0.5" />
                    </span>
                  </div>
                  <div className="mt-3 truncate text-sm font-bold text-white">{track.name}</div>
                  <div className="mt-0.5 truncate text-xs text-zinc-400">
                    {track.artist}
                    {track.language ? ` · ${track.language}` : ''}
                  </div>
                </button>
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

              <button
                type="button"
                onClick={item.onPlay}
                aria-label={`Play ${item.title}`}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#1DB954] text-black opacity-0 shadow-lg transition-all hover:scale-105 group-hover:opacity-100 focus:opacity-100"
              >
                <Play className="h-4 w-4 fill-current pl-0.5" />
              </button>
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
