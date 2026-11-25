import { App as CapacitorApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';

export const ANDROID_CUSTOM_SCHEME = 'com.harmonia.music';
export const ANDROID_AUTH_CALLBACK_PREFIX = 'com.harmonia.music://auth/callback';
export const DEFAULT_ANDROID_OAUTH_REDIRECT_URI =
  'https://harmonia.kugisakinobaramio.workers.dev/?android_oauth=1';
const PENDING_OAUTH_STORAGE_KEY = 'musick_android_oauth_pending_v1';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export interface PendingAndroidOAuth {
  state: string;
  nonce: string;
  createdAtMs: number;
}

export interface ParsedOAuthCallback {
  ok: boolean;
  idToken?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}

function randomToken(bytesLength = 24): string {
  const bytes = new Uint8Array(bytesLength);
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function getAndroidOAuthRedirectUri(): string {
  const envVal =
    typeof import.meta !== 'undefined' && import.meta.env
      ? (import.meta.env as Record<string, string | undefined>).VITE_ANDROID_OAUTH_REDIRECT_URI
      : undefined;
  return envVal?.trim() || DEFAULT_ANDROID_OAUTH_REDIRECT_URI;
}

export function buildGoogleOAuthUrlForAndroid(params: {
  clientId: string;
  redirectUri?: string;
  state: string;
  nonce: string;
}): string {
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', params.clientId);
  authUrl.searchParams.set('redirect_uri', params.redirectUri || getAndroidOAuthRedirectUri());
  authUrl.searchParams.set('response_type', 'id_token');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('state', params.state);
  authUrl.searchParams.set('nonce', params.nonce);
  authUrl.searchParams.set('prompt', 'select_account');
  return authUrl.toString();
}

export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const json =
      typeof atob === 'function'
        ? atob(padded)
        : Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function verifyJwtNonce(idToken: string, expectedNonce: string): boolean {
  const payload = decodeJwtPayload(idToken);
  if (!payload || typeof payload.nonce !== 'string') return false;
  return payload.nonce === expectedNonce;
}

export function parseOAuthCallbackUrl(callbackUrl: string): ParsedOAuthCallback {
  try {
    const normalized = callbackUrl.startsWith(ANDROID_AUTH_CALLBACK_PREFIX)
      ? callbackUrl.replace(ANDROID_AUTH_CALLBACK_PREFIX, 'https://callback.local/auth/callback')
      : callbackUrl;
    const parsed = new URL(normalized);
    const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));
    const queryParams = parsed.searchParams;

    const idToken = hashParams.get('id_token') || queryParams.get('id_token') || undefined;
    const state = hashParams.get('state') || queryParams.get('state') || undefined;
    const error = hashParams.get('error') || queryParams.get('error') || undefined;
    const errorDescription =
      hashParams.get('error_description') || queryParams.get('error_description') || undefined;

    if (error) {
      return { ok: false, state, error, errorDescription };
    }
    if (!idToken) {
      return { ok: false, state, error: 'missing_id_token' };
    }
    return { ok: true, idToken, state };
  } catch {
    return { ok: false, error: 'invalid_callback_url' };
  }
}

export function buildAndroidCallbackRedirectFromWebLocation(locationHref: string): {
  isBridgePage: boolean;
  appDeepLink: string | null;
  error?: string;
} {
  try {
    const url = new URL(locationHref);
    if (url.searchParams.get('android_oauth') !== '1') {
      return { isBridgePage: false, appDeepLink: null };
    }

    const parsed = parseOAuthCallbackUrl(locationHref);
    const outParams = new URLSearchParams();
    if (parsed.idToken) outParams.set('id_token', parsed.idToken);
    if (parsed.state) outParams.set('state', parsed.state);
    if (parsed.error) outParams.set('error', parsed.error);
    if (parsed.errorDescription) outParams.set('error_description', parsed.errorDescription);

    const fragment = outParams.toString();
    return {
      isBridgePage: true,
      appDeepLink: `${ANDROID_AUTH_CALLBACK_PREFIX}${fragment ? `#${fragment}` : ''}`,
      error: parsed.error,
    };
  } catch {
    return { isBridgePage: false, appDeepLink: null };
  }
}

