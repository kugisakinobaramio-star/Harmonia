import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentReference,
  type Timestamp,
} from 'firebase/firestore';
import type { CuratedPlaylist, MusicLanguage, Track } from '../types/music';
import {
  clampString,
  restoreFollowedArtistFromCloud,
  restoreTrackFromCloud,
  sanitizeAffinityMap,
  sanitizeEqPreset,
  sanitizeFeedbackMap,
  sanitizeFollowedArtistForCloud,
  sanitizeImageOrUrl,
  sanitizePlaylistMetaForCloud,
  sanitizeQuality,
  sanitizeRegion,
  sanitizeStringList,
  sanitizeTrackForCloud,
  SCHEMA_VERSION,
  toFirestoreDocId,
} from './cloudSanitizer';
import { auth, db } from './firebase';
import {
  handleFirestoreError,
  isPermissionDeniedError,
  OperationType,
} from './firebaseErrors';
import {
  createEmptySnapshot,
  normalizeSnapshotForStorage,
  type MusicKKLocalSnapshot,
} from './syncEngine';

export interface CloudReadMetadata {
  createdAtByPath: Map<string, Timestamp>;
  playlistDocIds: Set<string>;
  playlistEntryDocIds: Map<string, Set<string>>;
  likedDocIds: Set<string>;
  recentDocIds: Set<string>;
  playedTrackDocIds: Set<string>;
  followedArtistDocIds: Set<string>;
  hasTasteDoc: boolean;
}

export interface CloudSnapshotResult {
  exists: boolean;
  snapshot: MusicKKLocalSnapshot;
  meta: CloudReadMetadata;
}

function emptyMeta(): CloudReadMetadata {
  return {
    createdAtByPath: new Map(),
    playlistDocIds: new Set(),
    playlistEntryDocIds: new Map(),
    likedDocIds: new Set(),
    recentDocIds: new Set(),
    playedTrackDocIds: new Set(),
    followedArtistDocIds: new Set(),
    hasTasteDoc: false,
  };
}

function recordCreatedAt(meta: CloudReadMetadata, path: string, data: Record<string, unknown>) {
  if (data.createdAt && typeof data.createdAt === 'object') {
    meta.createdAtByPath.set(path, data.createdAt as Timestamp);
  }
}

