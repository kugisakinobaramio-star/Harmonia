# MusicKK Firebase Android setup

MusicKK keeps guest and offline use available without an account. Google sign-in on Android uses the native Firebase Authentication plugin (Credential Manager), then exchanges the returned Google ID token into the Firebase JavaScript SDK session that drives Firestore.

For the full Firebase picture (web, security rules, sync behaviour, troubleshooting) see **[firebase.md](./firebase.md)**.

## One-time Firebase Console setup

1. Open the Firebase project that matches `firebase-applet-config.json`.
2. In **Project settings → Your apps**, add an **Android app** with package ID `com.harmonia.music`. **Do not change the package ID** — existing installs and the application ID depend on it.
3. Add the **SHA-1** and **SHA-256** certificate fingerprints for:
   - the debug certificate you use for local builds
   - the existing MusicKK release signing certificate
   - (later) the Google Play App Signing certificate if you distribute through Play
4. In **Authentication → Sign-in method**, enable **Google**.
5. Download the updated `google-services.json` for the Android app. Confirm it contains:
   - package name `com.harmonia.music`
   - a Web OAuth client entry (needed for the ID-token exchange into the JS SDK)

Official reference: [Firebase Android Google sign-in](https://firebase.google.com/docs/auth/android/google-signin).

## Local Android build

1. After `npx cap add android` (or an existing Android project), place the downloaded file at:

   ```text
   android/app/google-services.json
   ```

2. Run:

   ```bash
   npm run android:sync
   ```

3. Build and install the debug APK as usual (`npm run android:open` or Android Studio).

The sync/build path validates that the file belongs to the configured Firebase project, contains the correct Android package ID, and includes the expected Web OAuth client ID when the validation script is present.

## GitHub Actions / CI

To let CI produce Android builds that include Firebase Google sign-in resources, create a repository secret:

| Secret | Value |
|---|---|
| `FIREBASE_ANDROID_GOOGLE_SERVICES_JSON_BASE64` | Base64-encoded contents of a valid `google-services.json` for `com.harmonia.music` |

The workflow should validate the JSON before generating Android resources. The public web config in `firebase-applet-config.json` is **not** a substitute for `google-services.json`.

Do **not** put service-account JSON, private keys, or other server credentials into the Android app or into repository secrets that end up in the client.

## Important invariants

- Keep `com.harmonia.music` unchanged so existing installations can receive normal updates.
- The Firebase JS SDK uses IndexedDB persistence inside the Capacitor WebView.
- Native Google sign-in is **not** considered verified until the Android app registration, certificate fingerprints, Google provider, OAuth client, and a real device test all succeed.
- Firestore rules are tested in CI with the local emulator. Publishing `firestore.rules` to the live Firebase project is a separate, deliberate step — never automatic.
- Guest mode and the local library must continue to work even if Firebase Auth or Firestore is unavailable.

## Quick checklist before claiming "Android sign-in works"

- [ ] Android app exists in Firebase Console with package `com.harmonia.music`
- [ ] Correct SHA-1 / SHA-256 fingerprints added
- [ ] Google sign-in provider enabled
- [ ] Fresh `google-services.json` installed under `android/app/`
- [ ] `npm run android:sync` succeeds
- [ ] Sign-in tested on a physical device (or emulator with Google Play services)
- [ ] Signed-in user can read/write their own Firestore data under the live (or intended) rules
