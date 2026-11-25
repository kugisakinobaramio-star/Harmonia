import type {
  AudioQuality,
  CuratedPlaylist,
  EqPreset,
  FollowedArtist,
  MusicLanguage,
  MusicRegion,
  Track,
} from '../types/music';
import {
  sanitizeFollowedArtistForCloud,
  sanitizeTrackForCloud,
  SCHEMA_VERSION,
} from './cloudSanitizer';

export interface MusicKKLocalSnapshot {
  schemaVersion?: number;
  updatedAtMs?: number;
  displayName?: string;
  region?: MusicRegion;
  preferredLanguages?: MusicLanguage[];
  favoriteArtists?: string[];
  preferredMoods?: string[];
  prioritizeLyrics?: boolean;
  likedMap?: Record<string, Track>;
  likedTimestamps?: Record<string, number>;
  playlists?: CuratedPlaylist[];
  playlistUpdatedAtMs?: Record<string, number>;
  recentlyPlayed?: Track[];
  artistAffinity?: Record<string, number>;
  languageAffinity?: Record<string, number>;
  genreAffinity?: Record<string, number>;
  playCounts?: Record<string, number>;
  listeningFeedback?: Record<string, { skips: number; completions: number }>;
  playedTracks?: Record<string, Track>;
  tasteResetActive?: boolean;
  tasteLikedMap?: Record<string, Track>;
  tasteRecentTracks?: Track[];
  volume?: number;
  quality?: AudioQuality;
  eqPreset?: EqPreset;
  deletedPlaylistIds?: Record<string, number>;
  deletedLikedIds?: Record<string, number>;
  followedArtists?: Record<string, FollowedArtist>;
  deletedFollowedArtistIds?: Record<string, number>;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const MAIN_STORAGE_KEY = 'harmonia_spotify_state_v2';
export const GUEST_SNAPSHOT_KEY = 'musick_guest_snapshot_v1';
export const ACCOUNT_CACHE_PREFIX = 'musick_account_cache_v1:';
export const MIGRATION_DONE_PREFIX = 'musick_migrated_v1:';
export const LOCAL_BACKUPS_KEY = 'musick_local_backups_v1';
export const SYNC_QUEUE_PREFIX = 'musick_sync_queue_v1:';
export const LAST_ACTIVE_UID_KEY = 'musick_last_uid_v1';

export type CloudSyncState =
  | 'guest'
  | 'idle'
  | 'syncing'
  | 'synced'
  | 'offline'
  | 'migration-pending'
  | 'error';

export interface LocalBackupEntry {
  id: string;
  createdAtMs: number;
  reason: string;
  uid: string | null;
  summary: {
    playlists: number;
    likedSongs: number;
    recentPlays: number;
    totalPlays: number;
    followedArtists?: number;
  };
  snapshot: MusicKKLocalSnapshot;
}

export interface SyncQueueItem {
  id: string;
  uid: string;
  reason: string;
  createdAtMs: number;
  updatedAtMs: number;
  attempts: number;
  nextAttemptAtMs: number;
  lastError?: string;
}

export interface MigrationDiff {
  needsPreview: boolean;
  localSummary: {
    playlists: number;
    playlistTracks: number;
    likedSongs: number;
    recentPlays: number;
    totalPlays: number;
    displayName: string;
  };
  cloudSummary: {
    playlists: number;
    playlistTracks: number;
    likedSongs: number;
    recentPlays: number;
    totalPlays: number;
    displayName: string;
  };
  overlappingPlaylists: string[];
  overlappingLikedCount: number;
  localOnlyPlaylists: number;
  cloudOnlyPlaylists: number;
}

export type MigrationResolution = 'merge' | 'cloud-only' | 'local-overwrite' | 'cancel';

const MAX_BACKUPS = 5;

function getDefaultStorage(): StorageLike | null {
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    // Restricted storage environment
  }
  return null;
}

