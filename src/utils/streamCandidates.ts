import type { AudioQuality, Track } from '../types/music';
import { isShortPreviewUrl, selectStreamUrl } from './playerEngine';

export interface PartitionedStreamCandidates {
  full: string[];
  preview: string[];
}

export function wrapStreamCandidateUrl(
  raw: string,
  wrapProxy: (url: string) => string
): string[] {
  if (!raw) return [];
  if (raw.startsWith('/api/')) return [wrapProxy(raw)];
  if (raw.startsWith('/') || raw.startsWith('data:') || raw.startsWith('blob:')) return [raw];
  if (/^https?:\/\//i.test(raw)) {
    const out = [wrapProxy(`/api/music/audio?url=${encodeURIComponent(raw)}`)];
    if (raw.startsWith('https://')) out.push(raw);
    return out;
  }
  return [];
}

/**
 * Keeps full-length audio streams strictly ahead of 30-second catalogue previews
 * so full tracks are always attempted first while preview-only catalogue tracks
 * remain playable when no full-length audio provider exists.
 */
export function partitionStreamCandidates(
  track: Track,
  quality: AudioQuality,
  extraAlternates: string[] = [],
  wrapProxy: (url: string) => string = (url) => url
): PartitionedStreamCandidates {
  const fullRaw: string[] = [];
  const previewRaw: string[] = [];

  const pushRaw = (url?: string) => {
    if (!url) return;
    if (isShortPreviewUrl(url)) previewRaw.push(url);
    else fullRaw.push(url);
  };

  pushRaw(selectStreamUrl(track, quality));
  if (track.streamUrls) {
    for (const q of ['320kbps', '160kbps', '96kbps', '48kbps', '12kbps'] as const) {
      pushRaw(track.streamUrls[q]);
    }
  }
  for (const alt of extraAlternates) {
    pushRaw(alt);
  }
  pushRaw(track.previewUrl);

  const trackAlternates = (track as Track & { alternates?: string[] }).alternates || [];
  for (const alt of trackAlternates) {
    pushRaw(alt);
  }

  const normalizeList = (rawList: string[]): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of rawList) {
      for (const wrapped of wrapStreamCandidateUrl(raw, wrapProxy)) {
        if (!seen.has(wrapped)) {
          seen.add(wrapped);
          out.push(wrapped);
        }
      }
    }
    return out;
  };

  return {
    full: normalizeList(fullRaw),
    preview: normalizeList(previewRaw),
  };
}
