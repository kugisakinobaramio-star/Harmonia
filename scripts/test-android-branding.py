#!/usr/bin/env python3
"""Verify the generated Android project contains valid MusicKK launch branding."""
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

res = Path("android/app/src/main/res")
required = [
    res / "drawable" / "musick_splash_icon.xml",
    res / "drawable" / "musick_launch_background.xml",
    res / "values" / "colors.xml",
    res / "values" / "styles.xml",
]
missing = [str(path) for path in required if not path.is_file()]
if missing:
    sys.exit("Missing MusicKK splash resources: " + ", ".join(missing))

for path in required:
    ET.parse(path)

colors = ET.parse(res / "values" / "colors.xml").getroot()
color = colors.find("./color[@name='musick_splash_background']")
if color is None or (color.text or "").strip().lower() != "#050706":
    sys.exit("MusicKK splash background color is missing or incorrect")

styles = ET.parse(res / "values" / "styles.xml").getroot()
theme = styles.find("./style[@name='AppTheme.NoActionBarLaunch']")
if theme is None:
    sys.exit("MusicKK launch theme is missing")
if theme.get("parent") != "Theme.SplashScreen":
    sys.exit("MusicKK launch theme must use the generated AndroidX splash theme")
expected = {
    "android:background": "@drawable/musick_launch_background",
    "android:windowBackground": "@drawable/musick_launch_background",
    "windowSplashScreenBackground": "@color/musick_splash_background",
    "windowSplashScreenAnimatedIcon": "@drawable/musick_splash_icon",
    "postSplashScreenTheme": "@style/AppTheme.NoActionBar",
}
for name, value in expected.items():
    item = theme.find(f"./item[@name='{name}']")
    if item is None or (item.text or "").strip() != value:
        sys.exit(f"Incorrect launch theme item: {name}")

strings = ET.parse(res / "values" / "strings.xml").getroot()
label = strings.find("./string[@name='app_name']")
if label is None or (label.text or "").strip() != "MusicKK":
    sys.exit("Android launcher label must be MusicKK")

variables = Path("android/variables.gradle")
if not variables.is_file():
    sys.exit("Android variables.gradle is missing")
gradle_vars = variables.read_text(encoding="utf-8")
for key in ["rgcfaIncludeGoogle", "androidxCredentialsVersion", "androidxCredentialsPlayServicesAuthVersion"]:
    if key not in gradle_vars:
        sys.exit(f"Native Google authentication Gradle setting is missing: {key}")

google_services = Path("android/app/google-services.json")
app_gradle = Path("android/app/build.gradle")
if google_services.is_file():
    root_gradle = Path("android/build.gradle")
    if not root_gradle.is_file() or "com.google.gms:google-services" not in root_gradle.read_text(encoding="utf-8"):
        sys.exit("google-services.json exists but the Google Services Gradle classpath is missing")
    if not app_gradle.is_file() or "com.google.gms.google-services" not in app_gradle.read_text(encoding="utf-8"):
        sys.exit("google-services.json exists but the Google Services Gradle plugin is not applied")

print("MusicKK Android splash resources and native Firebase authentication build settings verified.")