export function createEmptySnapshot(): MusicKKLocalSnapshot {
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAtMs: 0,
    displayName: 'Listener',
    region: 'IN',
    preferredLanguages: [],
    favoriteArtists: [],
    preferredMoods: [],
    prioritizeLyrics: true,
    likedMap: {},
    likedTimestamps: {},
    playlists: [],
    playlistUpdatedAtMs: {},
    recentlyPlayed: [],
    artistAffinity: {},
    languageAffinity: {},
    genreAffinity: {},
    playCounts: {},
    listeningFeedback: {},
    playedTracks: {},
    tasteResetActive: false,
    tasteLikedMap: {},
    tasteRecentTracks: [],
    volume: 85,
    quality: '320kbps',
    eqPreset: 'flat',
    deletedPlaylistIds: {},
    deletedLikedIds: {},
    followedArtists: {},
    deletedFollowedArtistIds: {},
  };
}

export function withoutTransientTrackFields(track: Track): Track {
  const clean = sanitizeTrackForCloud(track);
  return {
    ...clean,
    language: clean.language as Track['language'],
  };
}

export function normalizeSnapshotForStorage(snap: MusicKKLocalSnapshot): MusicKKLocalSnapshot {
  const followedArtists: Record<string, FollowedArtist> = {};
  for (const [id, artist] of Object.entries(snap.followedArtists || {})) {
    if (!artist || !artist.name) continue;
    followedArtists[id] = sanitizeFollowedArtistForCloud(artist, id);
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAtMs: snap.updatedAtMs || Date.now(),
    displayName: snap.displayName || 'Listener',
    region: snap.region || 'IN',
    preferredLanguages: snap.preferredLanguages || [],
    favoriteArtists: snap.favoriteArtists || [],
    preferredMoods: snap.preferredMoods || [],
    prioritizeLyrics: typeof snap.prioritizeLyrics === 'boolean' ? snap.prioritizeLyrics : true,
    likedMap: Object.fromEntries(
      Object.entries(snap.likedMap || {}).map(([id, t]) => [id, withoutTransientTrackFields(t)])
    ),
    likedTimestamps: snap.likedTimestamps || {},
    playlists: (snap.playlists || []).map((pl) => ({
      ...pl,
      tracks: (pl.tracks || []).map(withoutTransientTrackFields),
    })),
    playlistUpdatedAtMs: snap.playlistUpdatedAtMs || {},
    recentlyPlayed: (snap.recentlyPlayed || []).slice(0, 20).map(withoutTransientTrackFields),
    artistAffinity: snap.artistAffinity || {},
    languageAffinity: snap.languageAffinity || {},
    genreAffinity: snap.genreAffinity || {},
    playCounts: snap.playCounts || {},
    listeningFeedback: snap.listeningFeedback || {},
    playedTracks: Object.fromEntries(
      Object.entries(snap.playedTracks || {}).map(([id, t]) => [id, withoutTransientTrackFields(t)])
    ),
    tasteResetActive: Boolean(snap.tasteResetActive),
    tasteLikedMap: Object.fromEntries(
      Object.entries(snap.tasteLikedMap || {}).map(([id, t]) => [id, withoutTransientTrackFields(t)])
    ),
    tasteRecentTracks: (snap.tasteRecentTracks || []).slice(0, 20).map(withoutTransientTrackFields),
    volume: typeof snap.volume === 'number' ? snap.volume : 85,
    quality: snap.quality || '320kbps',
    eqPreset: snap.eqPreset || 'flat',
    deletedPlaylistIds: snap.deletedPlaylistIds || {},
    deletedLikedIds: snap.deletedLikedIds || {},
    followedArtists,
    deletedFollowedArtistIds: snap.deletedFollowedArtistIds || {},
  };
}