export async function fetchCloudSnapshot(uid: string): Promise<CloudSnapshotResult> {
  const meta = emptyMeta();
  const baseSnap = createEmptySnapshot();
  const userPath = `users/${uid}`;
  const currentUser = auth.currentUser;

  let userSnap;
  try {
    userSnap = await getDoc(doc(db, 'users', uid));
  } catch (err) {
    if (isPermissionDeniedError(err)) {
      handleFirestoreError(err, OperationType.GET, userPath, currentUser);
    }
    throw err;
  }

  const userData = userSnap.exists() ? (userSnap.data() as Record<string, unknown>) : null;
  if (userData) {
    recordCreatedAt(meta, userPath, userData);
    baseSnap.displayName = clampString(userData.displayName, 100, 'Listener');
    baseSnap.region = sanitizeRegion(userData.region);
    baseSnap.preferredLanguages = sanitizeStringList(userData.preferredLanguages, 30, 40) as MusicLanguage[];
    baseSnap.favoriteArtists = sanitizeStringList(userData.favoriteArtists, 50, 120);
    baseSnap.preferredMoods = sanitizeStringList(userData.preferredMoods, 20, 120);
    baseSnap.prioritizeLyrics =
      typeof userData.prioritizeLyrics === 'boolean' ? userData.prioritizeLyrics : true;
    baseSnap.volume =
      typeof userData.volume === 'number' && Number.isFinite(userData.volume)
        ? Math.max(0, Math.min(100, userData.volume))
        : 85;
    baseSnap.quality = sanitizeQuality(userData.quality);
    baseSnap.eqPreset = sanitizeEqPreset(userData.eqPreset);
    baseSnap.tasteResetActive = Boolean(userData.tasteResetActive);
  }

  // Playlists
  const playlistsPath = `${userPath}/playlists`;
  let playlistSnaps;
  try {
    playlistSnaps = await getDocs(query(collection(db, 'users', uid, 'playlists'), where('uid', '==', uid)));
  } catch (err) {
    if (isPermissionDeniedError(err)) {
      handleFirestoreError(err, OperationType.LIST, playlistsPath, currentUser);
    }
    throw err;
  }

  const playlistEntriesRaw: Array<{
    orderIndex: number;
    updatedAtMs: number;
    playlist: CuratedPlaylist;
  }> = [];

  for (const plDoc of playlistSnaps.docs) {
    const data = plDoc.data() as Record<string, unknown>;
    const plPath = `${playlistsPath}/${plDoc.id}`;
    meta.playlistDocIds.add(plDoc.id);
    recordCreatedAt(meta, plPath, data);

    const entriesPath = `${plPath}/entries`;
    let entrySnaps;
    try {
      entrySnaps = await getDocs(
        query(collection(db, 'users', uid, 'playlists', plDoc.id, 'entries'), where('uid', '==', uid))
      );
    } catch (err) {
      if (isPermissionDeniedError(err)) {
        handleFirestoreError(err, OperationType.LIST, entriesPath, currentUser);
      }
      throw err;
    }

    const entrySet = new Set<string>();
    meta.playlistEntryDocIds.set(plDoc.id, entrySet);

    const orderedEntries: Array<{ position: number; track: Track }> = [];
    for (const entryDoc of entrySnaps.docs) {
      const eData = entryDoc.data() as Record<string, unknown>;
      entrySet.add(entryDoc.id);
      recordCreatedAt(meta, `${entriesPath}/${entryDoc.id}`, eData);
      const track = restoreTrackFromCloud(eData.track);
      if (!track) continue;
      orderedEntries.push({
        position: typeof eData.position === 'number' ? eData.position : 0,
        track,
      });
    }
    orderedEntries.sort((a, b) => a.position - b.position);

    const playlistId = clampString(data.id, 160, plDoc.id);
    const updatedAtMs = typeof data.updatedAtMs === 'number' ? data.updatedAtMs : 0;
    baseSnap.playlistUpdatedAtMs![playlistId] = updatedAtMs;

    playlistEntriesRaw.push({
      orderIndex: typeof data.orderIndex === 'number' ? data.orderIndex : playlistEntriesRaw.length,
      updatedAtMs,
      playlist: {
        id: playlistId,
        name: clampString(data.name, 120, 'Playlist'),
        description: clampString(data.description, 300, ''),
        image: sanitizeImageOrUrl(data.image, 500),
        language: (clampString(data.language, 40, 'Mixed') || 'Mixed') as CuratedPlaylist['language'],
        region: data.region ? sanitizeRegion(data.region) : undefined,
        isUserCreated: typeof data.isUserCreated === 'boolean' ? data.isUserCreated : true,
        sourcePageUrl: sanitizeImageOrUrl(data.sourcePageUrl, 500) || undefined,
        tracks: orderedEntries.map((item) => item.track),
      },
    });
  }

  playlistEntriesRaw.sort((a, b) => a.orderIndex - b.orderIndex);
  baseSnap.playlists = playlistEntriesRaw.map((item) => item.playlist);

  // Liked Songs
  const likedPath = `${userPath}/likedSongs`;
  let likedSnaps;
  try {
    likedSnaps = await getDocs(query(collection(db, 'users', uid, 'likedSongs'), where('uid', '==', uid)));
  } catch (err) {
    if (isPermissionDeniedError(err)) {
      handleFirestoreError(err, OperationType.LIST, likedPath, currentUser);
    }
    throw err;
  }

  const likedItems: Array<{ likedAtMs: number; track: Track }> = [];
  for (const docSnap of likedSnaps.docs) {
    const data = docSnap.data() as Record<string, unknown>;
    meta.likedDocIds.add(docSnap.id);
    recordCreatedAt(meta, `${likedPath}/${docSnap.id}`, data);
    const track = restoreTrackFromCloud(data.track);
    if (!track) continue;
    likedItems.push({
      likedAtMs: typeof data.likedAtMs === 'number' ? data.likedAtMs : 0,
      track,
    });
  }
  likedItems.sort((a, b) => b.likedAtMs - a.likedAtMs);
  for (const item of likedItems) {
    baseSnap.likedMap![item.track.id] = item.track;
    baseSnap.likedTimestamps![item.track.id] = item.likedAtMs;
  }

  // Recently Played
  const recentPath = `${userPath}/recentHistory`;
  let recentSnaps;
  try {
    recentSnaps = await getDocs(
      query(collection(db, 'users', uid, 'recentHistory'), where('uid', '==', uid))
    );
  } catch (err) {
    if (isPermissionDeniedError(err)) {
      handleFirestoreError(err, OperationType.LIST, recentPath, currentUser);
    }
    throw err;
  }

  const recentItems: Array<{ position: number; track: Track }> = [];
  for (const docSnap of recentSnaps.docs) {
    const data = docSnap.data() as Record<string, unknown>;
    meta.recentDocIds.add(docSnap.id);
    recordCreatedAt(meta, `${recentPath}/${docSnap.id}`, data);
    const track = restoreTrackFromCloud(data.track);
    if (!track) continue;
    recentItems.push({
      position: typeof data.position === 'number' ? data.position : 0,
      track,
    });
  }
  recentItems.sort((a, b) => a.position - b.position);
  baseSnap.recentlyPlayed = recentItems.slice(0, 20).map((item) => item.track);

  // Per-track stats
  const playedPath = `${userPath}/playedTracks`;
  let playedSnaps;
  try {
    playedSnaps = await getDocs(
      query(collection(db, 'users', uid, 'playedTracks'), where('uid', '==', uid))
    );
  } catch (err) {
    if (isPermissionDeniedError(err)) {
      handleFirestoreError(err, OperationType.LIST, playedPath, currentUser);
    }
    throw err;
  }

  for (const docSnap of playedSnaps.docs) {
    const data = docSnap.data() as Record<string, unknown>;
    meta.playedTrackDocIds.add(docSnap.id);
    recordCreatedAt(meta, `${playedPath}/${docSnap.id}`, data);
    const track = restoreTrackFromCloud(data.track);
    if (track) {
      baseSnap.playedTracks![track.id] = track;
    }
    const id = clampString(data.id, 160, track?.id || '');
    if (id && typeof data.playCount === 'number' && data.playCount > 0) {
      baseSnap.playCounts![id] = data.playCount;
    }
    const skips = typeof data.skips === 'number' ? data.skips : 0;
    const completions = typeof data.completions === 'number' ? data.completions : 0;
    if (id && (skips > 0 || completions > 0)) {
      baseSnap.listeningFeedback![id] = { skips, completions };
    }
  }

  // Taste summary
  const tastePath = `${userPath}/tasteStats/summary`;
  let tasteSnap;
  try {
    tasteSnap = await getDoc(doc(db, 'users', uid, 'tasteStats', 'summary'));
  } catch (err) {
    if (isPermissionDeniedError(err)) {
      handleFirestoreError(err, OperationType.GET, tastePath, currentUser);
    }
    throw err;
  }

  let updatedAtMs = 0;
  if (tasteSnap.exists()) {
    meta.hasTasteDoc = true;
    const tData = tasteSnap.data() as Record<string, unknown>;
    recordCreatedAt(meta, tastePath, tData);
    if (tData.artistAffinity && typeof tData.artistAffinity === 'object') {
      baseSnap.artistAffinity = tData.artistAffinity as Record<string, number>;
    }
    if (tData.languageAffinity && typeof tData.languageAffinity === 'object') {
      baseSnap.languageAffinity = tData.languageAffinity as Record<string, number>;
    }
    if (tData.genreAffinity && typeof tData.genreAffinity === 'object') {
      baseSnap.genreAffinity = tData.genreAffinity as Record<string, number>;
    }
    if (tData.playCounts && typeof tData.playCounts === 'object') {
      baseSnap.playCounts = {
        ...(tData.playCounts as Record<string, number>),
        ...(baseSnap.playCounts || {}),
      };
    }
    if (tData.listeningFeedback && typeof tData.listeningFeedback === 'object') {
      baseSnap.listeningFeedback = {
        ...(tData.listeningFeedback as Record<string, { skips: number; completions: number }>),
        ...(baseSnap.listeningFeedback || {}),
      };
    }
    if (typeof tData.tasteResetActive === 'boolean') {
      baseSnap.tasteResetActive = tData.tasteResetActive;
    }
    if (typeof tData.updatedAtMs === 'number') {
      updatedAtMs = tData.updatedAtMs;
    }
  }

  // Followed Artists
  const followedPath = `${userPath}/followedArtists`;
  try {
    const followedSnaps = await getDocs(
      query(collection(db, 'users', uid, 'followedArtists'), where('uid', '==', uid))
    );
    for (const docSnap of followedSnaps.docs) {
      const data = docSnap.data() as Record<string, unknown>;
      meta.followedArtistDocIds.add(docSnap.id);
      recordCreatedAt(meta, `${followedPath}/${docSnap.id}`, data);
      const artist = restoreFollowedArtistFromCloud(data);
      if (artist) {
        baseSnap.followedArtists![artist.id] = artist;
      }
    }
  } catch (err) {
    // Allow legacy deployed Firestore rules without followedArtists match to keep core sync working
    if (isPermissionDeniedError(err)) {
      console.warn('[Firestore] followedArtists read skipped (publish updated firestore.rules to sync followed artists).');
    } else {
      throw err;
    }
  }

  const maxPlaylistTs = Object.values(baseSnap.playlistUpdatedAtMs || {}).reduce((m, v) => Math.max(m, v), 0);
  const maxLikedTs = Object.values(baseSnap.likedTimestamps || {}).reduce((m, v) => Math.max(m, v), 0);
  const maxFollowedTs = Object.values(baseSnap.followedArtists || {}).reduce((m, a) => Math.max(m, a.followedAtMs || 0), 0);
  baseSnap.updatedAtMs = Math.max(updatedAtMs, maxPlaylistTs, maxLikedTs, maxFollowedTs);
  const exists = Boolean(
    userData ||
      meta.playlistDocIds.size > 0 ||
      meta.likedDocIds.size > 0 ||
      meta.recentDocIds.size > 0 ||
      meta.playedTrackDocIds.size > 0 ||
      meta.followedArtistDocIds.size > 0 ||
      meta.hasTasteDoc
  );

  return {
    exists,
    snapshot: normalizeSnapshotForStorage(baseSnap),
    meta,
  };
}

