import { Capacitor } from '@capacitor/core';
import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  inMemoryPersistence,
  indexedDBLocalPersistence,
  initializeAuth,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updateProfile,
  type Auth,
  type UserCredential,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  initAndroidAuthBridge,
  registerAndroidAuthFallbackHandler,
  startAndroidGoogleOAuth,
} from './androidAuthBridge';
import { isNetworkOrOfflineError } from './firebaseErrors';

export const app = initializeApp(firebaseConfig);
const dbId = (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId;
export const db = dbId ? getFirestore(app, dbId) : getFirestore(app);

function createPersistentAuth(): Auth {
  try {
    return initializeAuth(app, {
      persistence: [
        indexedDBLocalPersistence,
        browserLocalPersistence,
        inMemoryPersistence,
      ],
    });
  } catch {
    return getAuth(app);
  }
}

export const auth = createPersistentAuth();

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

registerAndroidAuthFallbackHandler(async (idToken: string) => {
  const credential = GoogleAuthProvider.credential(idToken);
  await signInWithCredential(auth, credential);
});

if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
  void initAndroidAuthBridge().catch(() => {
    // Non-fatal: Android auth listener initializes on demand as well.
  });
}

export async function signInWithGoogle(): Promise<UserCredential | null> {
  if (Capacitor.isNativePlatform()) {
    const clientId = (firebaseConfig as { oAuthClientId?: string }).oAuthClientId || '';
    const { idToken } = await startAndroidGoogleOAuth(clientId);
    const credential = GoogleAuthProvider.credential(idToken);
    return signInWithCredential(auth, credential);
  }

  try {
    return await signInWithPopup(auth, googleProvider);
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code || '')
        : '';
    if (
      code === 'auth/popup-blocked' ||
      code === 'auth/operation-not-supported-in-this-browser'
    ) {
      await signInWithRedirect(auth, googleProvider);
      return null;
    }
    throw error;
  }
}

export async function completeRedirectSignIn(): Promise<UserCredential | null> {
  if (Capacitor.isNativePlatform()) return null;
  try {
    return await getRedirectResult(auth);
  } catch {
    return null;
  }
}

export async function registerWithEmail(
  email: string,
  password: string,
  displayName?: string
): Promise<UserCredential> {
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  const cleanName = displayName?.trim();
  if (cleanName && cred.user) {
    await updateProfile(cred.user, { displayName: cleanName.slice(0, 100) }).catch(() => {});
  }
  if (cred.user && !cred.user.emailVerified) {
    void sendEmailVerification(cred.user).catch(() => {});
  }
  return cred;
}

export async function signInWithEmail(
  email: string,
  password: string
): Promise<UserCredential> {
  return signInWithEmailAndPassword(auth, email.trim(), password);
}

export async function resetPassword(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim());
}

export async function resendVerificationEmail(): Promise<void> {
  if (!auth.currentUser) {
    throw new Error('Sign in first to resend a verification email.');
  }
  await sendEmailVerification(auth.currentUser);
}

export async function logOut(): Promise<void> {
  await signOut(auth);
}

async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (isNetworkOrOfflineError(error)) {
      console.warn('Firebase connection check: client is currently offline.');
    }
  }
}

if (typeof window !== 'undefined') {
  void testConnection();
}
