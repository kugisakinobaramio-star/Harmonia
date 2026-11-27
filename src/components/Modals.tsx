import {
  AlertTriangle,
  Archive,
  Check,
  CheckCircle2,
  Cloud,
  CloudOff,
  Crosshair,
  Loader2,
  Mail,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { SEED_ARTISTS } from '../data/catalog';
import { apiUrl } from '../utils/apiUrl';
import {
  logOut,
  registerWithEmail,
  resendVerificationEmail,
  resetPassword,
  signInWithEmail,
  signInWithGoogle,
} from '../lib/firebase';
import { toFriendlyAuthError } from '../lib/firebaseErrors';
import type { CloudSyncState, LocalBackupEntry, MigrationDiff, MigrationResolution } from '../lib/syncEngine';
import type {
  CuratedPlaylist,
  MusicLanguage,
  MusicRegion,
  PersonalisationSettings,
  Track,
  VideoResult,
} from '../types/music';
import { isSpotifyLinkOrUri, REGION_LABELS } from '../utils/playerEngine';
import { CoverImage } from './CoverImage';

interface CreatePlaylistModalProps {
  open: boolean;
  defaultName: string;
  queueCount: number;
  onClose: () => void;
  onCreate: (name: string, includeQueue: boolean) => void;
}

export function CreatePlaylistModal({
  open,
  defaultName,
  queueCount,
  onClose,
  onCreate,
}: CreatePlaylistModalProps) {
  const [name, setName] = useState(defaultName);
  const [includeQueue, setIncludeQueue] = useState(queueCount > 0);

  useEffect(() => {
    if (open) {
      setName(defaultName);
      setIncludeQueue(queueCount > 0);
    }
  }, [open, defaultName, queueCount]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Create new playlist"
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/85 p-2.5 backdrop-blur-sm sm:p-4"
    >
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#18181b] p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-extrabold text-white">Create Playlist</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-full p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = name.trim() || defaultName;
            onCreate(trimmed, includeQueue);
            onClose();
          }}
          className="mt-4 space-y-4"
        >
          <div>
            <label
              htmlFor="playlist-name-input"
              className="mb-1.5 block text-xs font-semibold text-zinc-400"
            >
              Playlist Name
            </label>
            <input
              id="playlist-name-input"
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Late Night Mix"
              className="w-full rounded-lg border border-white/10 bg-[#242429] px-3.5 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-[#1DB954] focus:outline-none"
            />
          </div>

          {queueCount > 0 && (
            <label className="flex cursor-pointer items-center gap-2.5 rounded-lg bg-[#202025] px-3 py-2.5 text-xs text-zinc-200">
              <input
                type="checkbox"
                checked={includeQueue}
                onChange={(e) => setIncludeQueue(e.target.checked)}
                className="h-4 w-4 accent-[#1DB954]"
              />
              <span>Include current queue ({queueCount} tracks)</span>
            </label>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-4 py-2 text-xs font-bold text-zinc-300 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-full bg-[#1DB954] px-5 py-2 text-xs font-extrabold text-black hover:scale-105 transition-transform"
            >
              Save Playlist
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface AddToPlaylistModalProps {
  track: Track | null;
  playlists: CuratedPlaylist[];
  onClose: () => void;
  onAdd: (playlistId: string, track: Track) => void;
  onCreateAndAdd: (name: string, track: Track) => void;
}

export function AddToPlaylistModal({
  track,
  playlists,
  onClose,
  onAdd,
  onCreateAndAdd,
}: AddToPlaylistModalProps) {
  const [newName, setNewName] = useState('');

  if (!track) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add track to playlist"
      className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4 backdrop-blur-xs"
    >
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#18181b] p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-extrabold text-white">Add to Playlist</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-full p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2.5 rounded-lg bg-[#202025] p-2.5">
          <CoverImage
            src={track.image}
            alt={track.name}
            className="h-10 w-10 rounded object-cover"
          />
          <div className="min-w-0">
            <div className="truncate text-xs font-bold text-white">{track.name}</div>
            <div className="truncate text-[11px] text-zinc-400">{track.artist}</div>
          </div>
        </div>

        <div className="mt-4 max-h-52 space-y-2 overflow-y-auto">
          {playlists.map((pl) => (
            <button
              key={pl.id}
              type="button"
              onClick={() => {
                onAdd(pl.id, track);
                onClose();
              }}
              className="flex w-full items-center justify-between rounded-lg bg-[#202025] px-3.5 py-2.5 text-left transition-colors hover:bg-[#2a2a30]"
            >
              <span className="truncate text-sm font-bold text-white">{pl.name}</span>
              <span className="font-mono-num text-xs text-zinc-400">
                {pl.tracks.length} tracks
              </span>
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = newName.trim() || `Mix ${playlists.length + 1}`;
            onCreateAndAdd(trimmed, track);
            setNewName('');
            onClose();
          }}
          className="mt-4 flex gap-2 border-t border-white/[0.08] pt-3"
        >
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Or create new playlist..."
            aria-label="New playlist name"
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#242429] px-3 py-2 text-xs text-white placeholder-zinc-500 focus:border-[#1DB954] focus:outline-none"
          />
          <button
            type="submit"
            className="inline-flex items-center gap-1 rounded-full bg-[#1DB954] px-3.5 py-2 text-xs font-extrabold text-black"
          >
            <Plus className="h-3.5 w-3.5" />
            Create
          </button>
        </form>
      </div>
    </div>
  );
}

interface SpotifyImportModalProps {
  open: boolean;
  onClose: () => void;
  onImportSpotifyUrl: (url: string) => Promise<{ ok: boolean; error?: string }>;
}

export function SpotifyImportModal({ open, onClose, onImportSpotifyUrl }: SpotifyImportModalProps) {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [resolving, setResolving] = useState(false);

  if (!open) return null;

  const handleSubmit = async () => {
    const trimmed = input.trim();
    if (!trimmed) {
      setError('Paste a Spotify or YouTube playlist link first.');
      return;
    }
    const isSpotifyPlaylist = /(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?playlist\/|spotify:playlist:)/i.test(trimmed);
    const isYouTubePlaylist = /(?:youtube\.com\/playlist\?(?:.*&)?list=|music\.youtube\.com\/playlist\?(?:.*&)?list=)/i.test(trimmed);
    if (!isSpotifyPlaylist && !isYouTubePlaylist) {
      setError('Enter a Spotify or YouTube playlist link.');
      return;
    }
    setResolving(true);
    setError('');
    try {
      const result = await onImportSpotifyUrl(trimmed);
      if (result.ok) {
        setInput('');
        onClose();
      } else {
        setError(result.error || 'Could not import this Spotify playlist.');
      }
    } catch {
      setError('Playlist import failed. Check your connection and try again.');
    } finally {
      setResolving(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Import music playlist" className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-xl border border-white/10 bg-[#18181b] p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-extrabold text-white">Import Playlist</h2>
          <button type="button" onClick={onClose} aria-label="Close modal" disabled={resolving} className="rounded-full p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white disabled:opacity-50">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-zinc-400">
          Paste a public Spotify or YouTube playlist link. No account login or YouTube Data API key is required. Spotify's public embed may expose only part of a playlist; YouTube imports read public playlist metadata and may be marked incomplete if YouTube blocks additional pages. Audio is not copied.
        </p>
        <label htmlFor="spotify-import-input" className="sr-only">Spotify or YouTube playlist link</label>
        <input
          id="spotify-import-input"
          type="url"
          autoFocus
          value={input}
          onChange={(event) => { setInput(event.target.value); setError(''); }}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void handleSubmit(); } }}
          placeholder="Spotify or YouTube playlist URL"
          className="mt-3 w-full rounded-lg border border-white/10 bg-[#242429] px-3.5 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-[#1DB954] focus:outline-none"
          disabled={resolving}
        />
        {error && <p role="alert" className="mt-2 text-xs font-medium text-red-400">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={resolving} className="rounded-full bg-[#242429] px-4 py-2 text-xs font-bold text-white hover:bg-[#303036] disabled:opacity-50">Cancel</button>
          <button type="button" disabled={resolving || !input.trim()} onClick={() => void handleSubmit()} className="inline-flex items-center gap-1.5 rounded-full bg-[#1DB954] px-4 py-2 text-xs font-extrabold text-black disabled:opacity-60">
            {resolving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {resolving ? 'Importing playlist…' : 'Import Playlist'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface VideoModalProps {
  open: boolean;
  videos: VideoResult[];
  selectedId: string | null;
  query: string;
  loading: boolean;
  error: string;
  onSearch: (query: string) => void;
  onSelectVideo: (id: string) => void;
  onClose: () => void;
}

export function VideoModal({
  open,
  videos,
  selectedId,
  query,
  loading,
  error,
  onSearch,
  onSelectVideo,
  onClose,
}: VideoModalProps) {
  const [draftQuery, setDraftQuery] = useState(query);

  useEffect(() => {
    if (open) setDraftQuery(query);
  }, [open, query]);

  if (!open) return null;

  const activeVideo = videos.find((v) => v.id === selectedId) || videos[0] || null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Music video player"
      className="fixed inset-0 z-50 grid place-items-center bg-black/90 p-2 backdrop-blur-xs sm:p-4"
    >
      <div className="flex max-h-[96dvh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-white/10 bg-[#18181b] shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-3">
          <h2 className="truncate text-sm font-extrabold text-white sm:text-base">
            {activeVideo?.title || 'MusicKK Video Search'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close video player"
            className="shrink-0 rounded-full bg-[#242429] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#303036]"
          >
            Close
          </button>
        </div>

        <form
          className="flex gap-2 border-b border-white/[0.08] p-3"
          onSubmit={(event) => {
            event.preventDefault();
            onSearch(draftQuery);
          }}
        >
          <input
            value={draftQuery}
            onChange={(event) => setDraftQuery(event.target.value)}
            placeholder="Search song, artist, music video, live, cover..."
            aria-label="Search music videos"
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-[#1DB954]"
          />
          <button
            type="submit"
            disabled={loading || !draftQuery.trim()}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-[#1DB954] px-3 py-2 text-xs font-extrabold text-black disabled:opacity-50 sm:px-4"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            <span className="hidden sm:inline">{loading ? 'Searching' : 'Search'}</span>
          </button>
        </form>

        <div className="min-h-0 overflow-y-auto">
          <div className="aspect-video w-full bg-black">
            {activeVideo ? (
              <iframe
                key={activeVideo.id}
                title={activeVideo.title}
                src={`https://www.youtube-nocookie.com/embed/${activeVideo.id}?autoplay=1&playsinline=1&rel=0`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
                className="h-full w-full border-0"
              />
            ) : (
              <div className="grid h-full place-items-center px-5 text-center text-sm text-zinc-400">
                {loading ? 'Searching YouTube videos…' : 'Search for a song or artist to start watching'}
              </div>
            )}
          </div>

          {activeVideo && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-xs font-bold text-white">{activeVideo.title}</p>
                <p className="truncate text-[11px] text-zinc-400">{activeVideo.channel}</p>
              </div>
              <a
                href={`https://www.youtube.com/watch?v=${activeVideo.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-white/15"
              >
                Open on YouTube
              </a>
            </div>
          )}

          {error && <p role="status" className="px-4 py-3 text-xs text-amber-300">{error}</p>}
          {videos.length > 0 && (
            <div className="space-y-1 p-2 sm:p-3">
              <p className="px-1 pb-1 text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                Search results · {videos.length}
              </p>
              {videos.map((v) => {
                const active = activeVideo?.id === v.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => onSelectVideo(v.id)}
                    className={`flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors ${
                      active ? 'bg-white/10' : 'hover:bg-white/[0.05]'
                    }`}
                  >
                    <CoverImage
                      src={v.thumbnail || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`}
                      alt={v.title}
                      className="h-12 w-20 shrink-0 rounded object-cover sm:h-14 sm:w-24"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-2 text-xs font-bold text-white">{v.title}</div>
                      <div className="truncate text-[11px] text-zinc-400">
                        {v.channel}{v.dur ? ` · ${v.dur}` : ''}
                      </div>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#1DB954] px-2.5 py-1.5 text-[10px] font-extrabold text-black">
                      <Play className="h-3 w-3 fill-current" /> Play
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const ARTIST_PICKER_OPTIONS: Array<{ name: string; image: string; lang: string }> = [
  ...SEED_ARTISTS.map((a) => ({ name: a.name, image: a.image, lang: a.language || 'Global' })),
  { name: 'Pritam', image: apiUrl('/api/music/image?title=Kesariya+Pritam'), lang: 'Hindi' },
  { name: 'Shreya Ghoshal', image: apiUrl('/api/music/image?title=Shreya+Ghoshal'), lang: 'Hindi' },
  { name: 'Diljit Dosanjh', image: apiUrl('/api/music/image?title=Diljit+Dosanjh'), lang: 'Hindi' },
  { name: 'Fujii Kaze', image: apiUrl('/api/music/image?title=Shinunoga+E-Wa+Fujii+Kaze'), lang: 'J-Pop' },
  { name: 'Billie Eilish', image: apiUrl('/api/music/image?title=Birds+Of+A+Feather+Billie+Eilish'), lang: 'English' },
  { name: 'Glass Animals', image: apiUrl('/api/music/image?title=Heat+Waves+Glass+Animals'), lang: 'English' },
];

const MOOD_OPTIONS = [
  'Bollywood Romantic',
  'Anime & J-Pop',
  'Late Night Dark',
  'Acoustic Unplugged',
  'Workout Energy',
  'Indie & R&B',
];

const REGION_OPTIONS: MusicRegion[] = ['IN', 'JP', 'US', 'GB', 'GLOBAL'];
const LANGUAGE_OPTIONS: MusicLanguage[] = [
  'Hindi', 'Punjabi', 'Haryanvi', 'Marathi', 'Bengali', 'Tamil', 'Telugu', 'Kannada',
  'Malayalam', 'Gujarati', 'Bhojpuri', 'Urdu', 'English', 'French', 'Spanish', 'Korean',
  'Japanese', 'Chinese', 'Arabic', 'Portuguese', 'German', 'Italian', 'Turkish', 'Thai',
  'Indonesian',
];

interface PersonaliseModalProps {
  open: boolean;
  initialSettings: PersonalisationSettings;
  detectingLocation: boolean;
  onDetectLocation: () => void;
  onClose: () => void;
  onSave: (settings: PersonalisationSettings) => void;
  onReset: () => void;
}

export function PersonaliseModal({
  open,
  initialSettings,
  detectingLocation,
  onDetectLocation,
  onClose,
  onSave,
  onReset,
}: PersonaliseModalProps) {
  const [displayName, setDisplayName] = useState(initialSettings.displayName);
  const [region, setRegion] = useState<MusicRegion>(initialSettings.region);
  const [preferredLanguages, setPreferredLanguages] = useState<MusicLanguage[]>(
    initialSettings.preferredLanguages
  );
  const [favoriteArtists, setFavoriteArtists] = useState<string[]>(initialSettings.favoriteArtists);
  const [preferredMoods, setPreferredMoods] = useState<string[]>(initialSettings.preferredMoods);
  const [prioritizeLyrics, setPrioritizeLyrics] = useState<boolean>(initialSettings.prioritizeLyrics);
  const [customArtist, setCustomArtist] = useState('');

  useEffect(() => {
    if (open) {
      setDisplayName(initialSettings.displayName);
      setRegion(initialSettings.region);
      setPreferredLanguages(initialSettings.preferredLanguages);
      setFavoriteArtists(initialSettings.favoriteArtists);
      setPreferredMoods(initialSettings.preferredMoods);
      setPrioritizeLyrics(initialSettings.prioritizeLyrics);
      setCustomArtist('');
    }
  }, [open, initialSettings]);

  if (!open) return null;

  const toggleLanguage = (lang: MusicLanguage) => {
    setPreferredLanguages((prev) =>
      prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang]
    );
  };

  const toggleArtist = (artistName: string) => {
    setFavoriteArtists((prev) =>
      prev.includes(artistName) ? prev.filter((a) => a !== artistName) : [...prev, artistName].slice(0, 12)
    );
  };

  const toggleMood = (mood: string) => {
    setPreferredMoods((prev) =>
      prev.includes(mood) ? prev.filter((m) => m !== mood) : [...prev, mood].slice(0, 8)
    );
  };

  const addCustomArtist = () => {
    const trimmed = customArtist.trim();
    if (!trimmed) return;
    if (!favoriteArtists.some((a) => a.toLowerCase() === trimmed.toLowerCase())) {
      setFavoriteArtists((prev) => [...prev, trimmed].slice(0, 12));
    }
    setCustomArtist('');
  };

  const extraSelectedArtists = favoriteArtists.filter(
    (name) => !ARTIST_PICKER_OPTIONS.some((opt) => opt.name.toLowerCase() === name.toLowerCase())
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Personalise your MusicKK feed"
      className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4 backdrop-blur-xs"
    >
      <div className="flex max-h-[min(92dvh,900px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#141715] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-[#1DB954]/15 text-[#1DB954]">
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-lg font-extrabold text-white">Personalise Your Feed</h2>
              <p className="text-xs text-zinc-400">
                Choose the languages you actually listen to, then shape the sound of your feed
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close personalisation"
            className="rounded-full p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <div className="flex items-start gap-3 rounded-xl border border-[#1DB954]/20 bg-[#1DB954]/[0.07] p-3">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[#1DB954]" />
            <div>
              <p className="text-xs font-bold text-white">Adaptive AI personalisation</p>
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-300">
                MusicKK learns from your listening, likes and skips. These choices are gentle guidance, not fixed language or mood filters.
              </p>
            </div>
          </div>
          {/* Display Name & Location */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="personalise-name-input"
                className="mb-1.5 block text-xs font-bold text-zinc-300"
              >
                Your Name
              </label>
              <input
                id="personalise-name-input"
                type="text"
                maxLength={32}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Listener"
                className="w-full rounded-lg border border-white/10 bg-[#242429] px-3.5 py-2 text-sm text-white placeholder-zinc-500 focus:border-[#1DB954] focus:outline-none"
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="personalise-region-select" className="text-xs font-bold text-zinc-300">
                  Location Charts
                </label>
                <button
                  type="button"
                  onClick={onDetectLocation}
                  disabled={detectingLocation}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-[#1DB954] hover:underline disabled:opacity-50"
                >
                  <Crosshair className="h-3 w-3" />
                  {detectingLocation ? 'Detecting...' : 'Use GPS'}
                </button>
              </div>
              <select
                id="personalise-region-select"
                value={region}
                onChange={(e) => setRegion(e.target.value as MusicRegion)}
                className="w-full rounded-lg border border-white/10 bg-[#242429] px-3 py-2 text-sm text-white focus:border-[#1DB954] focus:outline-none"
              >
                {REGION_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {REGION_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Primary Languages */}
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-xs font-bold text-zinc-300">Languages you want to hear</span>
              <button type="button" onClick={() => setPreferredLanguages([])} className="text-[11px] font-semibold text-[#7ee2a8]">Clear all</button>
            </div>
            <p className="mb-3 text-[11px] leading-relaxed text-zinc-500">These are song-language preferences, not title keywords. Tracks without reliable language metadata are left unclassified instead of being guessed.</p>
            <div className="flex flex-wrap gap-2">
              {LANGUAGE_OPTIONS.map((lang) => {
                const active = preferredLanguages.includes(lang);
                return (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => toggleLanguage(lang)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors ${
                      active
                        ? 'bg-[#1DB954] text-black'
                        : 'bg-[#242429] text-zinc-200 hover:bg-[#303036]'
                    }`}
                  >
                    {active && <Check className="h-3.5 w-3.5" />}
                    {lang}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Favorite Artists Visual Grid */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-bold text-zinc-300">
                Favorite Artists ({favoriteArtists.length} selected)
              </span>
              <span className="text-[11px] text-zinc-500">Boosts Home &amp; fetches artist mixes</span>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {ARTIST_PICKER_OPTIONS.map((art) => {
                const selected = favoriteArtists.some(
                  (a) => a.toLowerCase() === art.name.toLowerCase()
                );
                return (
                  <button
                    key={art.name}
                    type="button"
                    onClick={() => toggleArtist(art.name)}
                    className={`flex items-center gap-2 rounded-lg border p-2 text-left transition-colors ${
                      selected
                        ? 'border-[#1DB954] bg-[#1DB954]/15'
                        : 'border-white/[0.06] bg-[#202025] hover:bg-[#28282f]'
                    }`}
                  >
                    <CoverImage
                      src={art.image}
                      alt={art.name}
                      className="h-8 w-8 shrink-0 rounded-full object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-bold text-white">{art.name}</div>
                      <div className="truncate text-[10px] text-zinc-400">{art.lang}</div>
                    </div>
                  </button>
                );
              })}
            </div>

            {extraSelectedArtists.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {extraSelectedArtists.map((art) => (
                  <button
                    key={art}
                    type="button"
                    onClick={() => toggleArtist(art)}
                    className="inline-flex items-center gap-1 rounded-full bg-[#1DB954]/20 px-2.5 py-1 text-[11px] font-bold text-[#1DB954]"
                  >
                    {art}
                    <X className="h-3 w-3" />
                  </button>
                ))}
              </div>
            )}

            <div className="mt-2.5 flex gap-2">
              <input
                type="text"
                value={customArtist}
                onChange={(e) => setCustomArtist(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addCustomArtist();
                  }
                }}
                placeholder="Add another artist (e.g., Ado, Taylor Swift, AR Rahman)..."
                aria-label="Add custom artist"
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#242429] px-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:border-[#1DB954] focus:outline-none"
              />
              <button
                type="button"
                onClick={addCustomArtist}
                className="inline-flex items-center gap-1 rounded-lg bg-[#2a2a30] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#34343c]"
              >
                <Plus className="h-3.5 w-3.5" />
                Add
              </button>
            </div>
          </div>

          {/* Moods & Vibes */}
          <div>
            <div className="mb-2 text-xs font-bold text-zinc-300">Mood &amp; Vibe Focus</div>
            <p className="mb-3 text-[11px] leading-relaxed text-zinc-500">Pick the sound you enjoy. Discover uses available genre and tempo metadata—not words in a song title—to match these moods.</p>
            <div className="flex flex-wrap gap-2">
              {MOOD_OPTIONS.map((mood) => {
                const active = preferredMoods.includes(mood);
                return (
                  <button
                    key={mood}
                    type="button"
                    onClick={() => toggleMood(mood)}
                    className={`rounded-full border px-3.5 py-2 text-xs font-semibold transition-colors ${
                      active
                        ? 'bg-white text-black'
                        : 'bg-[#242429] text-zinc-300 hover:bg-[#303036]'
                    }`}
                  >
                    {mood}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Vocal / Lyrics Priority Toggle */}
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg bg-[#202025] px-3.5 py-2.5">
            <div>
              <div className="text-xs font-bold text-white">Prioritize Vocal Songs With Lyrics</div>
              <div className="text-[11px] text-zinc-400">
                Demote or hide instrumental, karaoke, and no-lyrics filler tracks
              </div>
            </div>
            <input
              type="checkbox"
              checked={prioritizeLyrics}
              onChange={(e) => setPrioritizeLyrics(e.target.checked)}
              className="h-4 w-4 accent-[#1DB954]"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] px-5 py-3.5">
          <button
            type="button"
            onClick={() => {
              onReset();
              onClose();
            }}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-zinc-400 hover:bg-white/[0.06] hover:text-white"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset Taste
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-4 py-2 text-xs font-bold text-zinc-300 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onSave({
                  displayName: displayName.trim() || 'Listener',
                  region,
                  preferredLanguages,
                  favoriteArtists,
                  preferredMoods,
                  prioritizeLyrics,
                });
                onClose();
              }}
              className="rounded-full bg-[#1DB954] px-5 py-2 text-xs font-extrabold text-black transition-transform hover:scale-105"
            >
              Save Personalisation
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


type AuthTab = 'signin' | 'register' | 'reset';

function formatSyncTimestamp(ts: number | null): string {
  if (!ts) return 'Not synced yet';
  const diffSec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (diffSec < 15) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface ProfileModalProps {
  open: boolean;
  displayName: string;
  region: MusicRegion;
  preferredLanguages: MusicLanguage[];
  favoriteArtists: string[];
  preferredMoods: string[];
  totalPlays: number;
  uniqueTracks: number;
  likedCount: number;
  user: User | null;
  isOnline: boolean;
  syncState: CloudSyncState;
  lastSyncedAtMs: number | null;
  pendingQueueCount: number;
  syncError: string;
  backups: LocalBackupEntry[];
  onManualSync: () => Promise<void>;
  onCreateBackup: () => void;
  onRestoreBackup: (backupId: string) => void;
  onReviewMigration?: () => void;
  onClose: () => void;
  onEditPreferences: () => void;
}

export function ProfileModal({
  open,
  displayName,
  region,
  preferredLanguages,
  favoriteArtists,
  preferredMoods,
  totalPlays,
  uniqueTracks,
  likedCount,
  user,
  isOnline,
  syncState,
  lastSyncedAtMs,
  pendingQueueCount,
  syncError,
  backups,
  onManualSync,
  onCreateBackup,
  onRestoreBackup,
  onReviewMigration,
  onClose,
  onEditPreferences,
}: ProfileModalProps) {
  const [authTab, setAuthTab] = useState<AuthTab>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [regName, setRegName] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authNotice, setAuthNotice] = useState('');
  const [showBackups, setShowBackups] = useState(false);
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setAuthError('');
      setAuthNotice('');
      setConfirmRestoreId(null);
    }
  }, [open, user?.uid]);

  if (!open) return null;

  const currentName = user?.displayName || displayName.trim() || 'Listener';
  const initial = currentName.charAt(0).toUpperCase() || 'M';
  const isPasswordProvider = Boolean(
    user?.providerData?.some((p) => p.providerId === 'password')
  );
  const providerLabel = user?.providerData?.some((p) => p.providerId === 'google.com')
    ? 'Google Account'
    : isPasswordProvider
      ? 'Email Account'
      : 'Cloud Account';

  const syncStatusBadge = (() => {
    if (!user) return { text: 'Guest Mode · Local-First', cls: 'bg-white/10 text-zinc-200' };
    if (!isOnline || syncState === 'offline') {
      return { text: 'Offline · Saved Locally', cls: 'bg-amber-500/20 text-amber-300' };
    }
    if (syncState === 'syncing') {
      return { text: 'Syncing…', cls: 'bg-[#1DB954]/20 text-[#9ce8b7]' };
    }
    if (syncState === 'migration-pending') {
      return { text: 'Merge Review Needed', cls: 'bg-amber-500/20 text-amber-300' };
    }
    if (syncState === 'error') {
      return { text: 'Sync Paused', cls: 'bg-red-500/20 text-red-300' };
    }
    return { text: 'Cloud Synced', cls: 'bg-[#1DB954]/20 text-[#9ce8b7]' };
  })();

  const handleGoogleSignIn = async () => {
    try {
      setAuthLoading(true);
      setAuthError('');
      setAuthNotice('');
      await signInWithGoogle();
    } catch (e: unknown) {
      setAuthError(toFriendlyAuthError(e));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setAuthError('Enter both your email and password.');
      return;
    }
    try {
      setAuthLoading(true);
      setAuthError('');
      setAuthNotice('');
      await signInWithEmail(email, password);
      setPassword('');
    } catch (err: unknown) {
      setAuthError(toFriendlyAuthError(err));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setAuthError('Please enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setAuthError('Password must be at least 6 characters long.');
      return;
    }
    try {
      setAuthLoading(true);
      setAuthError('');
      setAuthNotice('');
      await registerWithEmail(email, password, regName || displayName);
      setPassword('');
      setAuthNotice('Account created! A verification email has been sent.');
    } catch (err: unknown) {
      setAuthError(toFriendlyAuthError(err));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setAuthError('Enter your account email to receive a password reset link.');
      return;
    }
    try {
      setAuthLoading(true);
      setAuthError('');
      setAuthNotice('');
      await resetPassword(email);
      setAuthNotice('Password reset link sent! Check your inbox and spam folder.');
    } catch (err: unknown) {
      setAuthError(toFriendlyAuthError(err));
    } finally {
      setAuthLoading(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Your MusicKK profile" className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-3 backdrop-blur-sm sm:p-4">
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-[#18181b] shadow-2xl">
        <div className="relative bg-gradient-to-br from-[#183b2a] via-[#20252a] to-[#18181b] px-5 pb-5 pt-4">
          <div className="flex items-center justify-between gap-2 pb-2">
            <span className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-bold ${syncStatusBadge.cls}`}>
              {user ? (isOnline ? <Cloud className="h-3.5 w-3.5" /> : <CloudOff className="h-3.5 w-3.5" />) : <ShieldCheck className="h-3.5 w-3.5" />}
              {syncStatusBadge.text}
            </span>
            <button type="button" onClick={onClose} aria-label="Close profile" className="rounded-full bg-black/30 p-2 text-zinc-200 hover:bg-black/50"><X className="h-4 w-4" /></button>
          </div>
          <div className="flex items-end gap-4">
            {user?.photoURL ? (
              <img src={user.photoURL} alt={currentName} className="h-16 w-16 shrink-0 rounded-full border-4 border-white/10 object-cover shadow-xl sm:h-20 sm:w-20" />
            ) : (
              <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full border-4 border-white/10 bg-[#1DB954] text-2xl font-black text-black shadow-xl sm:h-20 sm:w-20 sm:text-3xl">{initial}</div>
            )}
            <div className="min-w-0 pb-1">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#9ce8b7]">
                {user ? providerLabel : 'Guest Listener'}
              </p>
              <h2 className="truncate text-2xl font-extrabold text-white">{currentName}</h2>
              <p className="truncate text-xs text-zinc-300">
                MusicKK · {region}{user?.email ? ` · ${user.email}` : ''}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-[#242429] p-3"><div className="text-xl font-extrabold text-white">{totalPlays}</div><div className="text-[11px] text-zinc-400">Total plays</div></div>
            <div className="rounded-xl bg-[#242429] p-3"><div className="text-xl font-extrabold text-white">{uniqueTracks}</div><div className="text-[11px] text-zinc-400">Tracks played</div></div>
            <div className="rounded-xl bg-[#242429] p-3"><div className="text-xl font-extrabold text-white">{likedCount}</div><div className="text-[11px] text-zinc-400">Liked songs</div></div>
          </div>

          <section className="rounded-xl border border-white/10 bg-[#202024] p-4">
            {user ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-white">Cloud Sync &amp; Account</h3>
                    <p className="truncate text-xs text-zinc-300">{user.email || user.displayName || user.uid}</p>
                    <p className="mt-0.5 text-[11px] text-zinc-400">
                      Last synced: <span className="font-semibold text-zinc-200">{formatSyncTimestamp(lastSyncedAtMs)}</span>
                      {pendingQueueCount > 0 ? ` · ${pendingQueueCount} change queued` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void onManualSync()}
                      disabled={syncState === 'syncing' || !isOnline}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#1DB954] px-3 py-1.5 text-xs font-extrabold text-black hover:bg-[#1ed760] disabled:opacity-50"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${syncState === 'syncing' ? 'animate-spin' : ''}`} />
                      {syncState === 'syncing' ? 'Syncing' : 'Sync Now'}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          setAuthLoading(true);
                          setAuthError('');
                          await logOut();
                        } catch (e: unknown) {
                          setAuthError(toFriendlyAuthError(e));
                        } finally {
                          setAuthLoading(false);
                        }
                      }}
                      disabled={authLoading}
                      className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/20 disabled:opacity-50"
                    >
                      Sign Out
                    </button>
                  </div>
                </div>

                {syncState === 'migration-pending' && onReviewMigration && (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-400/30 bg-amber-500/10 p-2.5 text-xs text-amber-200">
                    <span>Review local vs cloud merge before syncing.</span>
                    <button
                      type="button"
                      onClick={onReviewMigration}
                      className="shrink-0 rounded-md bg-amber-400 px-2.5 py-1 text-[11px] font-extrabold text-black"
                    >
                      Review Merge
                    </button>
                  </div>
                )}

                {isPasswordProvider && !user.emailVerified && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/25 p-2.5 text-[11px] text-zinc-300">
                    <span className="inline-flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 text-amber-300" />
                      Email not verified yet.
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          setAuthLoading(true);
                          await resendVerificationEmail();
                          setAuthNotice('Verification email sent!');
                        } catch (err) {
                          setAuthError(toFriendlyAuthError(err));
                        } finally {
                          setAuthLoading(false);
                        }
                      }}
                      disabled={authLoading || !isOnline}
                      className="font-bold text-[#1DB954] hover:underline disabled:opacity-50"
                    >
                      Resend verification
                    </button>
                  </div>
                )}

                {!isOnline && (
                  <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200" role="status">
                    You are offline. MusicKK continues working locally and will sync automatically when online.
                  </p>
                )}

                {syncError && (
                  <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300" role="alert">
                    {syncError}
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-bold text-white">Optional Cloud Sync &amp; Account</h3>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                    Guest Mode keeps all your playlists, likes, and stats on this device offline. Sign in anytime to sync across devices — we preview and preserve your local library before merging.
                  </p>
                </div>

                {!isOnline && (
                  <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200" role="status">
                    Offline mode active — guest playback and library stay available; connect to sign in.
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => void handleGoogleSignIn()}
                  disabled={authLoading || !isOnline}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-xs font-extrabold text-black hover:bg-zinc-200 disabled:opacity-50"
                >
                  {authLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                      <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z" />
                      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z" />
                      <path fill="#FBBC05" d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z" />
                      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z" />
                    </svg>
                  )}
                  Continue with Google
                </button>

                <div className="grid grid-cols-3 gap-1 rounded-lg bg-black/35 p-1 text-[11px] font-bold">
                  <button
                    type="button"
                    onClick={() => { setAuthTab('signin'); setAuthError(''); setAuthNotice(''); }}
                    className={`rounded-md py-1.5 transition-colors ${authTab === 'signin' ? 'bg-[#2a2a32] text-white' : 'text-zinc-400 hover:text-white'}`}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAuthTab('register'); setAuthError(''); setAuthNotice(''); }}
                    className={`rounded-md py-1.5 transition-colors ${authTab === 'register' ? 'bg-[#2a2a32] text-white' : 'text-zinc-400 hover:text-white'}`}
                  >
                    Create Account
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAuthTab('reset'); setAuthError(''); setAuthNotice(''); }}
                    className={`rounded-md py-1.5 transition-colors ${authTab === 'reset' ? 'bg-[#2a2a32] text-white' : 'text-zinc-400 hover:text-white'}`}
                  >
                    Reset
                  </button>
                </div>

                {authTab === 'signin' && (
                  <form onSubmit={handleEmailSignIn} className="space-y-2.5">
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Email address"
                      aria-label="Sign in email"
                      autoComplete="email"
                      className="w-full rounded-lg border border-white/10 bg-[#242429] px-3 py-2 text-xs text-white placeholder-zinc-500 focus:border-[#1DB954] focus:outline-none"
                    />
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Password"
                      aria-label="Sign in password"
                      autoComplete="current-password"
                      className="w-full rounded-lg border border-white/10 bg-[#242429] px-3 py-2 text-xs text-white placeholder-zinc-500 focus:border-[#1DB954] focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={authLoading || !isOnline}
                      className="w-full rounded-lg bg-[#1DB954] px-4 py-2 text-xs font-extrabold text-black hover:bg-[#1ed760] disabled:opacity-50"
                    >
                      {authLoading ? 'Signing in…' : 'Sign in with Email'}
                    </button>
                  </form>
                )}

                {authTab === 'register' && (
                  <form onSubmit={handleRegister} className="space-y-2.5">
                    <input
                      type="text"
                      value={regName}
                      onChange={(e) => setRegName(e.target.value)}
                      placeholder="Display name (optional)"
                      aria-label="Display name"
                      maxLength={80}
                      className="w-full rounded-lg border border-white/10 bg-[#242429] px-3 py-2 text-xs text-white placeholder-zinc-500 focus:border-[#1DB954] focus:outline-none"
                    />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Email address"
                      aria-label="Registration email"
                      autoComplete="email"
                      className="w-full rounded-lg border border-white/10 bg-[#242429] px-3 py-2 text-xs text-white placeholder-zinc-500 focus:border-[#1DB954] focus:outline-none"
                    />
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Password (min 6 characters)"
                      aria-label="Registration password"
                      autoComplete="new-password"
                      className="w-full rounded-lg border border-white/10 bg-[#242429] px-3 py-2 text-xs text-white placeholder-zinc-500 focus:border-[#1DB954] focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={authLoading || !isOnline}
                      className="w-full rounded-lg bg-[#1DB954] px-4 py-2 text-xs font-extrabold text-black hover:bg-[#1ed760] disabled:opacity-50"
                    >
                      {authLoading ? 'Creating account…' : 'Create Account & Link Library'}
                    </button>
                  </form>
                )}

                {authTab === 'reset' && (
                  <form onSubmit={handleResetPassword} className="space-y-2.5">
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Account email address"
                      aria-label="Password reset email"
                      autoComplete="email"
                      className="w-full rounded-lg border border-white/10 bg-[#242429] px-3 py-2 text-xs text-white placeholder-zinc-500 focus:border-[#1DB954] focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={authLoading || !isOnline}
                      className="w-full rounded-lg bg-[#2a2a32] px-4 py-2 text-xs font-extrabold text-white hover:bg-[#353540] disabled:opacity-50"
                    >
                      {authLoading ? 'Sending…' : 'Send Password Reset Email'}
                    </button>
                  </form>
                )}
              </div>
            )}

            {authError && (
              <p className="mt-2.5 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300" role="alert">
                {authError}
              </p>
            )}
            {authNotice && (
              <p className="mt-2.5 rounded-lg bg-[#1DB954]/15 px-3 py-2 text-xs text-[#9ce8b7]" role="status">
                {authNotice}
              </p>
            )}
          </section>

          <section className="rounded-xl border border-white/10 bg-[#202024] p-3.5">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setShowBackups((prev) => !prev)}
                className="flex items-center gap-2 text-xs font-bold text-white hover:text-[#9ce8b7]"
              >
                <Archive className="h-3.5 w-3.5 text-[#1DB954]" />
                Local Backups ({backups.length})
              </button>
              <button
                type="button"
                onClick={onCreateBackup}
                className="rounded-md bg-white/10 px-2.5 py-1 text-[11px] font-bold text-zinc-200 hover:bg-white/20"
              >
                Save Backup
              </button>
            </div>
            {showBackups && (
              <div className="mt-3 space-y-2">
                {backups.length === 0 ? (
                  <p className="text-[11px] text-zinc-400">
                    Automatic backups are created before sign-in merges and account switches.
                  </p>
                ) : (
                  backups.map((bak) => (
                    <div key={bak.id} className="flex items-center justify-between gap-2 rounded-lg bg-black/25 p-2.5 text-[11px]">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-zinc-200">{bak.reason}</p>
                        <p className="text-zinc-400">
                          {new Date(bak.createdAtMs).toLocaleString()} · {bak.summary.playlists} playlists · {bak.summary.likedSongs} liked
                        </p>
                      </div>
                      {confirmRestoreId === bak.id ? (
                        <button
                          type="button"
                          onClick={() => {
                            onRestoreBackup(bak.id);
                            setConfirmRestoreId(null);
                          }}
                          className="shrink-0 rounded-md bg-amber-400 px-2.5 py-1 font-extrabold text-black"
                        >
                          Confirm
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmRestoreId(bak.id)}
                          className="shrink-0 rounded-md bg-white/10 px-2.5 py-1 font-bold text-white hover:bg-white/20"
                        >
                          Restore
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-bold text-white">Your music taste</h3>
            <p className="mb-2 text-xs text-zinc-400">Your mixes adapt as you listen, replay and save tracks.</p>
            <div className="flex flex-wrap gap-2">
              {preferredLanguages.slice(0, 8).map((item, idx) => <span key={`lang-${item}-${idx}`} className="rounded-md bg-[#26382d] px-2.5 py-1 text-xs text-[#b7f4ca]">{item}</span>)}
              {favoriteArtists.slice(0, 8).map((item, idx) => <span key={`artist-${item}-${idx}`} className="rounded-md bg-[#29292f] px-2.5 py-1 text-xs text-zinc-200">{item}</span>)}
              {preferredMoods.slice(0, 5).map((item, idx) => <span key={`mood-${item}-${idx}`} className="rounded-md bg-[#29292f] px-2.5 py-1 text-xs text-zinc-300">{item}</span>)}
              {!preferredLanguages.length && !favoriteArtists.length && !preferredMoods.length && <span className="text-xs text-zinc-500">Your taste profile is still learning. Play and like a few songs to shape it.</span>}
            </div>
          </section>

          <div className="flex flex-wrap gap-2 border-t border-white/[0.08] pt-4">
            <button type="button" onClick={onEditPreferences} className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-[#1DB954] px-4 py-2.5 text-xs font-extrabold text-black hover:bg-[#1ed760]"><UserRound className="h-4 w-4" /> Edit profile &amp; taste</button>
            <button type="button" onClick={onClose} className="rounded-full bg-[#2a2a30] px-4 py-2.5 text-xs font-bold text-zinc-200 hover:bg-[#35353c]">Done</button>
          </div>
          <p className="text-[10px] leading-relaxed text-zinc-500">MusicKK saves everything locally first. Cloud accounts only sync durable playlists, favourites, stats, and preferences — never temporary stream URLs.</p>
        </div>
      </div>
    </div>
  );
}

interface MigrationPreviewModalProps {
  open: boolean;
  email: string | null;
  diff: MigrationDiff | null;
  onResolve: (resolution: MigrationResolution) => Promise<void>;
}

export function MigrationPreviewModal({
  open,
  email,
  diff,
  onResolve,
}: MigrationPreviewModalProps) {
  const [busy, setBusy] = useState(false);

  if (!open || !diff) return null;

  const choose = async (resolution: MigrationResolution) => {
    setBusy(true);
    try {
      await onResolve(resolution);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Cloud library migration preview"
      className="fixed inset-0 z-[60] grid place-items-center bg-black/85 p-3 backdrop-blur-sm sm:p-4"
    >
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-[#18181b] p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#1DB954]/15 text-[#1DB954]">
            <CheckCircle2 className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-extrabold text-white">Review Library Before Syncing</h2>
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">
              Signed in as <span className="font-semibold text-white">{email || 'your account'}</span>. Choose how to combine your device data with your cloud library. A recoverable backup of this device is saved automatically first.
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-[#202026] p-3.5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#9ce8b7]">On This Device</p>
            <p className="mt-0.5 truncate text-sm font-bold text-white">{diff.localSummary.displayName}</p>
            <ul className="mt-2 space-y-1 text-xs text-zinc-300">
              <li>Playlists: <span className="font-bold text-white">{diff.localSummary.playlists}</span> ({diff.localSummary.playlistTracks} tracks)</li>
              <li>Liked songs: <span className="font-bold text-white">{diff.localSummary.likedSongs}</span></li>
              <li>Recent plays: <span className="font-bold text-white">{diff.localSummary.recentPlays}</span></li>
              <li>Total plays: <span className="font-bold text-white">{diff.localSummary.totalPlays}</span></li>
            </ul>
          </div>

          <div className="rounded-xl border border-white/10 bg-[#202026] p-3.5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">In Cloud Account</p>
            <p className="mt-0.5 truncate text-sm font-bold text-white">{diff.cloudSummary.displayName}</p>
            <ul className="mt-2 space-y-1 text-xs text-zinc-300">
              <li>Playlists: <span className="font-bold text-white">{diff.cloudSummary.playlists}</span> ({diff.cloudSummary.playlistTracks} tracks)</li>
              <li>Liked songs: <span className="font-bold text-white">{diff.cloudSummary.likedSongs}</span></li>
              <li>Recent plays: <span className="font-bold text-white">{diff.cloudSummary.recentPlays}</span></li>
              <li>Total plays: <span className="font-bold text-white">{diff.cloudSummary.totalPlays}</span></li>
            </ul>
          </div>
        </div>

        {(diff.overlappingPlaylists.length > 0 || diff.overlappingLikedCount > 0) && (
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-[#1DB954]/10 p-3 text-xs text-[#b7f4ca]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#1DB954]" />
            <span>
              Matching items ({diff.overlappingPlaylists.length} playlists, {diff.overlappingLikedCount} liked songs) will be deduplicated safely while preserving playlist track order and stats.
            </span>
          </div>
        )}

        <div className="mt-5 space-y-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void choose('merge')}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#1DB954] px-4 py-2.5 text-xs font-extrabold text-black hover:bg-[#1ed760] disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Merge Device &amp; Cloud Libraries (Recommended)
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => void choose('local-overwrite')}
            className="w-full rounded-lg bg-[#2a2a32] px-4 py-2 text-xs font-bold text-white hover:bg-[#353540] disabled:opacity-50"
          >
            Keep Device Data &amp; Update Cloud
          </button>

          {diff.cloudSummary.playlists > 0 || diff.cloudSummary.likedSongs > 0 || diff.cloudSummary.totalPlays > 0 ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void choose('cloud-only')}
              className="w-full rounded-lg bg-[#242429] px-4 py-2 text-xs font-bold text-zinc-200 hover:bg-[#303036] disabled:opacity-50"
            >
              Use Cloud Data Only (Keep Local Backup)
            </button>
          ) : null}

          <button
            type="button"
            disabled={busy}
            onClick={() => void choose('cancel')}
            className="w-full rounded-lg px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-white disabled:opacity-50"
          >
            Cancel &amp; Stay in Guest Mode
          </button>
        </div>
      </div>
    </div>
  );
}