interface PendingBatchOp {
  type: 'set' | 'delete';
  ref: DocumentReference;
  data?: Record<string, unknown>;
}

async function commitInChunks(
  ops: PendingBatchOp[],
  uid: string
): Promise<void> {
  const MAX_BATCH_OPS = 380;
  for (let i = 0; i < ops.length; i += MAX_BATCH_OPS) {
    const slice = ops.slice(i, i + MAX_BATCH_OPS);
    const batch = writeBatch(db);
    for (const op of slice) {
      if (op.type === 'set' && op.data) {
        batch.set(op.ref, op.data);
      } else if (op.type === 'delete') {
        batch.delete(op.ref);
      }
    }
    try {
      await batch.commit();
    } catch (err) {
      if (isPermissionDeniedError(err)) {
        handleFirestoreError(err, OperationType.WRITE, `users/${uid}`, auth.currentUser);
      }
      throw err;
    }
  }
}

export async function pushCloudSnapshot(
  uid: string,
  rawSnapshot: MusicKKLocalSnapshot,
  knownMeta?: CloudReadMetadata,
  authIdentity?: { email?: string | null; photoURL?: string | null; displayName?: string | null }
): Promise<CloudReadMetadata> {
  const snapshot = normalizeSnapshotForStorage(rawSnapshot);
  const meta = knownMeta || (await fetchCloudSnapshot(uid)).meta;
  const nowMs = snapshot.updatedAtMs || Date.now();
  const userPath = `users/${uid}`;

  const withTimestamps = (path: string, payload: Record<string, unknown>) => {
    const existingCreated = meta.createdAtByPath.get(path);
    return {
      ...payload,
      createdAt: existingCreated || serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
  };

  // Stage 1: Root user profile + playlist parent documents (must commit before child entries/subcollections)
  const stage1Ops: PendingBatchOp[] = [];
  const profilePayload: Record<string, unknown> = {
    uid,
    schemaVersion: SCHEMA_VERSION,
    displayName: clampString(
      snapshot.displayName || authIdentity?.displayName,
      100,
      'Listener'
    ),
    region: sanitizeRegion(snapshot.region),
    preferredLanguages: sanitizeStringList(snapshot.preferredLanguages, 30, 40),
    favoriteArtists: sanitizeStringList(snapshot.favoriteArtists, 50, 120),
    preferredMoods: sanitizeStringList(snapshot.preferredMoods, 20, 120),
    prioritizeLyrics: Boolean(snapshot.prioritizeLyrics ?? true),
    volume: typeof snapshot.volume === 'number' ? Math.max(0, Math.min(100, snapshot.volume)) : 85,
    quality: sanitizeQuality(snapshot.quality),
    eqPreset: sanitizeEqPreset(snapshot.eqPreset),
    tasteResetActive: Boolean(snapshot.tasteResetActive),
    lastSyncDevice: 'MusicKK Client',
  };
  const cleanEmail = clampString(authIdentity?.email, 200, '');
  if (cleanEmail) profilePayload.email = cleanEmail;
  const cleanPhoto = sanitizeImageOrUrl(authIdentity?.photoURL, 500);
  if (cleanPhoto) profilePayload.photoURL = cleanPhoto;

  stage1Ops.push({
    type: 'set',
    ref: doc(db, 'users', uid),
    data: withTimestamps(userPath, profilePayload),
  });

  const stage2Ops: PendingBatchOp[] = [];
  const nextPlaylistDocIds = new Set<string>();

  const playlists = (snapshot.playlists || []).slice(0, 500);
  playlists.forEach((pl, orderIndex) => {
    const plDocId = toFirestoreDocId(pl.id);
    nextPlaylistDocIds.add(plDocId);
    const plPath = `${userPath}/playlists/${plDocId}`;
    const plUpdatedMs = snapshot.playlistUpdatedAtMs?.[pl.id] || nowMs;
    const plMetaPayload = sanitizePlaylistMetaForCloud(pl, uid, orderIndex, plUpdatedMs);

    stage1Ops.push({
      type: 'set',
      ref: doc(db, 'users', uid, 'playlists', plDocId),
      data: withTimestamps(plPath, plMetaPayload),
    });

    const prevEntryIds = meta.playlistEntryDocIds.get(plDocId) || new Set<string>();
    const nextEntryIds = new Set<string>();
    (pl.tracks || []).slice(0, 5000).forEach((track, position) => {
      const entryId = toFirestoreDocId(`e_${position}_${track.id}`);
      nextEntryIds.add(entryId);
      const entryPath = `${plPath}/entries/${entryId}`;
      stage2Ops.push({
        type: 'set',
        ref: doc(db, 'users', uid, 'playlists', plDocId, 'entries', entryId),
        data: withTimestamps(entryPath, {
          uid,
          entryId,
          playlistId: clampString(pl.id, 160, plDocId),
          position,
          schemaVersion: SCHEMA_VERSION,
          track: sanitizeTrackForCloud(track),
          addedAtMs: plUpdatedMs,
        }),
      });
    });

    for (const oldEntryId of prevEntryIds) {
      if (!nextEntryIds.has(oldEntryId)) {
        stage2Ops.push({
          type: 'delete',
          ref: doc(db, 'users', uid, 'playlists', plDocId, 'entries', oldEntryId),
        });
      }
    }
  });

  // Delete entries & playlist docs for removed playlists
  for (const oldPlDocId of meta.playlistDocIds) {
    if (!nextPlaylistDocIds.has(oldPlDocId)) {
      const oldEntries = meta.playlistEntryDocIds.get(oldPlDocId) || new Set<string>();
      for (const oldEntryId of oldEntries) {
        stage2Ops.push({
          type: 'delete',
          ref: doc(db, 'users', uid, 'playlists', oldPlDocId, 'entries', oldEntryId),
        });
      }
      stage2Ops.push({
        type: 'delete',
        ref: doc(db, 'users', uid, 'playlists', oldPlDocId),
      });
    }
  }

  // Liked Songs
  const nextLikedDocIds = new Set<string>();
  for (const [trackId, track] of Object.entries(snapshot.likedMap || {})) {
    const docId = toFirestoreDocId(trackId);
    nextLikedDocIds.add(docId);
    const docPath = `${userPath}/likedSongs/${docId}`;
    stage2Ops.push({
      type: 'set',
      ref: doc(db, 'users', uid, 'likedSongs', docId),
      data: withTimestamps(docPath, {
        uid,
        id: clampString(track.id || trackId, 160, docId),
        schemaVersion: SCHEMA_VERSION,
        track: sanitizeTrackForCloud(track),
        likedAtMs: snapshot.likedTimestamps?.[trackId] || nowMs,
      }),
    });
  }
  for (const oldLikedId of meta.likedDocIds) {
    if (!nextLikedDocIds.has(oldLikedId)) {
      stage2Ops.push({
        type: 'delete',
        ref: doc(db, 'users', uid, 'likedSongs', oldLikedId),
      });
    }
  }

  // Recently Played (top 20)
  const nextRecentDocIds = new Set<string>();
  (snapshot.recentlyPlayed || []).slice(0, 20).forEach((track, position) => {
    const docId = toFirestoreDocId(track.id);
    nextRecentDocIds.add(docId);
    const docPath = `${userPath}/recentHistory/${docId}`;
    stage2Ops.push({
      type: 'set',
      ref: doc(db, 'users', uid, 'recentHistory', docId),
      data: withTimestamps(docPath, {
        uid,
        id: clampString(track.id, 160, docId),
        schemaVersion: SCHEMA_VERSION,
        position,
        playedAtMs: nowMs - position * 1000,
        track: sanitizeTrackForCloud(track),
      }),
    });
  });
  for (const oldRecentId of meta.recentDocIds) {
    if (!nextRecentDocIds.has(oldRecentId)) {
      stage2Ops.push({
        type: 'delete',
        ref: doc(db, 'users', uid, 'recentHistory', oldRecentId),
      });
    }
  }

  // Per-track stats (capped to top 150 active tracks)
  const statCandidates = Object.entries(snapshot.playedTracks || {})
    .sort((a, b) => (snapshot.playCounts?.[b[0]] || 0) - (snapshot.playCounts?.[a[0]] || 0))
    .slice(0, 150);
  const nextPlayedDocIds = new Set<string>();
  for (const [trackId, track] of statCandidates) {
    const docId = toFirestoreDocId(trackId);
    nextPlayedDocIds.add(docId);
    const docPath = `${userPath}/playedTracks/${docId}`;
    const fb = snapshot.listeningFeedback?.[trackId] || { skips: 0, completions: 0 };
    stage2Ops.push({
      type: 'set',
      ref: doc(db, 'users', uid, 'playedTracks', docId),
      data: withTimestamps(docPath, {
        uid,
        id: clampString(track.id || trackId, 160, docId),
        schemaVersion: SCHEMA_VERSION,
        playCount: Math.max(0, Math.min(1_000_000, Math.round(snapshot.playCounts?.[trackId] || 0))),
        skips: Math.max(0, Math.min(1_000_000, Math.round(fb.skips || 0))),
        completions: Math.max(0, Math.min(1_000_000, Math.round(fb.completions || 0))),
        lastPlayedAtMs: nowMs,
        track: sanitizeTrackForCloud(track),
      }),
    });
  }
  for (const oldPlayedId of meta.playedTrackDocIds) {
    if (!nextPlayedDocIds.has(oldPlayedId)) {
      stage2Ops.push({
        type: 'delete',
        ref: doc(db, 'users', uid, 'playedTracks', oldPlayedId),
      });
    }
  }

  // AI Taste Summary
  const playCountsSanitized = sanitizeAffinityMap(snapshot.playCounts, 200);
  const totalPlays = Object.values(snapshot.playCounts || {}).reduce(
    (sum, n) => sum + (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0),
    0
  );
  const tastePath = `${userPath}/tasteStats/summary`;
  stage2Ops.push({
    type: 'set',
    ref: doc(db, 'users', uid, 'tasteStats', 'summary'),
    data: withTimestamps(tastePath, {
      uid,
      id: 'summary',
      schemaVersion: SCHEMA_VERSION,
      artistAffinity: sanitizeAffinityMap(snapshot.artistAffinity, 100),
      languageAffinity: sanitizeAffinityMap(snapshot.languageAffinity, 40),
      genreAffinity: sanitizeAffinityMap(snapshot.genreAffinity, 60),
      playCounts: playCountsSanitized,
      listeningFeedback: sanitizeFeedbackMap(snapshot.listeningFeedback, 200),
      tasteResetActive: Boolean(snapshot.tasteResetActive),
      totalPlays: Math.min(10_000_000, totalPlays),
      updatedAtMs: nowMs,
    }),
  });

  // Followed Artists (committed independently so un-published subcollection rules never block core library sync)
  const followedOps: PendingBatchOp[] = [];
  const nextFollowedDocIds = new Set<string>();
  for (const [artistKey, rawArtist] of Object.entries(snapshot.followedArtists || {}).slice(0, 500)) {
    const cleanArtist = sanitizeFollowedArtistForCloud(rawArtist, artistKey);
    const docId = toFirestoreDocId(cleanArtist.id);
    nextFollowedDocIds.add(docId);
    const docPath = `${userPath}/followedArtists/${docId}`;
    const payload: Record<string, unknown> = {
      uid,
      id: cleanArtist.id,
      schemaVersion: SCHEMA_VERSION,
      name: cleanArtist.name,
      image: cleanArtist.image,
      followedAtMs: cleanArtist.followedAtMs,
    };
    if (cleanArtist.genre) payload.genre = cleanArtist.genre;
    if (cleanArtist.language) payload.language = cleanArtist.language;
    if (cleanArtist.monthlyListeners) payload.monthlyListeners = cleanArtist.monthlyListeners;
    if (cleanArtist.bio) payload.bio = cleanArtist.bio;
    followedOps.push({
      type: 'set',
      ref: doc(db, 'users', uid, 'followedArtists', docId),
      data: withTimestamps(docPath, payload),
    });
  }
  for (const oldFollowedId of meta.followedArtistDocIds) {
    if (!nextFollowedDocIds.has(oldFollowedId)) {
      followedOps.push({
        type: 'delete',
        ref: doc(db, 'users', uid, 'followedArtists', oldFollowedId),
      });
    }
  }

  // If > 380 playlists, ensure root profile commits alone first so parentUserExists always succeeds
  if (stage1Ops.length > 380) {
    await commitInChunks(stage1Ops.slice(0, 1), uid);
    await commitInChunks(stage1Ops.slice(1), uid);
  } else {
    await commitInChunks(stage1Ops, uid);
  }

  if (stage2Ops.length > 0) {
    await commitInChunks(stage2Ops, uid);
  }

  if (followedOps.length > 0) {
    try {
      await commitInChunks(followedOps, uid);
    } catch (err) {
      if (isPermissionDeniedError(err)) {
        console.warn('[Firestore] followedArtists write skipped (publish updated firestore.rules to sync followed artists).');
      } else {
        throw err;
      }
    }
  }

  // Refresh createdAt cache for subsequent updates
  const refreshed = await fetchCloudSnapshot(uid).catch(() => null);
  return refreshed ? refreshed.meta : meta;
}
