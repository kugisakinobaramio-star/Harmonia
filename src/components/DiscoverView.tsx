import { Compass, Play, Shuffle } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { MusicLanguage, Track } from '../types/music';
import { CoverImage } from './CoverImage';

interface DiscoverViewProps {
  tracks: Track[];
  recentlyPlayed: Track[];
  onPlayTrackList: (tracks: Track[], startIndex: number) => void;
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

function primaryArtist(track: Track): string {
  return track.artist.split(/,|&| feat\.? | ft\.? /i)[0].trim().toLowerCase();
}

function buildVariedList(tracks: Track[], recentlyPlayed: Track[], rotation: number, taste: { likedTracks: Track[]; playCounts: Record<string, number>; artistAffinity: Record<string, number>; genreAffinity: Record<string, number>; preferredLanguages: MusicLanguage[]; favoriteArtists: string[]; preferredMoods: string[] }): Track[] {
  const recent = new Set(recentlyPlayed.slice(0, 8).map((track) => track.id));
  const likedArtists = new Set(taste.likedTracks.map((track) => primaryArtist(track)));
  const likedGenres = new Set(taste.likedTracks.map((track) => (track.genre || '').toLowerCase()).filter(Boolean));
  const favoriteArtists = new Set(taste.favoriteArtists.map((artist) => artist.toLowerCase()));
  const preferredLanguages = new Set(taste.preferredLanguages.map((language) => language.toLowerCase()));
  const preferredMoods = new Set(taste.preferredMoods.map((mood) => mood.toLowerCase()));
  const score = (track: Track) => {
    const artist = primaryArtist(track);
    const genre = (track.genre || '').toLowerCase();
    const language = (track.language || '').toLowerCase();
    const moodText = [track.genre, track.albumName, track.name].join(' ').toLowerCase();
    const artistTaste = Object.entries(taste.artistAffinity).find(([name]) => name.toLowerCase() === artist)?.[1] || 0;
    const genreTaste = Object.entries(taste.genreAffinity).find(([name]) => name.toLowerCase() === genre)?.[1] || 0;
    const plays = taste.playCounts[track.id] || 0;
    return (likedArtists.has(artist) ? 2 : 0) + (favoriteArtists.has(artist) ? 1.5 : 0) + Math.min(3, artistTaste * 0.35) + (likedGenres.has(genre) ? 1.25 : 0) + Math.min(2, genreTaste * 0.3) + (preferredLanguages.has(language) ? 1.2 : 0) + ([...preferredMoods].some((mood) => moodText.includes(mood)) ? 0.8 : 0) - Math.min(2, plays * 0.5);
  };
  const unique = new Map<string, Track>();
  for (const track of tracks) {
    const key = `${track.name.toLowerCase()}::${primaryArtist(track)}`;
    if (!recent.has(track.id) && !unique.has(key)) unique.set(key, track);
  }
  const rotationJitter = (track: Track) => {
    const value = track.name + '::' + primaryArtist(track) + '::' + rotation;
    let result = 0;
    for (let index = 0; index < value.length; index += 1) result = (result * 31 + value.charCodeAt(index)) >>> 0;
    return (result / 0xffffffff) * 0.2;
  };
  const pool = [...unique.values()].sort(
    (a, b) => (score(b) + rotationJitter(b)) - (score(a) + rotationJitter(a))
  );
  if (!pool.length) return [];

  // Rotate the source order, then prioritise a mix of artists and genres.
  const offset = rotation % pool.length;
  const rotated = [...pool.slice(offset), ...pool.slice(0, offset)];
  const usedArtists = new Set<string>();
  const usedGenres = new Set<string>();
  const firstPass: Track[] = [];
  const secondPass: Track[] = [];
  const thirdPass: Track[] = [];
  for (const track of rotated) {
    const artist = primaryArtist(track);
    const genre = (track.genre || '').trim().toLowerCase();
    if (!usedArtists.has(artist) && (!genre || !usedGenres.has(genre))) {
      usedArtists.add(artist);
      if (genre) usedGenres.add(genre);
      firstPass.push(track);
    } else if (!usedArtists.has(artist)) {
      usedArtists.add(artist);
      secondPass.push(track);
    } else {
      thirdPass.push(track);
    }
  }
  return [...firstPass, ...secondPass, ...thirdPass];
}

export function DiscoverView({ tracks, recentlyPlayed, onPlayTrackList, onRefresh, likedTracks, playCounts, artistAffinity, genreAffinity, preferredLanguages, favoriteArtists, preferredMoods }: DiscoverViewProps) {
  const [language, setLanguage] = useState<MusicLanguage | 'All'>('All');
  const [rotation, setRotation] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const varied = useMemo(
    () => buildVariedList(tracks, recentlyPlayed, rotation, { likedTracks, playCounts, artistAffinity, genreAffinity, preferredLanguages, favoriteArtists, preferredMoods }),
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
          {visible.slice(0, 40).map((track, index) => (
            <button key={track.id} type="button" onClick={() => onPlayTrackList(visible, index)} className="group min-w-0 rounded-lg bg-[#18181b] p-3 text-left transition-colors hover:bg-[#252529]">
              <div className="relative aspect-square overflow-hidden rounded-md bg-black">
                <CoverImage src={track.image} alt={track.name} className="h-full w-full object-cover" />
                <span className="absolute bottom-2 right-2 grid h-9 w-9 place-items-center rounded-full bg-[#1DB954] text-black opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                  <Play className="h-4 w-4 fill-current" />
                </span>
              </div>
              <div className="mt-2 truncate text-sm font-bold text-white">{track.name}</div>
              <div className="mt-0.5 truncate text-xs text-zinc-400">{track.artist}</div>
              <div className="mt-1 truncate text-[10px] text-zinc-500">{[track.language, track.genre].filter(Boolean).join(' · ') || 'Explore'}</div>
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-lg bg-[#18181b] p-6 text-sm text-zinc-400">No fresh tracks in this filter yet. Try All or check back after discovery sources refresh.</div>
      )}
    </section>
  );
}
