import type { AudioQuality, Track } from '../types/music';
import { isShortPreviewUrl } from './playerEngine';

export interface OfflineTrackRecord {
  id: string;
  name: string;
  artist: string;
  albumName?: string;
  image?: string;
  duration?: number;
  language?: Track['language'];
  size: number;
  blob: Blob;
  provider?: string;
  license?: string;
  sourceUrl?: string;
  downloadedAt?: number;
}

type StreamKey = keyof NonNullable<Track['streamUrls']>;

const AUDIO_MIME_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  flac: 'audio/flac',
};

export function normalizeImportedAudioBlob(file: Blob, fileName: string): Blob {
  if (file.type.startsWith('audio/')) return file;
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  const mimeType = AUDIO_MIME_TYPES[extension];
  return mimeType ? file.slice(0, file.size, mimeType) : file;
}

export function formatStorageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1048576) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function sanitizeDownloadFilename(name: string, artist?: string): string {
  const raw = artist ? `${artist} - ${name}` : name;
  const cleaned = raw
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 96);
  return cleaned || 'harmonia-track';
}

export function collectDownloadCandidateUrls(
  track: Track & { alternates?: string[] },
  quality: AudioQuality = '320kbps'
): string[] {
  const order: StreamKey[] =
    quality === '160kbps'
      ? ['160kbps', '320kbps', '96kbps', '48kbps', '12kbps']
      : quality === '96kbps'
        ? ['96kbps', '160kbps', '320kbps', '48kbps', '12kbps']
        : ['320kbps', '160kbps', '96kbps', '48kbps', '12kbps'];

  const rawList: string[] = [];
  if (track.streamUrls) {
    for (const q of order) {
      const u = track.streamUrls[q];
      if (u) rawList.push(u);
    }
  }
  if (track.alternates?.length) {
    rawList.push(...track.alternates);
  }
  if (track.previewUrl) {
    rawList.push(track.previewUrl);
  }

  const seen = new Set<string>();
  const valid: string[] = [];
  for (const candidate of rawList) {
    const trimmed = String(candidate || '').trim();
    if (!trimmed || seen.has(trimmed)) continue;
    if (!/^https?:\/\//i.test(trimmed)) continue;
    seen.add(trimmed);
    valid.push(trimmed);
  }

  // Prefer full-length streams over 30s preview clips when both are present.
  const full = valid.filter((url) => !isShortPreviewUrl(url));
  const previews = valid.filter((url) => isShortPreviewUrl(url));
  return [...full, ...previews];
}

export function isCollectionFullyDownloaded(
  tracks: Pick<Track, 'id' | 'offlineAvailable' | 'sourceProvider'>[],
  downloadedIds: Set<string>
): boolean {
  const downloadable = tracks.filter(
    (t) => t.offlineAvailable !== false && t.sourceProvider !== 'Jamendo'
  );
  if (!downloadable.length) return false;
  return downloadable.every((t) => downloadedIds.has(t.id));
}

export function offlineItemToTrack(item: OfflineTrackRecord, objectUrl: string): Track {
  return {
    id: item.id,
    name: item.name,
    artist: item.artist,
    albumName: item.albumName || 'Offline Downloads',
    duration: item.duration || 0,
    image: item.image || '',
    language: item.language,
    previewUrl: objectUrl,
    streamUrls: { '320kbps': objectUrl },
  };
}
