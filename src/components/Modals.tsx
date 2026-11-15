import { Check, Crosshair, ExternalLink, Loader2, Play, Plus, RotateCcw, Search, Sparkles, UserRound, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SEED_ARTISTS } from '../data/catalog';
import { apiUrl } from '../utils/apiUrl';
import type {
  CuratedPlaylist,
  MusicLanguage,
  MusicRegion,
  PersonalisationSettings,
  Track,
  VideoResult,
} from '../types/music';
import { extractSpotifySearchHint, isSpotifyLinkOrUri, REGION_LABELS } from '../utils/playerEngine';
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
      className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4 backdrop-blur-xs"
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
  onSearchQuery: (query: string) => void;
  onSwitchToVideos: (query: string) => void;
  onImportSpotifyUrl: (url: string) => Promise<{ ok: boolean; error?: string }>;
}

export function SpotifyImportModal({
  open,
  onClose,
  onSearchQuery,
  onSwitchToVideos,
  onImportSpotifyUrl,
}: SpotifyImportModalProps) {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [resolving, setResolving] = useState(false);

  if (!open) return null;

  const spotifyQuery = extractSpotifySearchHint(input) || 'top hits';

  const handleSubmit = async (rawValue = input) => {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      setError('Paste a Spotify link or type a song name first.');
      return;
    }

    if (isSpotifyLinkOrUri(trimmed)) {
      setResolving(true);
      setError('');
      const res = await onImportSpotifyUrl(trimmed);
      setResolving(false);
      if (res.ok) {
        setInput('');
        onClose();
      } else {
        setError(res.error || 'Could not load that Spotify link.');
      }
      return;
    }

    onSearchQuery(extractSpotifySearchHint(trimmed));
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Stream Spotify Free link"
      className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4 backdrop-blur-xs"
    >
      <div className="w-full max-w-lg rounded-xl border border-white/10 bg-[#18181b] p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-extrabold text-white">Import from Spotify</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-full p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-2 text-xs leading-relaxed text-zinc-400">
          Paste a public Spotify track, album, or playlist link to import its metadata into Harmonia.
          Playback, when available, comes from separate providers; this does not unlock Spotify audio
          or guarantee a full-length track. You can also browse public playlist information below.
        </p>

        <label htmlFor="spotify-import-input" className="sr-only">
          Spotify link or song name
        </label>
        <input
          id="spotify-import-input"
          type="text"
          autoFocus
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="https://open.spotify.com/playlist/... or song name"
          className="mt-3 w-full rounded-lg border border-white/10 bg-[#242429] px-3.5 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-[#1DB954] focus:outline-none"
        />

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {[
            { label: "Today's Top Hits", url: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M' },
            { label: 'Hot Hits Hindi', url: 'https://open.spotify.com/playlist/37i9dQZF1DX0XUfTFmNBRM' },
            { label: 'Top 50 Japan', url: 'https://open.spotify.com/playlist/37i9dQZEVXbKXQ4mDTEBXq' },
          ].map((preset) => (
            <button
              key={preset.label}
              type="button"
              disabled={resolving}
              onClick={() => {
                setInput(preset.url);
                handleSubmit(preset.url);
              }}
              className="rounded-full bg-[#242429] px-2.5 py-1 text-[11px] font-semibold text-zinc-200 hover:bg-[#323238] hover:text-white disabled:opacity-50"
            >
              {preset.label}
            </button>
          ))}
        </div>

        {error && <p className="mt-2 text-xs font-medium text-red-400">{error}</p>}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={resolving}
            onClick={() => handleSubmit()}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#1DB954] px-4 py-2 text-xs font-extrabold text-black disabled:opacity-60"
          >
            {resolving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {resolving ? 'Loading Spotify...' : 'Stream Ad-Free'}
          </button>

          <button
            type="button"
            onClick={() => {
              const hint = extractSpotifySearchHint(input) || 'official music video';
              onSwitchToVideos(hint);
              onClose();
            }}
            className="rounded-full bg-[#242429] px-4 py-2 text-xs font-bold text-white hover:bg-[#303036]"
          >
            Search Video
          </button>

          <a
            href={`https://open.spotify.com/search/${encodeURIComponent(spotifyQuery)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full bg-[#242429] px-4 py-2 text-xs font-bold text-[#1DB954] hover:bg-[#303036]"
          >
            Open External
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
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
            {activeVideo?.title || 'Harmonia Video Search'}
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
  { name: 'Pritam', image: apiUrl('/api/music/image?title=Kesariya+Pritam', lang: 'Hindi' },
  { name: 'Shreya Ghoshal', image: apiUrl('/api/music/image?title=Shreya+Ghoshal', lang: 'Hindi' },
  { name: 'Diljit Dosanjh', image: apiUrl('/api/music/image?title=Diljit+Dosanjh', lang: 'Hindi' },
  { name: 'Fujii Kaze', image: apiUrl('/api/music/image?title=Shinunoga+E-Wa+Fujii+Kaze', lang: 'J-Pop' },
  { name: 'Billie Eilish', image: apiUrl('/api/music/image?title=Birds+Of+A+Feather+Billie+Eilish', lang: 'English' },
  { name: 'Glass Animals', image: apiUrl('/api/music/image?title=Heat+Waves+Glass+Animals', lang: 'English' },
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
  'Indonesian', 'J-Pop',
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
      prev.includes(lang) ? (prev.length > 1 ? prev.filter((l) => l !== lang) : prev) : [...prev, lang]
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
      aria-label="Personalise your Harmonia feed"
      className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4 backdrop-blur-xs"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-white/10 bg-[#18181b] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-[#1DB954]/15 text-[#1DB954]">
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-lg font-extrabold text-white">Personalise Your Feed</h2>
              <p className="text-xs text-zinc-400">
                Tune your recommendations, language weights, and favorite artists
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
            <div className="mb-2 text-xs font-bold text-zinc-300">
              Music Language Priorities (select at least one)
            </div>
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

            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
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
            <div className="flex flex-wrap gap-1.5">
              {MOOD_OPTIONS.map((mood) => {
                const active = preferredMoods.includes(mood);
                return (
                  <button
                    key={mood}
                    type="button"
                    onClick={() => toggleMood(mood)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
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
  onClose,
  onEditPreferences,
}: ProfileModalProps) {
  if (!open) return null;
  const initial = displayName.trim().charAt(0).toUpperCase() || 'H';
  return (
    <div role="dialog" aria-modal="true" aria-label="Your Harmonia profile" className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-[#18181b] shadow-2xl">
        <div className="relative bg-gradient-to-br from-[#183b2a] via-[#20252a] to-[#18181b] px-5 pb-5 pt-4">
          <div className="flex justify-end">
            <button type="button" onClick={onClose} aria-label="Close profile" className="rounded-full bg-black/30 p-2 text-zinc-200 hover:bg-black/50"><X className="h-4 w-4" /></button>
          </div>
          <div className="flex items-end gap-4">
            <div className="grid h-20 w-20 shrink-0 place-items-center rounded-full border-4 border-white/10 bg-[#1DB954] text-3xl font-black text-black shadow-xl">{initial}</div>
            <div className="min-w-0 pb-1">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#9ce8b7]">Your listener profile</p>
              <h2 className="truncate text-2xl font-extrabold text-white">{displayName.trim() || 'Listener'}</h2>
              <p className="text-xs text-zinc-300">Harmonia · {region}</p>
            </div>
          </div>
        </div>
        <div className="space-y-5 p-5">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-[#242429] p-3"><div className="text-xl font-extrabold text-white">{totalPlays}</div><div className="text-[11px] text-zinc-400">Total plays</div></div>
            <div className="rounded-xl bg-[#242429] p-3"><div className="text-xl font-extrabold text-white">{uniqueTracks}</div><div className="text-[11px] text-zinc-400">Tracks played</div></div>
            <div className="rounded-xl bg-[#242429] p-3"><div className="text-xl font-extrabold text-white">{likedCount}</div><div className="text-[11px] text-zinc-400">Liked songs</div></div>
          </div>
          <section>
            <h3 className="mb-2 text-sm font-bold text-white">Your music taste</h3>
            <p className="mb-2 text-xs text-zinc-400">Your mixes adapt as you listen, replay and save tracks.</p>
            <div className="flex flex-wrap gap-2">
              {preferredLanguages.slice(0, 8).map((item) => <span key={item} className="rounded-full bg-[#26382d] px-3 py-1 text-xs text-[#b7f4ca]">{item}</span>)}
              {favoriteArtists.slice(0, 8).map((item) => <span key={item} className="rounded-full bg-[#29292f] px-3 py-1 text-xs text-zinc-200">{item}</span>)}
              {preferredMoods.slice(0, 5).map((item) => <span key={item} className="rounded-full bg-[#29292f] px-3 py-1 text-xs text-zinc-300">{item}</span>)}
              {!preferredLanguages.length && !favoriteArtists.length && !preferredMoods.length && <span className="text-xs text-zinc-500">Your taste profile is still learning. Play and like a few songs to shape it.</span>}
            </div>
          </section>
          <div className="flex flex-wrap gap-2 border-t border-white/[0.08] pt-4">
            <button type="button" onClick={onEditPreferences} className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-[#1DB954] px-4 py-2.5 text-xs font-extrabold text-black hover:bg-[#1ed760]"><UserRound className="h-4 w-4" /> Edit profile & taste</button>
            <button type="button" onClick={onClose} className="rounded-full bg-[#2a2a30] px-4 py-2.5 text-xs font-bold text-zinc-200 hover:bg-[#35353c]">Done</button>
          </div>
          <p className="text-[10px] leading-relaxed text-zinc-500">Your profile and listening stats are stored on this device. They are not synced to an account or shared server.</p>
        </div>
      </div>
    </div>
  );
}
