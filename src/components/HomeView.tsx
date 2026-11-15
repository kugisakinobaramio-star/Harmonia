import { Play, Sparkles } from 'lucide-react';
import { useMemo } from 'react';
import { SEED_PLAYLISTS } from '../data/catalog';
import type {
  CuratedPlaylist,
  MusicLanguage,
  MusicRegion,
  Track,
} from '../types/music';
import { getGreetingForHour, REGION_LABELS } from '../utils/playerEngine';
import { CoverImage } from './CoverImage';

interface HomeViewProps {
  displayName: string;
  personalizedFeedTracks: Track[];
  region: MusicRegion;
  languageFilter: MusicLanguage | 'All';
  onLanguageFilterChange: (lang: MusicLanguage | 'All') => void;
  recommendedTracks: Track[];
  recommendationReason: string;
  regionalTracks: Track[];
  spotifyPlaylists: CuratedPlaylist[];
  recentlyPlayed: Track[];
  likedCount: number;
  tasteHighlights?: {
    topArtists: string[];
    topLanguage: MusicLanguage | null;
    topGenre: string | null;
    repeatFocusedArtist: string | null;
    reason: string;
  };
  onPlayTrackList: (tracks: Track[], startIndex: number) => void;
  onOpenPlaylist: (pl: CuratedPlaylist) => void;
  onOpenLiked: () => void;
  onOpenRecent: () => void;
  onOpenPersonalise: () => void;
}

export function HomeView({
  displayName,
  personalizedFeedTracks,
  region,
  languageFilter,
  onLanguageFilterChange,
  recommendedTracks,
  recommendationReason,
  regionalTracks,
  spotifyPlaylists,
  recentlyPlayed,
  likedCount,
  tasteHighlights,
  onPlayTrackList,
  onOpenPlaylist,
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

  const repeatFocusedArtist = tasteHighlights?.repeatFocusedArtist;
  const repeatArtistTracks = useMemo(() => {
    if (!repeatFocusedArtist) return [];
    const q = repeatFocusedArtist.toLowerCase();
    const pool = [...recommendedTracks, ...personalizedFeedTracks, ...regionalTracks, ...recentlyPlayed];
    const seen = new Set<string>();
    const res: Track[] = [];
    for (const t of pool) {
      if (t.artist.toLowerCase().includes(q)) {
        const key = `${t.name.toLowerCase()}::${t.artist.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          res.push(t);
        }
      }
    }
    return res;
  }, [repeatFocusedArtist, recommendedTracks, personalizedFeedTracks, regionalTracks, recentlyPlayed]);

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
    ...spotifyPlaylists.slice(0, 3).map((playlist) => ({
      id: playlist.id,
      title: playlist.name,
      image: playlist.image,
      onOpen: () => onOpenPlaylist(playlist),
      onPlay: () => onPlayTrackList(playlist.tracks, 0),
    })),
  ].slice(0, 6);

  const renderTrackShelf = (title: string, subtitle: string, tracks: Track[]) => {
    if (!tracks.length) return null;
    return (
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-white">{title}</h2>
            {subtitle && <p className="text-xs text-zinc-400">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={() => onPlayTrackList(tracks, 0)}
            className="text-xs font-bold text-zinc-400 hover:text-white"
          >
            Play all
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {tracks.slice(0, 5).map((track, idx) => (
            <div
              key={`${title}-${track.id}`}
              className="group relative rounded-lg bg-[#161619] p-3 transition-colors hover:bg-[#222227]"
            >
              <button
                type="button"
                onClick={() => onPlayTrackList(tracks, idx)}
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
            </div>
          ))}
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
                  className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors ${
                    active
                      ? 'bg-white text-black'
                      : 'bg-[#232327] text-zinc-200 hover:bg-[#2e2e33]'
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
              className="group flex items-center overflow-hidden rounded-md bg-white/[0.06] pr-3 transition-colors hover:bg-white/[0.12]"
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

      {/* Dynamic Repeat-Listening Shelf: Heavy Rotation */}
      {repeatFocusedArtist && repeatArtistTracks.length > 0 &&
        renderTrackShelf(
          `Heavy Rotation: ${repeatFocusedArtist}`,
          `Based on your repeated plays · Ranked for your listening habits`,
          filterByLang(repeatArtistTracks).length ? filterByLang(repeatArtistTracks) : repeatArtistTracks
        )}

      {/* User-Based Personalized Recommendations */}
      {visibleRecommended.length > 0 &&
        renderTrackShelf('Made For You', recommendationReason, visibleRecommended)}

      {randomDiscoverTracks.length > 0 &&
        renderTrackShelf('A Little Outside Your Usual', 'A rotating mix to help you discover something different', randomDiscoverTracks)}

      {/* Dynamic Language Affinity Shelf */}
      {tasteHighlights?.topLanguage &&
        languageFilter === 'All' &&
        renderTrackShelf(
          `Your ${tasteHighlights.topLanguage} Mix`,
          `Because you listen to ${tasteHighlights.topLanguage} music repeatedly`,
          allCatalogTracks.filter((t) => t.language === tasteHighlights.topLanguage)
        )}



      {/* Spotify Free — Ad-Free Live Editorial Playlists */}
      {spotifyPlaylists.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-white">
                Spotify Free Mixes
              </h2>
              <p className="text-xs text-zinc-400">
                Live Spotify charts & playlists · No API key · Ad-free streaming
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
            {spotifyPlaylists
              .filter(
                (pl) =>
                  languageFilter === 'All' ||
                  pl.language === languageFilter ||
                  pl.language === 'Mixed'
              )
              .slice(0, 5)
              .map((pl) => (
                <div
                  key={pl.id}
                  className="group relative rounded-lg bg-[#161619] p-3 transition-colors hover:bg-[#222227]"
                >
                  <button
                    type="button"
                    onClick={() => onOpenPlaylist(pl)}
                    className="w-full text-left focus:outline-none"
                  >
                    <div className="relative aspect-square w-full overflow-hidden rounded-md bg-black shadow-lg">
                      <CoverImage
                        src={pl.image}
                        alt={pl.name}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="mt-3 truncate text-sm font-bold text-white">{pl.name}</div>
                    <div className="mt-0.5 truncate text-xs text-zinc-400">{pl.description}</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onPlayTrackList(pl.tracks, 0)}
                    aria-label={`Play ${pl.name}`}
                    className="absolute bottom-[74px] right-5 grid h-10 w-10 translate-y-2 place-items-center rounded-full bg-[#1DB954] text-black opacity-0 shadow-xl transition-all duration-150 hover:scale-105 group-hover:translate-y-0 group-hover:opacity-100 focus:opacity-100"
                  >
                    <Play className="h-4 w-4 fill-current pl-0.5" />
                  </button>
                </div>
              ))}
          </div>
        </section>
      )}

      {/* Location-Based Regional Charts */}
      {renderTrackShelf(
        `Popular in ${REGION_LABELS[region]}`,
        'Location-tuned vocal tracks with verified lyrics',
        visibleRegional.length ? visibleRegional : regionalTracks
      )}


    </div>
  );
}
