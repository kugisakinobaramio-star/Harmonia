import {
  Bell,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Disc3,
  Home,
  MapPin,
  Menu,
  Play,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { EqPreset, MusicLanguage, MusicRegion, Track, ViewName } from '../types/music';
import { REGION_LABELS } from '../utils/playerEngine';
import { CoverImage } from './CoverImage';

interface HeaderProps {
  activeView: ViewName;
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
  onGoHome: () => void;
  onOpenSearch: () => void;
  onOpenMobileMenu: () => void;
  searchQuery: string;
  onQuickSearchChange: (q: string) => void;
  onSubmitSearch: () => void;
  region: MusicRegion;
  onChangeRegion: (r: MusicRegion) => void;
  onDetectLocation: () => void;
  detectingLocation: boolean;
  preferredLanguages: MusicLanguage[];
  onTogglePreferredLanguage: (lang: MusicLanguage) => void;
  eqPreset: EqPreset;
  onChangeEqPreset: (preset: EqPreset) => void;
  sleepMinutesLeft: number | null;
  onSetSleepTimer: (minutes: number | null) => void;
  recentDrops: Track[];
  onPlayTrack: (track: Track) => void;
  displayName: string;
  onOpenPersonalise: () => void;
}

const REGIONS: MusicRegion[] = ['IN', 'JP', 'US', 'GB', 'GLOBAL'];
const LANGS: MusicLanguage[] = ['Hindi', 'Punjabi', 'English', 'J-Pop'];

export function Header({
  activeView,
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
  onGoHome,
  onOpenSearch,
  onOpenMobileMenu,
  searchQuery,
  onQuickSearchChange,
  onSubmitSearch,
  region,
  onChangeRegion,
  onDetectLocation,
  detectingLocation,
  preferredLanguages,
  onTogglePreferredLanguage,
  eqPreset,
  onChangeEqPreset,
  sleepMinutesLeft,
  onSetSleepTimer,
  recentDrops,
  onPlayTrack,
  displayName,
  onOpenPersonalise,
}: HeaderProps) {
  const [openMenu, setOpenMenu] = useState<'none' | 'loc' | 'audio' | 'notif'>('none');
  const rightActionsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (openMenu === 'none') return;
    const onPointerDown = (e: MouseEvent) => {
      if (rightActionsRef.current && !rightActionsRef.current.contains(e.target as Node)) {
        setOpenMenu('none');
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu('none');
    };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [openMenu]);

  return (
    <header className="z-30 flex h-14 shrink-0 items-center justify-between gap-3 bg-black px-3 sm:h-16 sm:px-4">
      {/* Left: Brand + Mobile Drawer + Spotify Back/Forward */}
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="Open navigation menu"
          className="grid h-9 w-9 place-items-center rounded-full bg-[#1f1f1f] text-zinc-200 hover:text-white lg:hidden"
        >
          <Menu className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={onGoHome}
          aria-label="Harmonia Home"
          className="flex items-center gap-2 rounded-full pr-1 focus:outline-none"
        >
          <span className="grid h-8 w-8 place-items-center rounded-full bg-white text-black">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M4 9h2v6H4V9zm4-4h2v14H8V5zm4 2h2v10h-2V7zm4-3h2v16h-2V4zm4 5h2v6h-2V9z" />
            </svg>
          </span>
          <span className="text-base font-extrabold tracking-tight text-white">
            Harmonia
          </span>
        </button>

        <div className="hidden items-center gap-1 pl-2 sm:flex">
          <button
            type="button"
            disabled={!canGoBack}
            onClick={onGoBack}
            aria-label="Go back"
            className="grid h-8 w-8 place-items-center rounded-full bg-[#121212] text-zinc-200 transition-opacity hover:bg-[#1f1f1f] disabled:cursor-not-allowed disabled:opacity-35"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={!canGoForward}
            onClick={onGoForward}
            aria-label="Go forward"
            className="grid h-8 w-8 place-items-center rounded-full bg-[#121212] text-zinc-200 transition-opacity hover:bg-[#1f1f1f] disabled:cursor-not-allowed disabled:opacity-35"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Center: Exact Spotify Global Home Pill + Search Input Pill (Desktop/Tablet) */}
      <div className="hidden min-w-0 flex-1 items-center justify-center gap-2 max-w-[540px] sm:flex">
        <button
          type="button"
          onClick={onGoHome}
          aria-label="Home"
          title="Home"
          className={`hidden h-11 w-11 shrink-0 place-items-center rounded-full transition-colors lg:grid ${
            activeView === 'home'
              ? 'bg-[#2a2a2a] text-white'
              : 'bg-[#1f1f1f] text-zinc-300 hover:bg-[#2a2a2a] hover:text-white'
          }`}
        >
          <Home className="h-5 w-5" />
        </button>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmitSearch();
          }}
          className="flex h-10 w-full items-center gap-2.5 rounded-full border border-transparent bg-[#1f1f1f] px-3.5 transition-colors hover:bg-[#2a2a2a] focus-within:border-white/30 focus-within:bg-[#2a2a2a] sm:h-11"
        >
          <Search className="h-4 w-4 shrink-0 text-zinc-400" />
          <label htmlFor="spotify-top-search" className="sr-only">
            What do you want to play?
          </label>
          <input
            id="spotify-top-search"
            type="text"
            value={searchQuery}
            onChange={(e) => onQuickSearchChange(e.target.value)}
            placeholder="What do you want to play?"
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-xs font-medium text-white placeholder-zinc-400 focus:outline-none sm:text-sm"
          />
          <button
            type="button"
            onClick={onOpenSearch}
            aria-label="Browse all categories"
            title="Browse"
            className={`border-l border-white/15 pl-2.5 transition-colors ${
              activeView === 'search' ? 'text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Disc3 className="h-4 w-4" />
          </button>
        </form>
      </div>

      {/* Right: Region selector, Audio EQ/Timer, Notifications, Profile */}
      <div ref={rightActionsRef} className="flex shrink-0 items-center gap-2">
        {/* Location Selector */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpenMenu((m) => (m === 'loc' ? 'none' : 'loc'))}
            aria-label="Select music location"
            aria-expanded={openMenu === 'loc'}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#1f1f1f] px-3 text-xs font-semibold text-zinc-200 transition-colors hover:bg-[#2a2a2a] hover:text-white"
          >
            <MapPin className="h-3.5 w-3.5 text-[#1DB954]" />
            <span className="hidden md:inline">{REGION_LABELS[region]}</span>
            <span className="md:hidden">{region}</span>
          </button>

          {openMenu === 'loc' && (
            <div
              role="dialog"
              aria-label="Location and language taste"
              className="absolute right-0 top-11 z-40 w-72 rounded-xl border border-white/10 bg-[#1f1f24] p-3.5 shadow-2xl"
            >
              <div className="flex items-center justify-between pb-2">
                <span className="text-xs font-bold text-white">Location-Based Music</span>
                <button
                  type="button"
                  onClick={onDetectLocation}
                  disabled={detectingLocation}
                  className="inline-flex items-center gap-1 rounded-full bg-[#1DB954]/15 px-2.5 py-1 text-[11px] font-bold text-[#1DB954] hover:bg-[#1DB954]/25 disabled:opacity-50"
                >
                  <Crosshair className="h-3 w-3" />
                  {detectingLocation ? 'Detecting...' : 'Detect GPS'}
                </button>
              </div>

              <div className="space-y-1">
                {REGIONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => {
                      onChangeRegion(r);
                      setOpenMenu('none');
                    }}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
                      region === r
                        ? 'bg-[#1DB954]/20 font-bold text-[#1DB954]'
                        : 'text-zinc-300 hover:bg-white/[0.06]'
                    }`}
                  >
                    <span>{REGION_LABELS[r]}</span>
                    {region === r && <span>Active</span>}
                  </button>
                ))}
              </div>

              <div className="mt-3 border-t border-white/[0.08] pt-2.5">
                <div className="mb-1.5 text-[11px] font-semibold text-zinc-400">
                  Preferred Languages (Recommendations)
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {LANGS.map((lang) => {
                    const active = preferredLanguages.includes(lang);
                    return (
                      <button
                        key={lang}
                        type="button"
                        onClick={() => onTogglePreferredLanguage(lang)}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors ${
                          active
                            ? 'bg-white text-black'
                            : 'bg-[#2a2a2f] text-zinc-300 hover:bg-[#34343a]'
                        }`}
                      >
                        {lang}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Equalizer & Sleep Timer */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpenMenu((m) => (m === 'audio' ? 'none' : 'audio'))}
            aria-label="Equalizer and sleep timer"
            aria-expanded={openMenu === 'audio'}
            className={`inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold transition-colors ${
              eqPreset !== 'flat' || sleepMinutesLeft !== null
                ? 'bg-[#1DB954]/20 text-[#1DB954]'
                : 'bg-[#1f1f1f] text-zinc-300 hover:bg-[#2a2a2a] hover:text-white'
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {sleepMinutesLeft !== null && (
              <span className="font-mono-num text-[11px]">{sleepMinutesLeft}m</span>
            )}
          </button>

          {openMenu === 'audio' && (
            <div
              role="dialog"
              aria-label="Audio Equalizer and Sleep Timer"
              className="absolute right-0 top-11 z-40 w-64 rounded-xl border border-white/10 bg-[#1f1f24] p-3.5 shadow-2xl"
            >
              <div className="mb-2 text-xs font-bold text-white">Audio Equalizer</div>
              <div className="grid grid-cols-2 gap-1.5">
                {(
                  [
                    { id: 'flat', label: 'Flat' },
                    { id: 'bass', label: 'Bass Boost' },
                    { id: 'vocal', label: 'Vocal Clarity' },
                    { id: 'latenight', label: 'Late Night' },
                  ] as const
                ).map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => onChangeEqPreset(preset.id)}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                      eqPreset === preset.id
                        ? 'bg-[#1DB954] text-black'
                        : 'bg-[#2a2a2f] text-zinc-300 hover:bg-[#34343a]'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div className="mt-3 border-t border-white/[0.08] pt-2.5">
                <div className="mb-1.5 text-xs font-bold text-white">Sleep Timer</div>
                <div className="flex flex-wrap gap-1.5">
                  {[null, 15, 30, 45].map((mins) => (
                    <button
                      key={String(mins)}
                      type="button"
                      onClick={() => onSetSleepTimer(mins)}
                      className={`rounded-lg px-2.5 py-1 font-mono-num text-[11px] font-semibold transition-colors ${
                        sleepMinutesLeft === mins
                          ? 'bg-white text-black'
                          : 'bg-[#2a2a2f] text-zinc-300 hover:bg-[#34343a]'
                      }`}
                    >
                      {mins === null ? 'Off' : `${mins}m`}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Notifications */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpenMenu((m) => (m === 'notif' ? 'none' : 'notif'))}
            aria-label="New releases"
            aria-expanded={openMenu === 'notif'}
            className="grid h-9 w-9 place-items-center rounded-full bg-[#1f1f1f] text-zinc-300 transition-colors hover:bg-[#2a2a2a] hover:text-white"
          >
            <Bell className="h-4 w-4" />
          </button>

          {openMenu === 'notif' && (
            <div
              role="dialog"
              aria-label="Recommended drops"
              className="absolute right-0 top-11 z-40 w-72 rounded-xl border border-white/10 bg-[#1f1f24] p-3 shadow-2xl"
            >
              <div className="mb-2 text-xs font-bold text-white">Fresh Picks With Lyrics</div>
              <div className="space-y-1.5">
                {recentDrops.slice(0, 3).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      onPlayTrack(t);
                      setOpenMenu('none');
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left hover:bg-white/[0.06]"
                  >
                    <CoverImage
                      src={t.image}
                      alt={t.name}
                      className="h-9 w-9 shrink-0 rounded object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold text-white">{t.name}</div>
                      <div className="truncate text-[11px] text-zinc-400">{t.artist}</div>
                    </div>
                    <Play className="h-3.5 w-3.5 text-[#1DB954]" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* User Avatar -> Personalise Feed */}
        <button
          type="button"
          onClick={onOpenPersonalise}
          aria-label="Personalise feed"
          title={`Personalise feed (${displayName || 'Listener'})`}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-4 border-[#1f1f1f] bg-[#19e68c] text-xs font-extrabold text-black transition-transform hover:scale-105"
        >
          {(displayName.trim()[0] || 'H').toUpperCase()}
        </button>
      </div>
    </header>
  );
}