function readJson<T>(storage: StorageLike | null, key: string): T | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(storage: StorageLike | null, key: string, value: unknown): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function summarizeSnapshot(snapshot: MusicKKLocalSnapshot) {
  const playlists = snapshot.playlists || [];
  const playlistTracks = playlists.reduce((sum, pl) => sum + (pl.tracks?.length || 0), 0);
  const likedSongs = Object.keys(snapshot.likedMap || {}).length;
  const recentPlays = (snapshot.recentlyPlayed || []).length;
  const totalPlays = Object.values(snapshot.playCounts || {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
  const followedArtists = Object.keys(snapshot.followedArtists || {}).length;
  return {
    playlists: playlists.length,
    playlistTracks,
    likedSongs,
    recentPlays,
    totalPlays,
    followedArtists,
    displayName: (snapshot.displayName || 'Listener').trim() || 'Listener',
  };
}

export function hasUserDataInSnapshot(snapshot: MusicKKLocalSnapshot): boolean {
  const summary = summarizeSnapshot(snapshot);
  if (
    summary.playlists > 0 ||
    summary.likedSongs > 0 ||
    summary.recentPlays > 0 ||
    summary.totalPlays > 0 ||
    summary.followedArtists > 0
  ) {
    return true;
  }
  const hasCustomName = Boolean(snapshot.displayName && snapshot.displayName !== 'Listener');
  const hasPrefs =
    (snapshot.preferredLanguages?.length || 0) > 0 ||
    (snapshot.favoriteArtists?.length || 0) > 0 ||
    (snapshot.preferredMoods?.length || 0) > 0;
  return hasCustomName || hasPrefs;
}

export function saveGuestSnapshot(
  snapshot: MusicKKLocalSnapshot,
  storage: StorageLike | null = getDefaultStorage()
): void {
  writeJson(storage, GUEST_SNAPSHOT_KEY, normalizeSnapshotForStorage(snapshot));
}

export function loadGuestSnapshot(
  storage: StorageLike | null = getDefaultStorage()
): MusicKKLocalSnapshot | null {
  return readJson<MusicKKLocalSnapshot>(storage, GUEST_SNAPSHOT_KEY);
}

export function saveAccountCache(
  uid: string,
  snapshot: MusicKKLocalSnapshot,
  storage: StorageLike | null = getDefaultStorage()
): void {
  if (!uid) return;
  writeJson(storage, `${ACCOUNT_CACHE_PREFIX}${uid}`, normalizeSnapshotForStorage(snapshot));
}

export function loadAccountCache(
  uid: string,
  storage: StorageLike | null = getDefaultStorage()
): MusicKKLocalSnapshot | null {
  if (!uid) return null;
  return readJson<MusicKKLocalSnapshot>(storage, `${ACCOUNT_CACHE_PREFIX}${uid}`);
}

export function hasCompletedMigration(
  uid: string,
  storage: StorageLike | null = getDefaultStorage()
): boolean {
  if (!uid || !storage) return false;
  return storage.getItem(`${MIGRATION_DONE_PREFIX}${uid}`) === 'true';
}

export function markMigrationCompleted(
  uid: string,
  storage: StorageLike | null = getDefaultStorage()
): void {
  if (!uid || !storage) return;
  try {
    storage.setItem(`${MIGRATION_DONE_PREFIX}${uid}`, 'true');
  } catch {
    // Ignore storage quota issues
  }
}

export function getLastActiveUid(
  storage: StorageLike | null = getDefaultStorage()
): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(LAST_ACTIVE_UID_KEY) || null;
  } catch {
    return null;
  }
}

export function setLastActiveUid(
  uid: string | null,
  storage: StorageLike | null = getDefaultStorage()
): void {
  if (!storage) return;
  try {
    if (uid) storage.setItem(LAST_ACTIVE_UID_KEY, uid);
    else storage.removeItem(LAST_ACTIVE_UID_KEY);
  } catch {
    // Ignore storage errors
  }
}

export function listLocalBackups(
  storage: StorageLike | null = getDefaultStorage()
): LocalBackupEntry[] {
  const entries = readJson<LocalBackupEntry[]>(storage, LOCAL_BACKUPS_KEY);
  return Array.isArray(entries) ? entries : [];
}

