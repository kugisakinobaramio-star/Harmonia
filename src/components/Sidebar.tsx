import { Compass, Download, Heart, Library, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { ARTWORK, SEED_ARTISTS, SEED_PLAYLISTS } from '../data/catalog';
import type { ArtistProfile, CuratedPlaylist, Track, ViewName } from '../types/music';
import { CoverImage } from './CoverImage';

interface SidebarProps {
  activeView: ViewName;
  activeCollectionId?: string;
  onSelectView: (view: ViewName) => void;
  onOpenPlaylist: (pl: CuratedPlaylist) => void;
  onOpenLiked: () => void;
  onOpenArtist: (artist: ArtistProfile) => void;
  onOpenCreatePlaylist: () => void;
  onOpenSpotifyImport: () => void;
  onOpenVideos: () => void;
  likedTracks: Track[];
  userPlaylists: CuratedPlaylist[];
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({
  activeView,
  activeCollectionId,
  onSelectView,
  onOpenPlaylist,
  onOpenLiked,
  onOpenArtist,
  onOpenCreatePlaylist,
  onOpenSpotifyImport,
  onOpenVideos,
  likedTracks,
  userPlaylists,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const [libFilter, setLibFilter] = useState<'all' | 'playlists' | 'artists'>('all');

  const allPlaylists = [...userPlaylists, ...SEED_PLAYLISTS];

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/75 backdrop-blur-xs lg:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        aria-label="Your Library sidebar"
        className={`harmonia-sidebar fixed inset-y-2 left-2 z-50 flex w-[280px] flex-col rounded-xl p-3 transition-transform duration-200 lg:static lg:h-full lg:w-[272px] lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-[112%]'
        }`}
      >
        <button type="button" onClick={() => { onSelectView('discover'); onCloseMobile(); }} className={`mb-3 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm font-semibold transition-colors ${activeView === 'discover' ? 'bg-white/10 text-white' : 'text-zinc-300 hover:bg-white/[0.06] hover:text-white'}`}>
          <Compass className="h-4 w-4" /> Discover
        </button>
        <div className="flex items-center justify-between px-1 pb-3">
          <button
            type="button"
            onClick={() => {
              onSelectView('library');
              onCloseMobile();
            }}
            className={`flex items-center gap-2.5 text-sm font-bold transition-colors ${
              activeView === 'library' ? 'text-white' : 'text-zinc-300 hover:text-white'
            }`}
          >
            <Library className="h-5 w-5" />
            <span>Your Library</span>
          </button>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onOpenCreatePlaylist}
              aria-label="Create playlist"
              title="Create playlist"
              className="inline-flex h-8 items-center gap-1 rounded-full bg-[#1f1f1f] px-2.5 text-xs font-bold text-zinc-200 transition-colors hover:bg-[#2a2a2a] hover:text-white"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Create</span>
            </button>

            <button
              type="button"
              onClick={onCloseMobile}
              aria-label="Close sidebar"
              className="rounded-full p-1 text-zinc-400 hover:bg-white/10 hover:text-white lg:hidden"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Library filter chips */}
        <div className="mb-3 flex gap-1.5 px-1">
          {(
            [
              { id: 'all', label: 'All' },
              { id: 'playlists', label: 'Playlists' },
              { id: 'artists', label: 'Artists' },
            ] as const
          ).map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => setLibFilter(chip.id)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                libFilter === chip.id
                  ? 'bg-white text-black'
                  : 'bg-[#232326] text-zinc-200 hover:bg-[#2e2e33]'
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>

        {/* Scrollable Library Items */}
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
          {libFilter !== 'artists' && (
            <button
              type="button"
              onClick={() => {
                onOpenLiked();
                onCloseMobile();
              }}
              className={`flex w-full items-center gap-3 rounded-md p-2 text-left transition-colors ${
                activeCollectionId === 'liked-songs' ? 'bg-white/10' : 'hover:bg-white/[0.06]'
              }`}
            >
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded bg-gradient-to-br from-emerald-700 to-zinc-800 text-white">
                <Heart className="h-5 w-5 fill-current text-[#1DB954]" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-white">Liked Songs</div>
                <div className="truncate text-xs text-zinc-400">
                  Playlist · {likedTracks.length} {likedTracks.length === 1 ? 'song' : 'songs'}
                </div>
              </div>
            </button>
          )}

          {libFilter !== 'artists' &&
            allPlaylists.map((pl) => {
              const isActive = activeCollectionId === pl.id;
              return (
                <button
                  key={pl.id}
                  type="button"
                  onClick={() => {
                    onOpenPlaylist(pl);
                    onCloseMobile();
                  }}
                  className={`flex w-full items-center gap-3 rounded-md p-2 text-left transition-colors ${
                    isActive ? 'bg-white/10' : 'hover:bg-white/[0.06]'
                  }`}
                >
                  <CoverImage
                    src={pl.tracks[0]?.image || pl.image || ARTWORK.englishVinyl}
                    alt={pl.name}
                    className="h-12 w-12 shrink-0 rounded object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div
                      className={`truncate text-sm font-semibold ${
                        isActive ? 'text-[#1DB954]' : 'text-white'
                      }`}
                    >
                      {pl.name}
                    </div>
                    <div className="truncate text-xs text-zinc-400">
                      {pl.isUserCreated ? 'Playlist' : pl.language || 'Mix'} · {pl.tracks.length} songs
                    </div>
                  </div>
                </button>
              );
            })}

          {libFilter !== 'playlists' &&
            SEED_ARTISTS.map((art) => {
              const isActive = activeCollectionId === art.id;
              return (
                <button
                  key={art.id}
                  type="button"
                  onClick={() => {
                    onOpenArtist(art);
                    onCloseMobile();
                  }}
                  className={`flex w-full items-center gap-3 rounded-md p-2 text-left transition-colors ${
                    isActive ? 'bg-white/10' : 'hover:bg-white/[0.06]'
                  }`}
                >
                  <CoverImage
                    src={art.image}
                    alt={art.name}
                    className="h-12 w-12 shrink-0 rounded-full object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div
                      className={`truncate text-sm font-semibold ${
                        isActive ? 'text-[#1DB954]' : 'text-white'
                      }`}
                    >
                      {art.name}
                    </div>
                    <div className="truncate text-xs text-zinc-400">
                      Artist · {art.language}
                    </div>
                  </div>
                </button>
              );
            })}
        </div>

        <button type="button" onClick={() => { onSelectView('downloads'); onCloseMobile(); }} className="mb-2 flex w-full items-center gap-2 rounded-md bg-[#1a1a1d] px-3 py-2 text-xs font-semibold text-zinc-300 hover:bg-[#252529]"><Download className="h-4 w-4" /> Offline Downloads</button>

        {/* Utility shortcuts at bottom of sidebar */}
        <div className="mt-2 flex gap-1.5 border-t border-white/[0.06] pt-2.5">
          <button
            type="button"
            onClick={() => {
              onOpenVideos();
              onCloseMobile();
            }}
            className="flex-1 rounded-md bg-[#1a1a1d] px-2.5 py-1.5 text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-[#252529] hover:text-white"
          >
            Music Videos
          </button>
          <button
            type="button"
            onClick={() => {
              onOpenSpotifyImport();
              onCloseMobile();
            }}
            className="flex-1 rounded-md bg-[#1a1a1d] px-2.5 py-1.5 text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-[#252529] hover:text-white"
          >
            Import Link
          </button>
        </div>
      </aside>
    </>
  );
}
