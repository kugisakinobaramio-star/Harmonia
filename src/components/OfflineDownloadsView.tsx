import { useEffect, useState } from 'react';
import { Music2, Trash2, Upload } from 'lucide-react';
import type { Track } from '../types/music';

type Item = { id: string; name: string; artist: string; size: number; blob: Blob };
const DB = 'harmonia-offline-audio';
const STORE = 'tracks';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function allItems(): Promise<Item[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => { db.close(); resolve(req.result as Item[]); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}
async function putItem(item: Item) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put(item);
    req.onsuccess = () => { db.close(); resolve(); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}
async function deleteItem(id: string) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id);
    req.onsuccess = () => { db.close(); resolve(); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}
const sizeText = (n: number) => n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB';

export function OfflineDownloadsView({ onPlayList, onToast }: { onPlayList: (tracks: Track[], index: number) => void; onToast: (message: string) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [urls] = useState(() => new Map<string, string>());
  const refresh = async () => {
    try { setItems(await allItems()); } catch { onToast('Offline storage is unavailable in this browser.'); }
    setLoading(false);
  };
  useEffect(() => { void refresh(); return () => { urls.forEach((url) => URL.revokeObjectURL(url)); }; }, []);
  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('audio/') && !/\.(mp3|m4a|aac|ogg|opus|wav|flac)$/i.test(file.name)) continue;
        const base = file.name.replace(/\.[^.]+$/, '');
        const split = base.split(' - ');
        const artist = split.length > 1 ? split.shift()!.trim() : 'Local audio';
        const name = split.join(' - ').trim() || base;
        await putItem({ id: 'local-' + file.name + '-' + file.size + '-' + file.lastModified, name, artist, size: file.size, blob: file });
      }
      await refresh();
      onToast('Audio files added to your offline library.');
    } catch { onToast('Import failed. Check available device storage.'); }
    finally { setBusy(false); }
  };
  const play = (index: number) => {
    const tracks = items.map((item) => {
      let url = urls.get(item.id);
      if (!url) { url = URL.createObjectURL(item.blob); urls.set(item.id, url); }
      return { id: item.id, name: item.name, artist: item.artist, albumName: 'Offline files', duration: 0, image: '', previewUrl: url, streamUrls: { '320kbps': url } };
    });
    onPlayList(tracks, index);
  };
  const remove = async (id: string) => {
    try { await deleteItem(id); const url = urls.get(id); if (url) URL.revokeObjectURL(url); urls.delete(id); await refresh(); onToast('Removed from offline library.'); }
    catch { onToast('Could not remove this file.'); }
  };
  const total = items.reduce((sum, item) => sum + item.size, 0);
  return <section className="space-y-6 pb-10">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-extrabold text-white">Offline Library</h1><p className="mt-1 text-sm text-zinc-400">Your imported audio files, stored on this device</p></div>
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-[#1DB954] px-4 py-2 text-sm font-bold text-black"><Upload className="h-4 w-4" />{busy ? 'Importing…' : 'Import audio'}<input type="file" accept="audio/*,.mp3,.m4a,.aac,.ogg,.opus,.wav,.flac" multiple disabled={busy} className="hidden" onChange={(e) => void importFiles(e.target.files)} /></label></div>
    <div className="grid grid-cols-2 gap-3 sm:max-w-md"><div className="rounded-xl bg-[#1b1b1f] p-4"><p className="text-xs text-zinc-400">Saved files</p><p className="mt-2 text-2xl font-bold text-white">{items.length}</p></div><div className="rounded-xl bg-[#1b1b1f] p-4"><p className="text-xs text-zinc-400">Storage used</p><p className="mt-2 text-2xl font-bold text-white">{sizeText(total)}</p></div></div>
    {loading ? <p className="py-8 text-center text-sm text-zinc-500">Loading…</p> : items.length === 0 ? <div className="rounded-xl border border-dashed border-white/10 bg-[#18181b] px-5 py-12 text-center"><Music2 className="mx-auto h-9 w-9 text-zinc-500" /><h2 className="mt-3 font-bold text-white">Your offline library is empty</h2><p className="mt-1 text-sm text-zinc-400">Import audio files you own or have permission to store. They will remain available on this device.</p></div> : <div className="space-y-2"><div className="flex justify-end"><button onClick={() => play(0)} className="rounded-full bg-white px-4 py-2 text-xs font-bold text-black">Play all</button></div>{items.map((item, index) => <div key={item.id} className="flex items-center gap-3 rounded-xl bg-[#1b1b1f] p-3"><button onClick={() => play(index)} className="flex min-w-0 flex-1 items-center gap-3 text-left"><span className="grid h-11 w-11 place-items-center rounded-lg bg-[#29292f]"><Music2 className="h-5 w-5 text-zinc-400" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-white">{item.name}</span><span className="block text-xs text-zinc-400">{item.artist} · {sizeText(item.size)}</span></span></button><button onClick={() => void remove(item.id)} aria-label={'Remove ' + item.name} className="rounded-full p-2 text-zinc-400 hover:bg-white/10"><Trash2 className="h-4 w-4" /></button></div>)}</div>}
    <p className="text-xs leading-relaxed text-zinc-500">Stored in this browser’s local database. Clearing site data may remove these files. Streaming tracks can only be saved through a provider’s official offline feature when permitted.</p>
  </section>;
}