export function createLocalBackup(
  snapshot: MusicKKLocalSnapshot,
  reason: string,
  uid: string | null = null,
  storage: StorageLike | null = getDefaultStorage(),
  nowMs = Date.now()
): LocalBackupEntry {
  const summary = summarizeSnapshot(snapshot);
  const entry: LocalBackupEntry = {
    id: `bak_${nowMs}_${Math.random().toString(36).slice(2, 8)}`,
    createdAtMs: nowMs,
    reason,
    uid,
    summary: {
      playlists: summary.playlists,
      likedSongs: summary.likedSongs,
      recentPlays: summary.recentPlays,
      totalPlays: summary.totalPlays,
      followedArtists: summary.followedArtists,
    },
    snapshot: normalizeSnapshotForStorage(snapshot),
  };

  const existing = listLocalBackups(storage);
  const next = [entry, ...existing].slice(0, MAX_BACKUPS);
  writeJson(storage, LOCAL_BACKUPS_KEY, next);
  return entry;
}

export function restoreLocalBackup(
  backupId: string,
  storage: StorageLike | null = getDefaultStorage()
): MusicKKLocalSnapshot | null {
  const entries = listLocalBackups(storage);
  const match = entries.find((item) => item.id === backupId);
  if (!match) return null;
  return normalizeSnapshotForStorage(match.snapshot);
}

function playlistIdentityKey(playlist: CuratedPlaylist): string {
  const nameKey = (playlist.name || '').trim().toLowerCase();
  const sourceKey = (playlist.sourcePageUrl || '').trim().toLowerCase();
  return `${nameKey}::${sourceKey}`;
}

export function computeMigrationDiff(
  local: MusicKKLocalSnapshot,
  cloud: MusicKKLocalSnapshot | null
): MigrationDiff {
  const cloudSnap = cloud || createEmptySnapshot();
  const localSummary = summarizeSnapshot(local);
  const cloudSummary = summarizeSnapshot(cloudSnap);

  const cloudPlaylistById = new Map((cloudSnap.playlists || []).map((pl) => [pl.id, pl]));
  const cloudPlaylistBySig = new Map(
    (cloudSnap.playlists || []).map((pl) => [playlistIdentityKey(pl), pl])
  );

  const overlappingPlaylists: string[] = [];
  let localOnlyPlaylists = 0;
  for (const pl of local.playlists || []) {
    const matched = cloudPlaylistById.get(pl.id) || cloudPlaylistBySig.get(playlistIdentityKey(pl));
    if (matched) overlappingPlaylists.push(pl.name);
    else localOnlyPlaylists += 1;
  }

  const localPlaylistIds = new Set((local.playlists || []).map((pl) => pl.id));
  const localPlaylistSigs = new Set((local.playlists || []).map(playlistIdentityKey));
  let cloudOnlyPlaylists = 0;
  for (const pl of cloudSnap.playlists || []) {
    if (!localPlaylistIds.has(pl.id) && !localPlaylistSigs.has(playlistIdentityKey(pl))) {
      cloudOnlyPlaylists += 1;
    }
  }

  const localLikedIds = Object.keys(local.likedMap || {});
  const cloudLikedMap = cloudSnap.likedMap || {};
  const overlappingLikedCount = localLikedIds.filter((id) => Boolean(cloudLikedMap[id])).length;

  const localHasData = hasUserDataInSnapshot(local);
  const cloudHasData = hasUserDataInSnapshot(cloudSnap);

  // Prompt user before merging whenever local data exists on first sign-in or
  // when cloud already has data and local isn't empty.
  const needsPreview = localHasData || (localHasData && cloudHasData);

  return {
    needsPreview,
    localSummary,
    cloudSummary,
    overlappingPlaylists,
    overlappingLikedCount,
    localOnlyPlaylists,
    cloudOnlyPlaylists,
  };
}

/**
 * Merges playlist track arrays while preserving the primary playlist's exact ordering
 * and intentional duplicates, while appending only genuine extra occurrences from secondary.
 */
export function mergePlaylistEntriesPreservingOrderAndDuplicates(
  primaryTracks: Track[],
  secondaryTracks: Track[]
): Track[] {
  const result = primaryTracks.map(withoutTransientTrackFields);
  const primaryCounts = new Map<string, number>();
  for (const t of result) {
    primaryCounts.set(t.id, (primaryCounts.get(t.id) || 0) + 1);
  }

  const seenSecondary = new Map<string, number>();
  for (const t of secondaryTracks) {
    const clean = withoutTransientTrackFields(t);
    const prevSeen = seenSecondary.get(clean.id) || 0;
    const nextSeen = prevSeen + 1;
    seenSecondary.set(clean.id, nextSeen);
    const inPrimary = primaryCounts.get(clean.id) || 0;
    if (nextSeen > inPrimary) {
      result.push(clean);
    }
  }

  return result;
}

