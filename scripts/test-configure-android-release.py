#!/usr/bin/env python3
"""Exercise the release Gradle configurator against a generated-project fixture."""

import os
from pathlib import Path
import subprocess
import sys
import tempfile

configurator = Path(__file__).with_name("configure-android-release.py")
fixture = """apply plugin: 'com.android.application'

android {
    namespace "io.example.harmonia"
    defaultConfig {
        applicationId "io.example.harmonia"
        minSdkVersion 23
        targetSdkVersion 36
        versionCode 1
        versionName "1.0"
    }
    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }
}
"""

with tempfile.TemporaryDirectory() as directory:
    gradle = Path(directory) / "android" / "app" / "build.gradle"
    gradle.parent.mkdir(parents=True)
    gradle.write_text(fixture)

    env = os.environ.copy()
    env.update({
        "ANDROID_KEYSTORE_PATH": "/tmp/harmonia-release.jks",
        "ANDROID_KEYSTORE_PASSWORD": "fixture-store-password",
        "ANDROID_KEY_ALIAS": "harmonia",
        "ANDROID_KEY_PASSWORD": "fixture-key-password",
        "HARMONIA_VERSION_NAME": "1.2.3",
        "HARMONIA_VERSION_CODE": "456",
    })
    subprocess.run([sys.executable, str(configurator)], cwd=directory, env=env, check=True)

    configured = gradle.read_text()
    assert "signingConfigs {" in configured
    assert "signingConfig signingConfigs.release" in configured
    assert 'versionName "1.2.3"' in configured
    assert "versionCode 456" in configured
    assert "storeFile file(System.getenv('ANDROID_KEYSTORE_PATH'))" in configured

    # A second run must fail rather than silently duplicate signing configuration.
    duplicate = subprocess.run(
        [sys.executable, str(configurator)],
        cwd=directory,
        env=env,
        capture_output=True,
        text=True,
    )
    assert duplicate.returncode != 0
    assert "configured already" in duplicate.stderr or "configured already" in duplicate.stdout

print("Android release Gradle configuration test passed.")