function savePendingOAuth(pending: PendingAndroidOAuth): void {
  try {
    localStorage.setItem(PENDING_OAUTH_STORAGE_KEY, JSON.stringify(pending));
  } catch {
    // Ignore storage issues
  }
}

function consumePendingOAuth(): PendingAndroidOAuth | null {
  try {
    const raw = localStorage.getItem(PENDING_OAUTH_STORAGE_KEY);
    localStorage.removeItem(PENDING_OAUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingAndroidOAuth;
    if (!parsed?.state || !parsed?.nonce || Date.now() - parsed.createdAtMs > OAUTH_STATE_TTL_MS) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

let activeResolve: ((result: { idToken: string }) => void) | null = null;
let activeReject: ((err: Error) => void) | null = null;
let listenerInitialized = false;
let fallbackHandler: ((idToken: string) => Promise<void>) | null = null;

export function registerAndroidAuthFallbackHandler(
  handler: (idToken: string) => Promise<void>
): void {
  fallbackHandler = handler;
}

export async function initAndroidAuthBridge(): Promise<void> {
  if (listenerInitialized || !Capacitor.isNativePlatform()) return;
  listenerInitialized = true;

  await CapacitorApp.addListener('appUrlOpen', async ({ url }) => {
    if (!url || !url.startsWith(ANDROID_AUTH_CALLBACK_PREFIX)) return;

    try {
      await Browser.close();
    } catch {
      // Browser tab may already be closed
    }

    const parsed = parseOAuthCallbackUrl(url);
    const pending = consumePendingOAuth();

    if (!parsed.ok || !parsed.idToken) {
      const err = new Error(
        parsed.error === 'access_denied'
          ? 'Google sign-in was cancelled.'
          : parsed.errorDescription || parsed.error || 'Google sign-in failed on Android.'
      );
      if (activeReject) {
        activeReject(err);
        activeResolve = null;
        activeReject = null;
      }
      return;
    }

    if (!pending || parsed.state !== pending.state || !verifyJwtNonce(parsed.idToken, pending.nonce)) {
      const err = new Error('Google sign-in security check failed. Please try again.');
      if (activeReject) {
        activeReject(err);
        activeResolve = null;
        activeReject = null;
      }
      return;
    }

    if (activeResolve) {
      activeResolve({ idToken: parsed.idToken });
      activeResolve = null;
      activeReject = null;
    } else if (fallbackHandler) {
      await fallbackHandler(parsed.idToken);
    }
  });
}

export async function startAndroidGoogleOAuth(clientId: string): Promise<{ idToken: string }> {
  await initAndroidAuthBridge();

  if (!clientId) {
    throw new Error('Google OAuth client ID is not configured.');
  }

  const state = randomToken(16);
  const nonce = randomToken(16);
  savePendingOAuth({ state, nonce, createdAtMs: Date.now() });

  const oauthUrl = buildGoogleOAuthUrlForAndroid({ clientId, state, nonce });

  return new Promise<{ idToken: string }>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      if (activeReject) {
        activeReject(new Error('Google sign-in timed out. Please try again.'));
        activeResolve = null;
        activeReject = null;
      }
    }, 3 * 60 * 1000);

    activeResolve = (res) => {
      window.clearTimeout(timer);
      resolve(res);
    };
    activeReject = (err) => {
      window.clearTimeout(timer);
      reject(err);
    };

    Browser.open({ url: oauthUrl, presentationStyle: 'popover' }).catch((err) => {
      window.clearTimeout(timer);
      activeResolve = null;
      activeReject = null;
      reject(err instanceof Error ? err : new Error('Could not open system browser for sign-in.'));
    });
  });
}