function mergeStringArraysUnique<T extends string>(primary: T[] = [], secondary: T[] = []): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of [...primary, ...secondary]) {
    const clean = item.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function mergeNumberMapsMax(
  a: Record<string, number> = {},
  b: Record<string, number> = {}
): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    out[k] = Math.max(out[k] || 0, v);
  }
  return out;
}

export function mergeMusicSnapshots(
  local: MusicKKLocalSnapshot,
  cloud: MusicKKLocalSnapshot | null,
  options: { mode?: 'merge' | 'cloud-only' | 'local-only'; nowMs?: number } = {}
): MusicKKLocalSnapshot {
  const mode = options.mode || 'merge';
  const nowMs = options.nowMs || Date.now();
  const cloudSnap = cloud || createEmptySnapshot();

  if (mode === 'cloud-only') {
    return normalizeSnapshotForStorage({ ...cloudSnap, updatedAtMs: nowMs });
  }
  if (mode === 'local-only') {
    return normalizeSnapshotForStorage({ ...local, updatedAtMs: nowMs });
  }

  const localUpdated = local.updatedAtMs || 0;
  const cloudUpdated = cloudSnap.updatedAtMs || 0;
  const preferCloudScalar = cloudUpdated > localUpdated;

  const deletedPlaylists = mergeNumberMapsMax(
    local.deletedPlaylistIds,
    cloudSnap.deletedPlaylistIds
  );
  const deletedLiked = mergeNumberMapsMax(
    local.deletedLikedIds,
    cloudSnap.deletedLikedIds
  );
  const deletedFollowedArtists = mergeNumberMapsMax(
    local.deletedFollowedArtistIds,
    cloudSnap.deletedFollowedArtistIds
  );

  // Playlists: merge by exact id first, then normalized (name + sourcePageUrl) to prevent duplicates
  const mergedPlaylists: CuratedPlaylist[] = [];
  const mergedById = new Map<string, number>();
  const mergedBySig = new Map<string, number>();
  const playlistUpdatedAtMs: Record<string, number> = {};

  const localPlUpdated = local.playlistUpdatedAtMs || {};
  const cloudPlUpdated = cloudSnap.playlistUpdatedAtMs || {};

  const primaryList = preferCloudScalar ? (cloudSnap.playlists || []) : (local.playlists || []);
  const secondaryList = preferCloudScalar ? (local.playlists || []) : (cloudSnap.playlists || []);

  const isDeletedPlaylist = (pl: CuratedPlaylist, plUpdatedAt: number): boolean => {
    const deletedAt = deletedPlaylists[pl.id] || 0;
    return deletedAt > 0 && deletedAt > plUpdatedAt;
  };

  for (const pl of primaryList) {
    const plTs = preferCloudScalar
      ? (cloudPlUpdated[pl.id] || cloudUpdated)
      : (localPlUpdated[pl.id] || localUpdated);
    if (isDeletedPlaylist(pl, plTs)) continue;
    const sig = playlistIdentityKey(pl);
    if (mergedById.has(pl.id) || mergedBySig.has(sig)) continue;
    const idx = mergedPlaylists.length;
    mergedPlaylists.push({
      ...pl,
      tracks: (pl.tracks || []).map(withoutTransientTrackFields),
    });
    mergedById.set(pl.id, idx);
    mergedBySig.set(sig, idx);
    playlistUpdatedAtMs[pl.id] = plTs || nowMs;
  }

  for (const pl of secondaryList) {
    const plTs = preferCloudScalar
      ? (localPlUpdated[pl.id] || localUpdated)
      : (cloudPlUpdated[pl.id] || cloudUpdated);
    if (isDeletedPlaylist(pl, plTs)) continue;
    const sig = playlistIdentityKey(pl);
    const existingIdx = mergedById.get(pl.id) ?? mergedBySig.get(sig);
    if (existingIdx !== undefined) {
      const primaryPl = mergedPlaylists[existingIdx];
      const existingTs = playlistUpdatedAtMs[primaryPl.id] || 0;
      const primaryFirst = existingTs >= plTs;
      const mergedTracks = mergePlaylistEntriesPreservingOrderAndDuplicates(
        primaryFirst ? primaryPl.tracks : pl.tracks || [],
        primaryFirst ? pl.tracks || [] : primaryPl.tracks
      );
      mergedPlaylists[existingIdx] = {
        ...primaryPl,
        tracks: mergedTracks,
        image: primaryPl.image || pl.image,
        description: primaryPl.description || pl.description,
      };
      playlistUpdatedAtMs[primaryPl.id] = Math.max(existingTs, plTs, nowMs);
      continue;
    }
    const idx = mergedPlaylists.length;
    mergedPlaylists.push({
      ...pl,
      tracks: (pl.tracks || []).map(withoutTransientTrackFields),
    });
    mergedById.set(pl.id, idx);
    mergedBySig.set(sig, idx);
    playlistUpdatedAtMs[pl.id] = plTs || nowMs;
  }

  // Liked Songs: union both, respecting newer tombstones & preventing duplicates
  const likedMap: Record<string, Track> = {};
  const likedTimestamps: Record<string, number> = {};
  const allLikedIds = new Set([
    ...Object.keys(local.likedMap || {}),
    ...Object.keys(cloudSnap.likedMap || {}),
  ]);
  for (const id of allLikedIds) {
    const localTrack = local.likedMap?.[id];
    const cloudTrack = cloudSnap.likedMap?.[id];
    const localLikedAt = local.likedTimestamps?.[id] || localUpdated || 1;
    const cloudLikedAt = cloudSnap.likedTimestamps?.[id] || cloudUpdated || 1;
    const effectiveTs = Math.max(localTrack ? localLikedAt : 0, cloudTrack ? cloudLikedAt : 0);
    const deletedAt = deletedLiked[id] || 0;
    if (deletedAt > effectiveTs) continue;
    const chosen = preferCloudScalar ? (cloudTrack || localTrack) : (localTrack || cloudTrack);
    if (chosen) {
      likedMap[id] = withoutTransientTrackFields(chosen);
      likedTimestamps[id] = effectiveTs;
    }
  }

  // Recently Played: interleave newer side first, deduplicate by track ID, cap at 20
  const recentOrder = preferCloudScalar
    ? [...(cloudSnap.recentlyPlayed || []), ...(local.recentlyPlayed || [])]
    : [...(local.recentlyPlayed || []), ...(cloudSnap.recentlyPlayed || [])];
  const seenRecent = new Set<string>();
  const recentlyPlayed: Track[] = [];
  for (const t of recentOrder) {
    if (!t?.id || seenRecent.has(t.id)) continue;
    seenRecent.add(t.id);
    recentlyPlayed.push(withoutTransientTrackFields(t));
    if (recentlyPlayed.length >= 20) break;
  }

  // Play counts & feedback: take max so progress is never lost
  const playCounts = mergeNumberMapsMax(local.playCounts, cloudSnap.playCounts);
  const allFeedbackIds = new Set([
    ...Object.keys(local.listeningFeedback || {}),
    ...Object.keys(cloudSnap.listeningFeedback || {}),
  ]);
  const listeningFeedback: Record<string, { skips: number; completions: number }> = {};
  for (const id of allFeedbackIds) {
    const a = local.listeningFeedback?.[id];
    const b = cloudSnap.listeningFeedback?.[id];
    listeningFeedback[id] = {
      skips: Math.max(a?.skips || 0, b?.skips || 0),
      completions: Math.max(a?.completions || 0, b?.completions || 0),
    };
  }

  const playedTracks: Record<string, Track> = {};
  for (const [id, t] of Object.entries({ ...(cloudSnap.playedTracks || {}), ...(local.playedTracks || {}) })) {
    playedTracks[id] = withoutTransientTrackFields(t);
  }

  const tasteResetActive = preferCloudScalar
    ? Boolean(cloudSnap.tasteResetActive)
    : Boolean(local.tasteResetActive);

  const displayNameCandidate = preferCloudScalar
    ? (cloudSnap.displayName && cloudSnap.displayName !== 'Listener'
        ? cloudSnap.displayName
        : local.displayName || 'Listener')
    : (local.displayName && local.displayName !== 'Listener'
        ? local.displayName
        : cloudSnap.displayName || 'Listener');

  return normalizeSnapshotForStorage({
    schemaVersion: SCHEMA_VERSION,
    updatedAtMs: nowMs,
    displayName: displayNameCandidate,
    region: preferCloudScalar ? (cloudSnap.region || local.region || 'IN') : (local.region || cloudSnap.region || 'IN'),
    preferredLanguages: mergeStringArraysUnique(
      preferCloudScalar ? cloudSnap.preferredLanguages : local.preferredLanguages,
      preferCloudScalar ? local.preferredLanguages : cloudSnap.preferredLanguages
    ),
    favoriteArtists: mergeStringArraysUnique(
      preferCloudScalar ? cloudSnap.favoriteArtists : local.favoriteArtists,
      preferCloudScalar ? local.favoriteArtists : cloudSnap.favoriteArtists
    ).slice(0, 50),
    preferredMoods: mergeStringArraysUnique(
      preferCloudScalar ? cloudSnap.preferredMoods : local.preferredMoods,
      preferCloudScalar ? local.preferredMoods : cloudSnap.preferredMoods
    ).slice(0, 20),
    prioritizeLyrics: preferCloudScalar
      ? (typeof cloudSnap.prioritizeLyrics === 'boolean' ? cloudSnap.prioritizeLyrics : Boolean(local.prioritizeLyrics ?? true))
      : (typeof local.prioritizeLyrics === 'boolean' ? local.prioritizeLyrics : Boolean(cloudSnap.prioritizeLyrics ?? true)),
    likedMap,
    likedTimestamps,
    playlists: mergedPlaylists,
    playlistUpdatedAtMs,
    recentlyPlayed,
    artistAffinity: tasteResetActive
      ? (preferCloudScalar ? (cloudSnap.artistAffinity || {}) : (local.artistAffinity || {}))
      : mergeNumberMapsMax(local.artistAffinity, cloudSnap.artistAffinity),
    languageAffinity: tasteResetActive
      ? (preferCloudScalar ? (cloudSnap.languageAffinity || {}) : (local.languageAffinity || {}))
      : mergeNumberMapsMax(local.languageAffinity, cloudSnap.languageAffinity),
    genreAffinity: tasteResetActive
      ? (preferCloudScalar ? (cloudSnap.genreAffinity || {}) : (local.genreAffinity || {}))
      : mergeNumberMapsMax(local.genreAffinity, cloudSnap.genreAffinity),
    playCounts,
    listeningFeedback,
    playedTracks,
    tasteResetActive,
    tasteLikedMap: preferCloudScalar ? (cloudSnap.tasteLikedMap || {}) : (local.tasteLikedMap || {}),
    tasteRecentTracks: preferCloudScalar ? (cloudSnap.tasteRecentTracks || []) : (local.tasteRecentTracks || []),
    volume: preferCloudScalar ? (cloudSnap.volume ?? local.volume ?? 85) : (local.volume ?? cloudSnap.volume ?? 85),
    quality: preferCloudScalar ? (cloudSnap.quality || local.quality || '320kbps') : (local.quality || cloudSnap.quality || '320kbps'),
    eqPreset: preferCloudScalar ? (cloudSnap.eqPreset || local.eqPreset || 'flat') : (local.eqPreset || cloudSnap.eqPreset || 'flat'),
    deletedPlaylistIds: deletedPlaylists,
    deletedLikedIds: deletedLiked,
    followedArtists: (() => {
      const mergedFollowed: Record<string, FollowedArtist> = {};
      const seenArtistName = new Map<string, string>();
      const orderedEntries = preferCloudScalar
        ? [
            ...Object.entries(cloudSnap.followedArtists || {}),
            ...Object.entries(local.followedArtists || {}),
          ]
        : [
            ...Object.entries(local.followedArtists || {}),
            ...Object.entries(cloudSnap.followedArtists || {}),
          ];
      for (const [key, artist] of orderedEntries) {
        if (!artist || !artist.name) continue;
        const nameKey = artist.name.trim().toLowerCase();
        const artistTs = artist.followedAtMs || (preferCloudScalar ? cloudUpdated : localUpdated) || 1;
        const deletedAt = Math.max(
          deletedFollowedArtists[key] || 0,
          deletedFollowedArtists[artist.id] || 0,
          nameKey ? deletedFollowedArtists[`name:${nameKey}`] || 0 : 0
        );
        if (deletedAt > artistTs) continue;
        if (nameKey && seenArtistName.has(nameKey)) continue;
        if (nameKey) seenArtistName.set(nameKey, key);
        mergedFollowed[key] = sanitizeFollowedArtistForCloud(artist, key);
      }
      return mergedFollowed;
    })(),
    deletedFollowedArtistIds: deletedFollowedArtists,
  });
}

