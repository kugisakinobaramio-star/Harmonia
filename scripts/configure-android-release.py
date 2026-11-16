#!/usr/bin/env python3
"""Configure the generated Capacitor Android Gradle project for a signed release."""

from pathlib import Path
import os
import re
import sys

gradle = Path("android/app/build.gradle")
if not gradle.is_file():
    sys.exit("android/app/build.gradle was not generated")

text = gradle.read_text()
required = ("ANDROID_KEYSTORE_PATH", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD")
missing = [name for name in required if not os.environ.get(name)]
if missing:
    sys.exit("Missing signing environment variables: " + ", ".join(missing))

if "signingConfigs" in text and "signingConfigs.release" in text:
    sys.exit("Release signing appears to be configured already; refusing to inject it twice")

build_types = re.search(r"(?m)^\s*buildTypes\s*\{", text)
if not build_types:
    sys.exit("Could not find buildTypes block in generated app/build.gradle")

signing = """    signingConfigs {
        release {
            storeFile file(System.getenv('ANDROID_KEYSTORE_PATH'))
            storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')
            keyAlias System.getenv('ANDROID_KEY_ALIAS')
            keyPassword System.getenv('ANDROID_KEY_PASSWORD')
        }
    }

"""
text = text[:build_types.start()] + signing + text[build_types.start():]

# Locate the release block inside buildTypes and attach the release signing config.
build_types = re.search(r"(?m)^\s*buildTypes\s*\{", text)
release = re.search(r"(?m)^\s*release\s*\{", text[build_types.end():])
if not release:
    sys.exit("Could not find release build type in generated app/build.gradle")
release_start = build_types.end() + release.end()
text = text[:release_start] + "\n            signingConfig signingConfigs.release" + text[release_start:]

version_name = os.environ.get("HARMONIA_VERSION_NAME")
version_code = os.environ.get("HARMONIA_VERSION_CODE")
if not version_name or not version_code or not version_code.isdigit():
    sys.exit("Missing or invalid release version environment variables")

if not re.search(r"(?m)^\s*versionName\s+", text):
    sys.exit("Could not find versionName in generated app/build.gradle")
if not re.search(r"(?m)^\s*versionCode\s+", text):
    sys.exit("Could not find versionCode in generated app/build.gradle")

text = re.sub(r'(?m)^(\s*versionName\s+).*$', lambda m: m.group(1) + '"' + version_name + '"', text, count=1)
text = re.sub(r"(?m)^(\s*versionCode\s+).*?$", lambda m: m.group(1) + version_code, text, count=1)
gradle.write_text(text)
print(f"Configured signed Harmonia release v{version_name} (versionCode {version_code}).")
