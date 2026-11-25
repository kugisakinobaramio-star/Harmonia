import { onAuthStateChanged, type User } from 'firebase/auth';
import { useCallback, useEffect, useRef, useState } from 'react';
import { auth, completeRedirectSignIn, logOut } from './firebase';
import { isNetworkOrOfflineError, toFriendlySyncError } from './firebaseErrors';
import {
  fetchCloudSnapshot,
  pushCloudSnapshot,
  type CloudReadMetadata,
} from './firestoreSync';
import {
  computeMigrationDiff,
  createEmptySnapshot,
  createLocalBackup,
  enqueueSyncTask,
  getLastActiveUid,
  getSyncQueue,
  hasCompletedMigration,
  hasDueSyncTask,
  hasUserDataInSnapshot,
  listLocalBackups,
  loadAccountCache,
  loadGuestSnapshot,
  markMigrationCompleted,
  markSyncFailure,
  markSyncSuccess,
  mergeMusicSnapshots,
  restoreLocalBackup,
  saveAccountCache,
  saveGuestSnapshot,
  setLastActiveUid,
  type CloudSyncState,
  type LocalBackupEntry,
  type MigrationDiff,
  type MigrationResolution,
  type MusicKKLocalSnapshot,
} from './syncEngine';

export interface MigrationPromptState {
  uid: string;
  email: string | null;
  diff: MigrationDiff;
  local: MusicKKLocalSnapshot;
  cloud: MusicKKLocalSnapshot;
  cloudMeta: CloudReadMetadata;
}

interface UseCloudSyncOptions {
  getCurrentSnapshot: () => MusicKKLocalSnapshot;
  applySnapshot: (snapshot: MusicKKLocalSnapshot) => void;
  onToast: (message: string) => void;
}

