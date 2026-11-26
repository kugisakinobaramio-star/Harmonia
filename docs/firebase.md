# MusicKK Firebase guide

Firebase is **optional**. MusicKK works fully in guest mode with a local library. Signing in enables cross-device sync of likes, playlists, listening history and preferences.

Firebase is **not** a music streaming provider. Catalogue search and playback still come from the providers listed in the README and in `src/server/providers/types.ts`.

## What Firebase is used for

| Feature | Service | Required for basic use? |
|---|---|---|
| Guest / offline library | Local storage only | No |
| Google / email sign-in | Firebase Authentication | No |
| Cloud sync of library & playlists | Cloud Firestore | No (optional) |
| Android native Google UI | Capacitor Firebase Authentication + Credential Manager | Only if you want Google sign-in on Android |

## Configuration files

| File | Purpose |
|---|---|
| `firebase-applet-config.json` | Public web client config (apiKey, projectId, authDomain, etc.). Safe to ship in the client. |
| `android/app/google-services.json` | Android-specific Firebase config. **Not** committed; obtained from Firebase Console. |
| `firestore.rules` | Server-side security rules. Tested in CI with the emulator. Live deploy is a separate deliberate step. |
| `security_spec.md` | Human-readable security invariants and the "dirty dozen" attack cases that must be denied. |
| `docs/firebase-android-setup.md` | Short Android-focused checklist. |

Never commit service-account keys, private keys, or signing keystores.

## Web setup (already wired)

1. The web client reads `firebase-applet-config.json`.
2. Google and email/password providers must be enabled in the Firebase Console (Authentication → Sign-in method).
3. Authorized domains for the hosting origin (Cloudflare Workers / localhost) must be listed under Authentication → Settings → Authorized domains.
4. Guest mode continues to work if Firebase is misconfigured; only signed-in sync is affected.

## Android setup

See **[firebase-android-setup.md](./firebase-android-setup.md)** for the full checklist.

Key points:

- Package ID must stay `com.harmonia.music`.
- Add SHA-1 and SHA-256 fingerprints for debug and release certificates.
- Place `google-services.json` at `android/app/google-services.json`.
- CI can inject the file via the `FIREBASE_ANDROID_GOOGLE_SERVICES_JSON_BASE64` secret.
- Native Google sign-in uses Credential Manager, then exchanges the ID token into the existing Firebase JS Auth session used by Firestore.

Physical device testing is required before claiming Android sign-in is production-ready.

## Cloud sync behaviour

- Sync is **opt-in** after sign-in.
- Local data remains the source of truth when offline; queued changes retry later.
- Before uploading, the client reconciles with the latest Firestore snapshot so a stale device is less likely to overwrite newer data from another device.
- Track snapshots stored in Firestore must **not** contain temporary stream URLs, preview URLs, YouTube IDs or lyrics (see `security_spec.md` and the sanitizer in `src/lib/cloudSanitizer.ts`).
- Account migration / merge should preview differences and create a local backup before applying.

## Security rules

- Rules live in `firestore.rules`.
- Invariants and required denials are documented in `security_spec.md`.
- CI runs the Firestore emulator suite (`npm run test:firestore-rules` and the unit tests under `src/lib/`).
- Publishing rules to the live project is **not** automatic. Review and deploy deliberately.

Do not weaken rules to "make sync work". Fix the client or the data shape instead.

## Troubleshooting

### Sign-in works on web but not on Android

1. Confirm an Android app with package `com.harmonia.music` exists in the Firebase project.
2. Confirm SHA-1 / SHA-256 for the exact keystore used to sign the APK.
3. Confirm Google provider is enabled.
4. Confirm `google-services.json` is present and matches the project + package.
5. Rebuild after changing fingerprints or the JSON file (`npm run android:sync`).

### Cloud sync fails with permission errors

1. Confirm the user is actually signed in (`auth.currentUser`).
2. Confirm the live Firestore rules match the tested `firestore.rules` (or the emulator rules you intend).
3. Confirm the client is writing only allowed fields and never stream URLs.
4. Check that the correct Firestore database ID is used (`firestoreDatabaseId` in the applet config).

### Guest mode still works but nothing syncs

Expected when the user is not signed in, or when Firebase Auth / Firestore is unreachable. Local library and offline downloads continue to function.

### "Missing or invalid google-services.json" in CI

Set the repository secret `FIREBASE_ANDROID_GOOGLE_SERVICES_JSON_BASE64` to the base64 encoding of a valid `google-services.json` for package `com.harmonia.music`.

## Related code

- `src/lib/firebase.ts` — app init, auth helpers, native Google bridge
- `src/lib/firestoreSync.ts` / `src/lib/syncEngine.ts` / `src/lib/useCloudSync.ts` — sync engine
- `src/lib/cloudSanitizer.ts` — strips non-persistable fields before cloud write
- `src/lib/firebaseErrors.ts` — user-facing error mapping
- `security_spec.md` — security contract

## Safety reminders

- Never put private provider tokens or temporary stream URLs into Firestore.
- Never change `com.harmonia.music` without a deliberate migration plan.
- Never disable or loosen Firestore rules to unblock a client bug.
- Always test rules with the emulator before any live deploy.
