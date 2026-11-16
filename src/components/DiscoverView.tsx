import { Compass, Play, Shuffle } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { MusicLanguage, Track } from '../types/music';
import { rankDiscoverTracks } from '../utils/playerEngine';
import { CoverImage } from './CoverImage';
import { DownloadButton } from './DownloadButton';

interface DiscoverViewProps {
  tracks: Track[];
  recentlyPlayed: Track[];
  downloadedIds: Set<string>;
  downloadingIds: Set<string>;
  onPlayTrackList: (tracks: Track[], startIndex: number) => void;
  onToggleDownload: (track: Track) => void;
  onRefresh: () => Promise<void>;
  likedTracks: Track[];
  playCounts: Record<string, number>;
  artistAffinity: Record<string, number>;
  genreAffinity: Record<string, number>;
  preferredLanguages: MusicLanguage[];
  favoriteArtists: string[];
  preferredMoods: string[];
}

const LANGUAGES: Array<MusicLanguage | 'All'> = ['All', 'Hindi', 'Punjabi', 'Haryanvi', 'English', 'Japanese', 'J-Pop', 'Korean', 'Tamil', 'Telugu', 'Bengali'];


export function DiscoverView({
  tracks,
  recentlyPlayed,
  downloadedIds,
  downloadingIds,
  onPlayTrackList,
  onToggleDownload,
  onRefresh,
  likedTracks,
  playCounts,
  artistAffinity,
  genreAffinity,
  preferredLanguages,
  favoriteArtists,
  preferredMoods,
}: DiscoverViewProps) {
  const [language, setLanguage] = useState<MusicLanguage | 'All'>('All');
  const [rotation, setRotation] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const varied = useMemo(
    () => rankDiscoverTracks(tracks, recentlyPlayed, { likedTracks, playCounts, artistAffinity, genreAffinity, preferredLanguages, favoriteArtists, preferredMoods }, rotation),
    [tracks, recentlyPlayed, rotation, likedTracks, playCounts, artistAffinity, genreAffinity, preferredLanguages, favoriteArtists, preferredMoods]
  );
  const visible = language === 'All' ? varied : varied.filter((track) => track.language === language);

  return (
    <section className="space-y-5 pb-8" aria-label="Discover music">
      <div className="rounded-xl bg-gradient-to-br from-[#1d3028] via-[#171d20] to-[#171719] p-5 sm:p-7">
        <div className="flex items-center gap-2 text-[#7ee2a8]">
          <Compass className="h-5 w-5" />
          <span className="text-xs font-bold uppercase tracking-[0.18em]">Harmonia Discover</span>
        </div>
        <h1 className="mt-3 text-2xl font-extrabold text-white sm:text-3xl">Find your next favourite.</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-300">A wider mix beyond your usual rotation. Artists are spread out so one familiar name does not take over the feed.</p>
        <button type="button" disabled={refreshing} onClick={async () => {
          setRefreshing(true);
          try { await onRefresh(); setRotation((value) => value + 7); }
          finally { setRefreshing(false); }
        }} className="mt-4 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-bold text-black hover:bg-zinc-200 disabled:opacity-60">
          <Shuffle className="h-4 w-4" /> {refreshing ? 'Finding new tracks…' : 'Refresh discoveries'}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {LANGUAGES.map((item) => (
          <button key={item} type="button" onClick={() => setLanguage(item)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${language === item ? 'bg-white text-black' : 'bg-[#242428] text-zinc-300 hover:bg-[#333339]'}`}>
            {item}
          </button>
        ))}
      </div>

      <div className="flex items-baseline justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold text-white">Fresh discoveries</h2>
          <p className="text-xs text-zinc-400">Recent plays are held back and artists are diversified.</p>
        </div>
        {visible.length > 0 && <button type="button" onClick={() => onPlayTrackList(visible, 0)} className="text-xs font-bold text-zinc-300 hover:text-white"><Play className="mr-1 inline h-3.5 w-3.5 fill-current" /> Play all</button>}
      </div>

      {visible.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {visible.slice(0, 40).map((track, index) => {
            const isDownloaded = downloadedIds.has(track.id);
            const isDownloading = downloadingIds.has(track.id);
            const isOnlineOnly = track.offlineAvailable === false || track.sourceProvider === 'Jamendo';
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
                    <span className="absolute bottom-2 right-2 grid h-9 w-9 place-items-center rounded-full bg-[#1DB954] text-black opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                      <Play className="h-4 w-4 fill-current" />
                    </span>
                  </div>
                  <div className="mt-2 truncate text-sm font-bold text-white">{track.name}</div>
                  <div className="mt-0.5 truncate text-xs text-zinc-400">{track.artist}</div>
                  <div className="mt-1 truncate text-[10px] text-zinc-500">
                    {[track.language, track.genre].filter(Boolean).join(' · ') || 'Explore'}
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
      ) : (
        <div className="rounded-lg bg-[#18181b] p-6 text-sm text-zinc-400">No fresh tracks in this filter yet. Try All or check back after discovery sources refresh.</div>
      )}
    </section>
  );
}
