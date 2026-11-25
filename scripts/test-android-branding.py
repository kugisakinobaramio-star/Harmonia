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

manifest = Path("android/app/src/main/AndroidManifest.xml")
if manifest.is_file():
    ANDROID_NS = "http://schemas.android.com/apk/res/android"
    m_root = ET.parse(manifest).getroot()
    found_oauth = False
    for data_node in m_root.findall(".//intent-filter/data"):
        if (
            data_node.get(f"{{{ANDROID_NS}}}scheme") == "com.harmonia.music"
            and data_node.get(f"{{{ANDROID_NS}}}host") == "auth"
        ):
            found_oauth = True
            break
    if not found_oauth:
        sys.exit("AndroidManifest.xml is missing com.harmonia.music://auth deep-link intent-filter")

print("MusicKK Android splash resources, theme, and OAuth manifest verified.")

