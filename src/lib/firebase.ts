import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  initializeAuth,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut as signOutWeb,
  updateProfile,
  type Auth,
  type UserCredential,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

export const app = initializeApp(firebaseConfig);
const dbId = (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId;
export const db = dbId ? getFirestore(app, dbId) : getFirestore(app);

function createPersistentAuth(): Auth {
  try {
    return initializeAuth(app, {
      persistence: Capacitor.isNativePlatform()
        ? indexedDBLocalPersistence
        : browserLocalPersistence,
    });
  } catch {
    return getAuth(app);
  }
}

export const auth = createPersistentAuth();

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export async function signInWithGoogle(): Promise<UserCredential | null> {
  if (Capacitor.isNativePlatform()) {
    // Google sign-in on Android must use the native account/credential UI,
    // not an OAuth page embedded in or opened from the app WebView.
    const result = await FirebaseAuthentication.signInWithGoogle({
      skipNativeAuth: true,
      useCredentialManager: true,
    });
    const idToken = result.credential?.idToken;
    if (!idToken) {
      throw new Error('Google did not return an ID token. Check the Android OAuth client and signing certificate setup.');
    }
    return signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
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
  if (Capacitor.isNativePlatform()) {
    // Clears the native credential-provider state; the actual app session
    // is maintained by the Firebase JavaScript SDK below.
    await FirebaseAuthentication.signOut().catch(() => {});
  }
  await signOutWeb(auth);
}
