import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAndroidCallbackRedirectFromWebLocation,
  buildGoogleOAuthUrlForAndroid,
  decodeJwtPayload,
  parseOAuthCallbackUrl,
  verifyJwtNonce,
} from './androidAuthBridge';
import {
  buildFirestoreErrorInfo,
  handleFirestoreError,
  isNetworkOrOfflineError,
  isPermissionDeniedError,
  OperationType,
  toFriendlyAuthError,
} from './firebaseErrors';

function makeFakeJwt(payload: Record<string, unknown>): string {
  const encode = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

test('Google Auth builds valid Android OAuth URL with state and nonce', () => {
  const url = buildGoogleOAuthUrlForAndroid({
    clientId: '1024229515055-test.apps.googleusercontent.com',
    redirectUri: 'https://harmonia.kugisakinobaramio.workers.dev/?android_oauth=1',
    state: 'state_123',
    nonce: 'nonce_456',
  });
  const parsed = new URL(url);
  assert.equal(parsed.origin, 'https://accounts.google.com');
  assert.equal(parsed.searchParams.get('response_type'), 'id_token');
  assert.equal(parsed.searchParams.get('client_id'), '1024229515055-test.apps.googleusercontent.com');
  assert.equal(parsed.searchParams.get('state'), 'state_123');
  assert.equal(parsed.searchParams.get('nonce'), 'nonce_456');
  assert.equal(parsed.searchParams.get('scope'), 'openid email profile');
});

test('Android OAuth callback bridge validates custom scheme redirects and JWT nonce', () => {
  const fakeToken = makeFakeJwt({ sub: '12345', nonce: 'expected-nonce', email: 'user@example.com' });
  const webLocation = `https://harmonia.kugisakinobaramio.workers.dev/?android_oauth=1#id_token=${fakeToken}&state=st1`;

  const bridge = buildAndroidCallbackRedirectFromWebLocation(webLocation);
  assert.equal(bridge.isBridgePage, true);
  assert.ok(bridge.appDeepLink?.startsWith('com.harmonia.music://auth/callback#'));

  const callback = parseOAuthCallbackUrl(bridge.appDeepLink!);
  assert.equal(callback.ok, true);
  assert.equal(callback.state, 'st1');
  assert.equal(callback.idToken, fakeToken);

  assert.equal(decodeJwtPayload(fakeToken)?.email, 'user@example.com');
  assert.equal(verifyJwtNonce(fakeToken, 'expected-nonce'), true);
  assert.equal(verifyJwtNonce(fakeToken, 'wrong-nonce'), false);
});

test('Android OAuth callback rejects error responses cleanly without leaking tokens', () => {
  const callback = parseOAuthCallbackUrl(
    'com.harmonia.music://auth/callback#error=access_denied&state=st1'
  );
  assert.equal(callback.ok, false);
  assert.equal(callback.error, 'access_denied');
  assert.equal(callback.idToken, undefined);

  const nonBridge = buildAndroidCallbackRedirectFromWebLocation('https://harmonia.kugisakinobaramio.workers.dev/');
  assert.equal(nonBridge.isBridgePage, false);
  assert.equal(nonBridge.appDeepLink, null);
});

test('Email & Google Auth errors map to friendly, user-safe messages', () => {
  assert.match(toFriendlyAuthError({ code: 'auth/invalid-credential' }), /Incorrect email or password/i);
  assert.match(toFriendlyAuthError({ code: 'auth/email-already-in-use' }), /already exists/i);
  assert.match(toFriendlyAuthError({ code: 'auth/weak-password' }), /stronger password/i);
  assert.match(toFriendlyAuthError({ code: 'auth/popup-blocked' }), /popup was blocked/i);
  assert.match(toFriendlyAuthError({ code: 'auth/network-request-failed' }), /Network unavailable/i);

  assert.equal(isNetworkOrOfflineError({ code: 'unavailable' }), true);
  assert.equal(isPermissionDeniedError({ code: 'permission-denied' }), true);
});

test('Structured Firestore error helper records operationType, path, and auth context', () => {
  const info = buildFirestoreErrorInfo(
    new Error('Missing or insufficient permissions'),
    OperationType.WRITE,
    'users/u1/playlists/pl1',
    {
      uid: 'u1',
      email: 'u1@example.com',
      emailVerified: true,
      isAnonymous: false,
      providerData: [{ providerId: 'password', displayName: 'U1', email: 'u1@example.com', photoURL: null }],
    }
  );
  assert.equal(info.operationType, OperationType.WRITE);
  assert.equal(info.path, 'users/u1/playlists/pl1');
  assert.equal(info.authInfo.userId, 'u1');

  assert.throws(
    () => handleFirestoreError(new Error('permission-denied'), OperationType.GET, 'users/other', null),
    /operationType/
  );
});
