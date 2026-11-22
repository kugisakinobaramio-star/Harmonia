#!/usr/bin/env python3
"""Verify the generated Android project contains valid Musick launch branding."""
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
    sys.exit("Missing Musick splash resources: " + ", ".join(missing))

for path in required:
    ET.parse(path)

colors = ET.parse(res / "values" / "colors.xml").getroot()
color = colors.find("./color[@name='musick_splash_background']")
if color is None or (color.text or "").strip().lower() != "#050706":
    sys.exit("Musick splash background color is missing or incorrect")

styles = ET.parse(res / "values" / "styles.xml").getroot()
theme = styles.find("./style[@name='AppTheme.NoActionBarLaunch']")
if theme is None:
    sys.exit("Musick launch theme is missing")
if theme.get("parent") == "Theme.SplashScreen":
    sys.exit("Unexpected AndroidX splash theme dependency")
expected = {
    "android:background": "@drawable/musick_launch_background",
    "android:windowBackground": "@drawable/musick_launch_background",
}
for name, value in expected.items():
    item = theme.find(f"./item[@name='{name}']")
    if item is None or (item.text or "").strip() != value:
        sys.exit(f"Incorrect launch theme item: {name}")

print("Musick Android splash resources and theme verified.")
