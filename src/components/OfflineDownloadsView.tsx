import { useCallback, useEffect, useState } from 'react';
import { Music2, Trash2, Upload } from 'lucide-react';
import type { Track } from '../types/music';
import {
  formatStorageBytes,
  normalizeImportedAudioBlob,
} from '../utils/offlineHelpers';
import {
  getOrCreateOfflineObjectUrl,
  listOfflineTracks,
  removeOfflineTrack,
  saveOfflineTrack,
  type OfflineTrackRecord,
} from '../utils/offlineStore';

function notifyOfflineLibraryChanged() {
  window.dispatchEvent(new Event('harmonia-offline-library-change'));
}

export function OfflineDownloadsView({
  onPlayList,
  onToast,
}: {
  onPlayList: (tracks: Track[], index: number) => void;
  onToast: (message: string) => void;
}) {
  const [items, setItems] = useState<OfflineTrackRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setItems(await listOfflineTracks());
    } catch {
      onToast('Offline storage is unavailable in this browser.');
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    void refresh();
    window.addEventListener('harmonia-offline-library-change', refresh);
    return () => {
      window.removeEventListener('harmonia-offline-library-change', refresh);
      // Do not revoke playback URLs here: the queue can continue playing after
      // navigating away from this screen. The shared offline store revokes them
      // when the corresponding file is removed.
    };
  }, [refresh]);

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    let imported = 0;
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('audio/') && !/\.(mp3|m4a|aac|ogg|opus|wav|flac)$/i.test(file.name)) {
          continue;
        }
        const base = file.name.replace(/\.[^.]+$/, '');
        const split = base.split(' - ');
        const artist = split.length > 1 ? split.shift()!.trim() : 'Local audio';
        const name = split.join(' - ').trim() || base;
        const audioBlob = normalizeImportedAudioBlob(file, file.name);
        const record: OfflineTrackRecord = {
          id: 'local-' + file.name + '-' + file.size + '-' + file.lastModified,
          name,
          artist,
          albumName: 'Imported files',
          image: '',
          duration: 0,
          size: audioBlob.size,
          blob: audioBlob,
          provider: 'Local import',
          downloadedAt: Date.now(),
        };
        await saveOfflineTrack(record);
        imported += 1;
      }
      await refresh();
      notifyOfflineLibraryChanged();
      onToast(imported > 0 ? `Added ${imported} audio file${imported === 1 ? '' : 's'}.` : 'No supported audio files were selected.');
    } catch {
      onToast('Import failed. Check available device storage.');
    } finally {
      setBusy(false);
    }
  };

  const play = (index: number) => {
    const tracks: Track[] = items.map((item) => {
      const url = getOrCreateOfflineObjectUrl(item.id, item.blob);
      return {
        id: item.id,
        name: item.name,
        artist: item.artist,
        albumName: item.albumName || 'Offline files',
        duration: item.duration || 0,
        image: item.image || '',
        language: item.language,
        previewUrl: url,
        streamUrls: { '320kbps': url },
      };
    });
    onPlayList(tracks, index);
  };

  const remove = async (id: string) => {
    try {
      await removeOfflineTrack(id);
      await refresh();
      notifyOfflineLibraryChanged();
      onToast('Removed from offline library.');
    } catch {
      onToast('Could not remove this file.');
    }
  };

  const total = items.reduce((sum, item) => sum + item.size, 0);

  return (
    <section className="space-y-6 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-white">Offline Library</h1>
          <p className="mt-1 text-sm text-zinc-400">Your imported audio files, stored on this device</p>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-[#1DB954] px-4 py-2 text-sm font-bold text-black">
          <Upload className="h-4 w-4" />
          {busy ? 'Importing…' : 'Import audio'}
          <input
            type="file"
            accept="audio/*,.mp3,.m4a,.aac,.ogg,.opus,.wav,.flac"
            multiple
            disabled={busy}
            className="hidden"
            onChange={(event) => {
              const input = event.currentTarget;
              void importFiles(input.files).finally(() => { input.value = ''; });
            }}
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <div className="rounded-xl bg-[#1b1b1f] p-4">
          <p className="text-xs text-zinc-400">Saved files</p>
          <p className="mt-2 text-2xl font-bold text-white">{items.length}</p>
        </div>
        <div className="rounded-xl bg-[#1b1b1f] p-4">
          <p className="text-xs text-zinc-400">Storage used</p>
          <p className="mt-2 text-2xl font-bold text-white">{formatStorageBytes(total)}</p>
        </div>
      </div>

      {loading ? (
        <p className="py-8 text-center text-sm text-zinc-500">Loading…</p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-[#18181b] px-5 py-12 text-center">
          <Music2 className="mx-auto h-9 w-9 text-zinc-500" />
          <h2 className="mt-3 font-bold text-white">Your offline library is empty</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Import audio files you own or have permission to store. They will remain available on this device.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => play(0)}
              className="rounded-full bg-white px-4 py-2 text-xs font-bold text-black"
            >
              Play all
            </button>
          </div>
          {items.map((item, index) => (
            <div key={item.id} className="flex items-center gap-3 rounded-xl bg-[#1b1b1f] p-3">
              <button
                type="button"
                onClick={() => play(index)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <span className="grid h-11 w-11 place-items-center rounded-lg bg-[#29292f]">
                  <Music2 className="h-5 w-5 text-zinc-400" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-white">{item.name}</span>
                  <span className="block text-xs text-zinc-400">{item.artist} · {formatStorageBytes(item.size)}</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => void remove(item.id)}
                aria-label={'Remove ' + item.name}
                className="rounded-full p-2 text-zinc-400 hover:bg-white/10"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs leading-relaxed text-zinc-500">
        Stored in this browser’s local database. Clearing site data may remove these files. Streaming tracks can only be saved through a provider’s official offline feature when permitted.
      </p>
    </section>
  );
}
