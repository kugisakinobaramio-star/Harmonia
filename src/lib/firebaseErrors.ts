export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreProviderSummary {
  providerId: string;
  displayName: string | null;
  email: string | null;
  photoUrl: string | null;
}

export interface FirestoreAuthContextInfo {
  userId: string | undefined;
  email: string | null | undefined;
  emailVerified: boolean | undefined;
  isAnonymous: boolean | undefined;
  tenantId: string | null | undefined;
  providerInfo: FirestoreProviderSummary[];
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: FirestoreAuthContextInfo;
}

export interface MinimalAuthUser {
  uid?: string;
  email?: string | null;
  emailVerified?: boolean;
  isAnonymous?: boolean;
  tenantId?: string | null;
  providerData?: Array<{
    providerId?: string | null;
    displayName?: string | null;
    email?: string | null;
    photoURL?: string | null;
  }>;
}

export function buildFirestoreErrorInfo(
  error: unknown,
  operationType: OperationType,
  path: string | null,
  currentUser?: MinimalAuthUser | null
): FirestoreErrorInfo {
  const message = error instanceof Error ? error.message : String(error || 'Unknown Firestore error');
  return {
    error: message,
    operationType,
    path,
    authInfo: {
      userId: currentUser?.uid,
      email: currentUser?.email,
      emailVerified: currentUser?.emailVerified,
      isAnonymous: currentUser?.isAnonymous,
      tenantId: currentUser?.tenantId,
      providerInfo: (currentUser?.providerData || []).map((provider) => ({
        providerId: provider.providerId || 'unknown',
        displayName: provider.displayName ?? null,
        email: provider.email ?? null,
        photoUrl: provider.photoURL ?? null,
      })),
    },
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
  currentUser?: MinimalAuthUser | null
): never {
  const errInfo = buildFirestoreErrorInfo(error, operationType, path, currentUser);
  const serialized = JSON.stringify(errInfo);
  console.error('Firestore Error:', serialized);
  throw new Error(serialized);
}

export function getFirebaseErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code;
  }
  const msg = error instanceof Error ? error.message : String(error || '');
  const match = msg.match(/\b(auth\/[a-z0-9-]+|permission-denied|unavailable|failed-precondition)\b/i);
  return match ? match[1].toLowerCase() : '';
}

export function isPermissionDeniedError(error: unknown): boolean {
  const code = getFirebaseErrorCode(error);
  if (code === 'permission-denied' || code === 'firestore/permission-denied') return true;
  const msg = error instanceof Error ? error.message : String(error || '');
  return /missing or insufficient permissions|permission[-_ ]denied/i.test(msg);
}

export function isNetworkOrOfflineError(error: unknown): boolean {
  const code = getFirebaseErrorCode(error);
  if (
    code === 'unavailable' ||
    code === 'firestore/unavailable' ||
    code === 'auth/network-request-failed'
  ) {
    return true;
  }
  const msg = error instanceof Error ? error.message : String(error || '');
  return /offline|network|failed to get document because the client is offline|unavailable|timeout|econnrefused/i.test(msg);
}

export function toFriendlyAuthError(error: unknown): string {
  const code = getFirebaseErrorCode(error);
  switch (code) {
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Contact support if this is unexpected.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Incorrect email or password. Please check your details and try again.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Try signing in instead.';
    case 'auth/weak-password':
      return 'Please choose a stronger password (at least 6 characters).';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';
    case 'auth/network-request-failed':
      return 'Network unavailable. Your music and local library remain available offline.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Sign-in was cancelled before completion.';
    case 'auth/popup-blocked':
      return 'Sign-in popup was blocked. Redirecting or try allowing popups for this site.';
    case 'auth/operation-not-allowed':
      return 'This sign-in method is not enabled in the Firebase project settings yet.';
    case 'auth/unauthorized-domain':
      return 'This domain is not authorized for Google Sign-In in Firebase Console.';
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with this email using a different sign-in method.';
    case 'auth/requires-recent-login':
      return 'Please sign in again to complete this security-sensitive action.';
    default: {
      if (isNetworkOrOfflineError(error)) {
        return 'You appear to be offline. Local playback continues without interruption.';
      }
      const raw = error instanceof Error ? error.message : String(error || '');
      if (raw && raw.length < 180 && !raw.includes('Firebase:')) {
        return raw;
      }
      return 'Authentication could not be completed. Please try again.';
    }
  }
}

export function toFriendlySyncError(error: unknown): string {
  if (isNetworkOrOfflineError(error)) {
    return 'Offline — changes are saved locally and queued for automatic sync.';
  }
  if (isPermissionDeniedError(error)) {
    return 'Cloud sync permission denied. Check your sign-in session or Firestore rules.';
  }
  const raw = error instanceof Error ? error.message : String(error || '');
  if (/^\{.*"operationType":/.test(raw)) {
    return 'Cloud sync rejected this update due to security rules or missing permissions.';
  }
  return raw || 'Cloud sync paused. Changes remain safe locally.';
}
