import type { AudioQuality, Track } from '../types/music';
import { apiUrl } from './apiUrl';
import { resolveTrackStreams } from './musicApi';
import {
  collectDownloadCandidateUrls,
  formatStorageBytes,
  isCollectionFullyDownloaded,
  offlineItemToTrack,
  sanitizeDownloadFilename,
  type OfflineTrackRecord,
} from './offlineHelpers';
import { hasFullAudioStream, isShortPreviewUrl } from './playerEngine';

export {
  collectDownloadCandidateUrls,
  formatStorageBytes,
  isCollectionFullyDownloaded,
  offlineItemToTrack,
  sanitizeDownloadFilename,
  type OfflineTrackRecord,
};

export const OFFLINE_DB_NAME = 'harmonia-offline-audio';
export const OFFLINE_STORE_NAME = 'tracks';

const objectUrlCache = new Map<string, string>();
let knownOfflineIdsCache: Set<string> | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(OFFLINE_DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(OFFLINE_STORE_NAME)) {
        req.result.createObjectStore(OFFLINE_STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listOfflineTracks(): Promise<OfflineTrackRecord[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(OFFLINE_STORE_NAME, 'readonly').objectStore(OFFLINE_STORE_NAME).getAll();
    req.onsuccess = () => {
      db.close();
      const items = (req.result as OfflineTrackRecord[]).sort(
        (a, b) => (b.downloadedAt || 0) - (a.downloadedAt || 0)
      );
      knownOfflineIdsCache = new Set(items.map((item) => item.id));
      resolve(items);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

export async function getOfflineTrack(id: string): Promise<OfflineTrackRecord | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(OFFLINE_STORE_NAME, 'readonly').objectStore(OFFLINE_STORE_NAME).get(id);
    req.onsuccess = () => {
      db.close();
      resolve((req.result as OfflineTrackRecord | undefined) || null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

export async function saveOfflineTrack(item: OfflineTrackRecord): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(OFFLINE_STORE_NAME, 'readwrite').objectStore(OFFLINE_STORE_NAME).put({
      ...item,
      downloadedAt: item.downloadedAt ?? Date.now(),
    });
    req.onsuccess = () => {
      db.close();
      const existingUrl = objectUrlCache.get(item.id);
      if (existingUrl) {
        URL.revokeObjectURL(existingUrl);
        objectUrlCache.delete(item.id);
      }
      if (knownOfflineIdsCache) knownOfflineIdsCache.add(item.id);
      resolve();
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

export async function removeOfflineTrack(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(OFFLINE_STORE_NAME, 'readwrite').objectStore(OFFLINE_STORE_NAME).delete(id);
    req.onsuccess = () => {
      db.close();
      const url = objectUrlCache.get(id);
      if (url) {
        URL.revokeObjectURL(url);
        objectUrlCache.delete(id);
      }
      if (knownOfflineIdsCache) knownOfflineIdsCache.delete(id);
      resolve();
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

export function getOrCreateOfflineObjectUrl(id: string, blob: Blob): string {
  const existing = objectUrlCache.get(id);
  if (existing) return existing;
  const created = URL.createObjectURL(blob);
  objectUrlCache.set(id, created);
  return created;
}

export async function getOfflineAudioUrl(id: string): Promise<string | null> {
  const cached = objectUrlCache.get(id);
  if (cached) return cached;
  if (knownOfflineIdsCache && !knownOfflineIdsCache.has(id)) return null;
  try {
    const item = await getOfflineTrack(id);
    if (!item?.blob || item.blob.size === 0) return null;
    if (knownOfflineIdsCache) knownOfflineIdsCache.add(id);
    return getOrCreateOfflineObjectUrl(id, item.blob);
  } catch {
    return null;
  }
}

async function fetchAudioBlob(url: string, filename: string): Promise<Blob | null> {
  const proxyEndpoint = apiUrl(
    `/api/music/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`
  );
  const attempts = proxyEndpoint !== url ? [proxyEndpoint, url] : [url];

  for (const target of attempts) {
    const controller = new AbortController();
    let connectTimer: ReturnType<typeof setTimeout> | undefined;
    let bodyTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Fail over quickly when a provider never responds, but give a valid
      // stream enough time to finish downloading on a slower mobile connection.
      connectTimer = setTimeout(() => controller.abort(), 10_000);
      const response = await fetch(target, { signal: controller.signal });
      clearTimeout(connectTimer);
      connectTimer = undefined;
      if (!response.ok) continue;
      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (contentType.includes('text/html') || contentType.includes('application/json')) continue;
      bodyTimer = setTimeout(() => controller.abort(), 120_000);
      const blob = await response.blob();
      if (blob.size >= 1024 && !blob.type.includes('text/html') && !blob.type.includes('json')) {
        return blob;
      }
    } catch {
      // Try next fallback
    } finally {
      if (connectTimer) clearTimeout(connectTimer);
      if (bodyTimer) clearTimeout(bodyTimer);
    }
  }
  return null;
}

export async function downloadTrackForOffline(
  track: Track,
  quality: AudioQuality = '320kbps'
): Promise<OfflineTrackRecord> {
  let workingTrack: Track & { alternates?: string[] } = track;
  let candidates = collectDownloadCandidateUrls(workingTrack, quality).filter((url) => !isShortPreviewUrl(url));

  if (!hasFullAudioStream(workingTrack) || candidates.length === 0) {
    const resolved = await resolveTrackStreams(track, { forceRefresh: candidates.length === 0 });
    workingTrack = { ...track, ...resolved, alternates: resolved.alternates };
    candidates = collectDownloadCandidateUrls(workingTrack, quality).filter((url) => !isShortPreviewUrl(url));
  }

  if (!candidates.length) {
    throw new Error(`No downloadable audio stream is available for "${track.name}".`);
  }

  const filename = sanitizeDownloadFilename(track.name, track.artist);
  let downloadedBlob: Blob | null = null;
  let usedUrl = '';

  for (const candidateUrl of candidates.slice(0, 5)) {
    const blob = await fetchAudioBlob(candidateUrl, filename);
    if (blob) {
      downloadedBlob = blob;
      usedUrl = candidateUrl;
      break;
    }
  }

  if (!downloadedBlob) {
    throw new Error(`Could not download audio for "${track.name}". Try again shortly.`);
  }

  const record: OfflineTrackRecord = {
    id: track.id,
    name: track.name,
    artist: track.artist,
    albumName: track.albumName,
    image: track.image,
    duration: track.duration,
    language: track.language,
    size: downloadedBlob.size,
    blob: downloadedBlob,
    provider: 'Harmonia Offline',
    sourceUrl: usedUrl,
    downloadedAt: Date.now(),
  };

  await saveOfflineTrack(record);
  getOrCreateOfflineObjectUrl(track.id, downloadedBlob);
  return record;
}

export function triggerBrowserFileSave(item: Pick<OfflineTrackRecord, 'name' | 'artist' | 'blob'>): void {
  const url = URL.createObjectURL(item.blob);
  const ext = item.blob.type.includes('mp4') || item.blob.type.includes('aac')
    ? 'm4a'
    : item.blob.type.includes('ogg')
      ? 'ogg'
      : item.blob.type.includes('wav')
        ? 'wav'
        : 'mp3';
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sanitizeDownloadFilename(item.name, item.artist)}.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