// Durable Sync Queue with exponential backoff
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000, 180_000, 300_000];

export function getSyncQueue(
  uid: string,
  storage: StorageLike | null = getDefaultStorage()
): SyncQueueItem[] {
  if (!uid) return [];
  const list = readJson<SyncQueueItem[]>(storage, `${SYNC_QUEUE_PREFIX}${uid}`);
  return Array.isArray(list) ? list : [];
}

export function enqueueSyncTask(
  uid: string,
  reason: string,
  storage: StorageLike | null = getDefaultStorage(),
  nowMs = Date.now()
): SyncQueueItem[] {
  if (!uid) return [];
  const existing = getSyncQueue(uid, storage);
  // Coalesce pending snapshot sync tasks for the same user into one durable entry
  const current = existing[0];
  const nextItem: SyncQueueItem = current
    ? {
        ...current,
        reason,
        updatedAtMs: nowMs,
        nextAttemptAtMs: nowMs,
      }
    : {
        id: `sync_${nowMs}_${Math.random().toString(36).slice(2, 7)}`,
        uid,
        reason,
        createdAtMs: nowMs,
        updatedAtMs: nowMs,
        attempts: 0,
        nextAttemptAtMs: nowMs,
      };
  const next = [nextItem];
  writeJson(storage, `${SYNC_QUEUE_PREFIX}${uid}`, next);
  return next;
}

