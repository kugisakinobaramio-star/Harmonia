import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFirestoreErrorInfo,
  handleFirestoreError,
  isNetworkOrOfflineError,
  isPermissionDeniedError,
  OperationType,
  toFriendlyAuthError,
} from './firebaseErrors';

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