export function useCloudSync({
  getCurrentSnapshot,
  applySnapshot,
  onToast,
}: UseCloudSyncOptions) {
  const [user, setUser] = useState<User | null>(() => auth.currentUser);
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [syncState, setSyncState] = useState<CloudSyncState>(() =>
    auth.currentUser ? 'idle' : 'guest'
  );
  const [lastSyncedAtMs, setLastSyncedAtMs] = useState<number | null>(null);
  const [pendingQueueCount, setPendingQueueCount] = useState<number>(() =>
    auth.currentUser ? getSyncQueue(auth.currentUser.uid).length : 0
  );
  const [syncError, setSyncError] = useState<string>('');
  const [backups, setBackups] = useState<LocalBackupEntry[]>(() => listLocalBackups());
  const [migrationPrompt, setMigrationPrompt] = useState<MigrationPromptState | null>(null);

  const getCurrentSnapshotRef = useRef(getCurrentSnapshot);
  const applySnapshotRef = useRef(applySnapshot);
  const onToastRef = useRef(onToast);
  useEffect(() => {
    getCurrentSnapshotRef.current = getCurrentSnapshot;
    applySnapshotRef.current = applySnapshot;
    onToastRef.current = onToast;
  }, [getCurrentSnapshot, applySnapshot, onToast]);

  const activeUidRef = useRef<string | null>(getLastActiveUid());
  const cloudMetaRef = useRef<CloudReadMetadata | undefined>(undefined);
  const hydratingRef = useRef<boolean>(false);
  const syncingRef = useRef<boolean>(false);
  const debounceTimerRef = useRef<number | null>(null);
  const hydrationTimerRef = useRef<number | null>(null);
  const authSeqRef = useRef<number>(0);

  const refreshBackups = useCallback(() => {
    setBackups(listLocalBackups());
  }, []);

  const applyWithHydrationGuard = useCallback((nextSnap: MusicKKLocalSnapshot) => {
    if (hydrationTimerRef.current !== null) {
      window.clearTimeout(hydrationTimerRef.current);
      hydrationTimerRef.current = null;
    }
    hydratingRef.current = true;
    try {
      applySnapshotRef.current(nextSnap);
    } finally {
      hydrationTimerRef.current = window.setTimeout(() => {
        hydrationTimerRef.current = null;
        hydratingRef.current = false;
      }, 50);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (hydrationTimerRef.current !== null) {
        window.clearTimeout(hydrationTimerRef.current);
        hydrationTimerRef.current = null;
      }
    };
  }, []);

  const flushSyncQueue = useCallback(async (uid: string, forceManual = false) => {
    if (!uid || syncingRef.current) return;
    if (!hasCompletedMigration(uid)) return;

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setSyncState('offline');
      setPendingQueueCount(getSyncQueue(uid).length);
      if (forceManual) {
        onToastRef.current('You are offline. Changes are saved locally and queued.');
      }
      return;
    }

    syncingRef.current = true;
    setSyncState('syncing');
    setSyncError('');

    try {
      const currentSnap = getCurrentSnapshotRef.current();
      saveAccountCache(uid, currentSnap);
      const currentUser = auth.currentUser;
      const updatedMeta = await pushCloudSnapshot(
        uid,
        currentSnap,
        cloudMetaRef.current,
        currentUser
          ? {
              email: currentUser.email,
              photoURL: currentUser.photoURL,
              displayName: currentUser.displayName,
            }
          : undefined
      );
      cloudMetaRef.current = updatedMeta;
      markSyncSuccess(uid);
      setPendingQueueCount(0);
      setLastSyncedAtMs(Date.now());
      setSyncState('synced');
      setSyncError('');
      if (forceManual) {
        onToastRef.current('Library & taste synced to cloud.');
      }
    } catch (err) {
      const msg = toFriendlySyncError(err);
      markSyncFailure(uid, msg);
      setPendingQueueCount(getSyncQueue(uid).length);
      setSyncError(msg);
      setSyncState(isNetworkOrOfflineError(err) ? 'offline' : 'error');
      if (forceManual) {
        onToastRef.current(msg);
      }
    } finally {
      syncingRef.current = false;
    }
  }, []);

  const scheduleSync = useCallback(
    (reason: string) => {
      const currentUser = auth.currentUser;
      if (!currentUser || hydratingRef.current || migrationPrompt) return;
      if (!hasCompletedMigration(currentUser.uid)) return;

      const snap = getCurrentSnapshotRef.current();
      saveAccountCache(currentUser.uid, snap);
      enqueueSyncTask(currentUser.uid, reason);
      setPendingQueueCount(getSyncQueue(currentUser.uid).length);

      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = window.setTimeout(() => {
        debounceTimerRef.current = null;
        void flushSyncQueue(currentUser.uid, false);
      }, 1500);
    },
    [flushSyncQueue, migrationPrompt]
  );

  // Track online/offline status & auto-flush pending sync tasks on reconnect
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      const currentUser = auth.currentUser;
      if (currentUser && hasCompletedMigration(currentUser.uid)) {
        void flushSyncQueue(currentUser.uid, false);
      }
    };
    const handleOffline = () => {
      setIsOnline(false);
      if (auth.currentUser) {
        setSyncState('offline');
      }
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [flushSyncQueue]);

  // Periodic retry loop for due sync tasks
  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(() => {
      if (
        user &&
        isOnline &&
        hasCompletedMigration(user.uid) &&
        hasDueSyncTask(user.uid) &&
        !syncingRef.current &&
        !migrationPrompt
      ) {
        void flushSyncQueue(user.uid, false);
      }
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [user, isOnline, migrationPrompt, flushSyncQueue]);

  // Complete any pending web redirect login on mount
  useEffect(() => {
    void completeRedirectSignIn().catch(() => {});
  }, []);

  // Auth state observer handling Guest -> Signed-In, Account A -> Account B, and Sign-Out
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      const seq = ++authSeqRef.current;
      const prevUid = activeUidRef.current;

      setUser(nextUser);

      if (prevUid !== (nextUser?.uid || null) && debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }

      // Sign-out: User -> Guest
      if (!nextUser) {
        if (prevUid) {
          const prevSnap = getCurrentSnapshotRef.current();
          saveAccountCache(prevUid, prevSnap);
          createLocalBackup(prevSnap, 'Before sign-out', prevUid);
          refreshBackups();
        }
        activeUidRef.current = null;
        setLastActiveUid(null);
        cloudMetaRef.current = undefined;
        setMigrationPrompt(null);
        setSyncState('guest');
        setSyncError('');
        setLastSyncedAtMs(null);
        setPendingQueueCount(0);

        if (prevUid) {
          const guestSnap = loadGuestSnapshot() || createEmptySnapshot();
          applyWithHydrationGuard(guestSnap);
        }
        return;
      }

      const nextUid: string = nextUser.uid;

      // Account Switch: User A -> User B (isolate strictly!)
      let workingLocalSnap = getCurrentSnapshotRef.current();
      if (prevUid && prevUid !== nextUid) {
        saveAccountCache(prevUid, workingLocalSnap);
        createLocalBackup(workingLocalSnap, 'Before switching accounts', prevUid);
        refreshBackups();

        // Never carry Account A's private library into Account B!
        const isolatedNext = loadAccountCache(nextUid) || createEmptySnapshot();
        workingLocalSnap = isolatedNext;
        applyWithHydrationGuard(isolatedNext);
      } else if (!prevUid) {
        // Guest -> Signed-In: preserve guest backup before comparing/merging
        saveGuestSnapshot(workingLocalSnap);
        if (hasUserDataInSnapshot(workingLocalSnap)) {
          createLocalBackup(workingLocalSnap, 'Guest library backup before sign-in', null);
          refreshBackups();
        }
      }

      activeUidRef.current = nextUid;
      setLastActiveUid(nextUid);
      setPendingQueueCount(getSyncQueue(nextUid).length);
      setSyncError('');

      const alreadyMigrated = hasCompletedMigration(nextUid);

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setSyncState('offline');
        if (alreadyMigrated) {
          const cached = loadAccountCache(nextUid);
          if (cached && (!prevUid || prevUid !== nextUid)) {
            applyWithHydrationGuard(cached);
          }
        }
        return;
      }

      setSyncState('syncing');
      try {
        const cloudRes = await fetchCloudSnapshot(nextUid);
        if (seq !== authSeqRef.current) return;
        cloudMetaRef.current = cloudRes.meta;

        if (!alreadyMigrated) {
          const diff = computeMigrationDiff(workingLocalSnap, cloudRes.snapshot);
          if (diff.needsPreview) {
            setSyncState('migration-pending');
            setMigrationPrompt({
              uid: nextUid,
              email: nextUser.email,
              diff,
              local: workingLocalSnap,
              cloud: cloudRes.snapshot,
              cloudMeta: cloudRes.meta,
            });
            return;
          }

          if (cloudRes.exists) {
            const hydrated = mergeMusicSnapshots(workingLocalSnap, cloudRes.snapshot, {
              mode: 'cloud-only',
            });
            saveAccountCache(nextUid, hydrated);
            markMigrationCompleted(nextUid);
            applyWithHydrationGuard(hydrated);
            setLastSyncedAtMs(Date.now());
            setSyncState('synced');
          } else {
            markMigrationCompleted(nextUid);
            enqueueSyncTask(nextUid, 'initial-setup');
            await flushSyncQueue(nextUid, false);
          }
          return;
        }

        // Returning session restart for the same account
        const hasPendingOffline = getSyncQueue(nextUid).length > 0;
        if (cloudRes.exists) {
          const merged = mergeMusicSnapshots(workingLocalSnap, cloudRes.snapshot, {
            mode: 'merge',
          });
          saveAccountCache(nextUid, merged);
          applyWithHydrationGuard(merged);
          if (hasPendingOffline) {
            await flushSyncQueue(nextUid, false);
          } else {
            setLastSyncedAtMs(Date.now());
            setSyncState('synced');
          }
        } else {
          enqueueSyncTask(nextUid, 'restore-cloud');
          await flushSyncQueue(nextUid, false);
        }
      } catch (err) {
        if (seq !== authSeqRef.current) return;
        const msg = toFriendlySyncError(err);
        setSyncError(msg);
        setSyncState(isNetworkOrOfflineError(err) ? 'offline' : 'error');
      }
    });

    return () => {
      unsubscribe();
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, [applyWithHydrationGuard, flushSyncQueue, refreshBackups]);

  const resolveMigration = useCallback(
    async (resolution: MigrationResolution) => {
      const prompt = migrationPrompt;
      if (!prompt) return;

      if (resolution === 'cancel') {
        setMigrationPrompt(null);
        await logOut().catch(() => {});
        return;
      }

      const { uid, local, cloud, cloudMeta } = prompt;
      cloudMetaRef.current = cloudMeta;

      if (hasUserDataInSnapshot(local)) {
        createLocalBackup(local, `Pre-migration snapshot (${resolution})`, uid);
        refreshBackups();
      }

      const mode =
        resolution === 'merge'
          ? 'merge'
          : resolution === 'cloud-only'
            ? 'cloud-only'
            : 'local-only';

      const finalSnapshot = mergeMusicSnapshots(local, cloud, { mode });
      saveAccountCache(uid, finalSnapshot);
      markMigrationCompleted(uid);
      setMigrationPrompt(null);
      applyWithHydrationGuard(finalSnapshot);

      if (resolution === 'cloud-only') {
        markSyncSuccess(uid);
        setPendingQueueCount(0);
        setLastSyncedAtMs(Date.now());
        setSyncState('synced');
        onToastRef.current('Loaded cloud library. A local backup of your device data was kept.');
      } else {
        enqueueSyncTask(uid, `migration-${resolution}`);
        await flushSyncQueue(uid, false);
        onToastRef.current(
          resolution === 'merge'
            ? 'Merged local and cloud libraries cleanly!'
            : 'Kept device library and updated cloud account.'
        );
      }
    },
    [applyWithHydrationGuard, flushSyncQueue, migrationPrompt, refreshBackups]
  );

  const manualSync = useCallback(async () => {
    if (!user) return;
    if (migrationPrompt) {
      onToastRef.current('Please review and confirm the cloud migration preview first.');
      return;
    }
    enqueueSyncTask(user.uid, 'manual-sync');
    setPendingQueueCount(getSyncQueue(user.uid).length);
    await flushSyncQueue(user.uid, true);
  }, [flushSyncQueue, migrationPrompt, user]);

  const createManualBackup = useCallback(() => {
    const snap = getCurrentSnapshotRef.current();
    createLocalBackup(snap, 'Manual user backup', user?.uid || null);
    refreshBackups();
    onToastRef.current('Saved a recoverable backup on this device.');
  }, [refreshBackups, user]);

  const handleRestoreBackup = useCallback(
    (backupId: string) => {
      const restored = restoreLocalBackup(backupId);
      if (!restored) {
        onToastRef.current('Selected backup could not be loaded.');
        return;
      }
      // Save safety backup of current state before restoring an older backup
      createLocalBackup(
        getCurrentSnapshotRef.current(),
        'Safety backup before restore',
        user?.uid || null
      );
      applyWithHydrationGuard(restored);
      refreshBackups();
      if (user && hasCompletedMigration(user.uid)) {
        enqueueSyncTask(user.uid, 'backup-restore');
        void flushSyncQueue(user.uid, false);
      }
      onToastRef.current('Restored library backup on this device.');
    },
    [applyWithHydrationGuard, flushSyncQueue, refreshBackups, user]
  );

  return {
    user,
    isOnline,
    syncState,
    lastSyncedAtMs,
    pendingQueueCount,
    syncError,
    backups,
    migrationPrompt,
    scheduleSync,
    manualSync,
    resolveMigration,
    createManualBackup,
    restoreBackup: handleRestoreBackup,
    openMigrationPreviewIfPending: () => {
      // Keeps UI helper explicit if dismissed/reopened
      if (migrationPrompt) setMigrationPrompt({ ...migrationPrompt });
    },
  };
}