export function markSyncSuccess(
  uid: string,
  storage: StorageLike | null = getDefaultStorage()
): void {
  if (!uid || !storage) return;
  try {
    storage.removeItem(`${SYNC_QUEUE_PREFIX}${uid}`);
  } catch {
    // Ignore storage errors
  }
}

export function markSyncFailure(
  uid: string,
  errorMessage: string,
  storage: StorageLike | null = getDefaultStorage(),
  nowMs = Date.now()
): SyncQueueItem | null {
  if (!uid) return null;
  const existing = getSyncQueue(uid, storage);
  const current = existing[0] || {
    id: `sync_${nowMs}`,
    uid,
    reason: 'retry',
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    attempts: 0,
    nextAttemptAtMs: nowMs,
  };
  const attempts = current.attempts + 1;
  const delayMs = RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)];
  const updated: SyncQueueItem = {
    ...current,
    attempts,
    updatedAtMs: nowMs,
    nextAttemptAtMs: nowMs + delayMs,
    lastError: errorMessage,
  };
  writeJson(storage, `${SYNC_QUEUE_PREFIX}${uid}`, [updated]);
  return updated;
}

export function hasDueSyncTask(
  uid: string,
  storage: StorageLike | null = getDefaultStorage(),
  nowMs = Date.now()
): boolean {
  const queue = getSyncQueue(uid, storage);
  return queue.some((item) => item.nextAttemptAtMs <= nowMs);
}
