# MusicKK Firebase Android setup

MusicKK keeps guest/offline use available. Google sign-in on Android uses the native Firebase Authentication plugin, then exchanges the returned Google ID token into the Firebase JavaScript SDK session used by Firestore.

## One-time Firebase Console setup

1. Open the Firebase project that matches `firebase-applet-config.json`.
2. In Project settings → Your apps, add an **Android app** with package ID `com.harmonia.music`. Do not change the package ID.
3. Add the SHA-1 and SHA-256 certificate fingerprints for the debug certificate and the existing MusicKK release signing certificate. If the app is distributed through Google Play later, also add the Play App Signing certificate fingerprints.
4. In Authentication → Sign-in method, enable **Google**.
5. Download the updated `google-services.json` for the Android app. Confirm it contains package `com.harmonia.music` and a Web OAuth client entry.

Google's official setup requires an Android Firebase app, SHA certificate fingerprint, Google provider enabled, and the refreshed `google-services.json`: https://firebase.google.com/docs/auth/android/google-signin

## Local Android build

1. Place the downloaded file at `android/app/google-services.json` (after `npx cap add android` has generated the Android project).
2. Run `npm run android:sync`.
3. Build and install the debug APK as usual.

The build script validates that the file belongs to the configured Firebase project, contains the correct Android package ID, and includes the Web OAuth client ID.

## GitHub Actions

For CI to build Android Google sign-in with the Firebase Android resources, create a repository Actions secret named `FIREBASE_ANDROID_GOOGLE_SERVICES_JSON_BASE64` containing the base64-encoded contents of the downloaded `google-services.json`. The workflow validates the JSON before generating Android resources.

The Firebase web configuration in `firebase-applet-config.json` is not a substitute for `google-services.json`. Do not put service-account JSON, private keys, or other server credentials in the Android app.

## Important

- Keep `com.harmonia.music` unchanged so existing installs remain compatible.
- The Firebase JS SDK uses IndexedDB persistence in the Capacitor app.
- Native Google sign-in is not considered verified until the Android app registration, certificate fingerprints, Google provider, and OAuth client are configured and tested on a device.
- Firestore rules are tested in CI with the local Firestore emulator. Publishing `firestore.rules` to the live Firebase project remains a separate, deliberate deployment step.
