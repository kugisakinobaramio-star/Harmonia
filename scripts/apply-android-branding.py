#!/usr/bin/env python3
"""Apply Musick launcher and native Android splash branding to generated Capacitor resources."""
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

res = Path("android/app/src/main/res")
if not res.is_dir():
    sys.exit("Generated Android resources directory is missing")

values = res / "values" / "strings.xml"
if not values.is_file():
    sys.exit("Generated Android strings.xml is missing")
tree = ET.parse(values)
root = tree.getroot()
app_name = root.find("./string[@name='app_name']")
if app_name is None:
    sys.exit("Could not find app_name in generated Android strings.xml")
app_name.text = "Musick"
tree.write(values, encoding="utf-8", xml_declaration=True)

drawable = res / "drawable"
drawable.mkdir(parents=True, exist_ok=True)
(drawable / "ic_musick_foreground.xml").write_text("""<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="128" android:viewportHeight="128">
<path android:fillColor="#62F58A" android:pathData="M25,91V37h16l23,28 23,-28h16v54H87V59L64,87 41,59v32H25Z"/>
</vector>
""", encoding="utf-8")
(drawable / "ic_musick_background.xml").write_text("""<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle"><solid android:color="#050706"/></shape>
""", encoding="utf-8")

adaptive = res / "mipmap-anydpi-v26"
adaptive.mkdir(parents=True, exist_ok=True)
(adaptive / "ic_launcher.xml").write_text("""<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
<background android:drawable="@drawable/ic_musick_background"/>
<foreground android:drawable="@drawable/ic_musick_foreground"/>
</adaptive-icon>
""", encoding="utf-8")
(adaptive / "ic_launcher_round.xml").write_text((adaptive / "ic_launcher.xml").read_text(encoding="utf-8"), encoding="utf-8")

fallback = res / "mipmap-anydpi"
fallback.mkdir(parents=True, exist_ok=True)
(fallback / "ic_launcher.xml").write_text("""<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="128" android:viewportHeight="128">
<path android:fillColor="#050706" android:pathData="M0,0h128v128H0z"/>
<path android:fillColor="#62F58A" android:pathData="M25,91V37h16l23,28 23,-28h16v54H87V59L64,87 41,59v32H25Z"/>
</vector>
""", encoding="utf-8")
(fallback / "ic_launcher_round.xml").write_text((fallback / "ic_launcher.xml").read_text(encoding="utf-8"), encoding="utf-8")

# Native launch artwork: Android 12+ uses the system splash with the launcher
# icon and a solid background; Android 11 and earlier use the centered layer-list.
(drawable / "musick_splash_icon.xml").write_text("""<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="128dp"
    android:height="128dp"
    android:viewportWidth="128"
    android:viewportHeight="128">
    <path
        android:fillColor="#62F58A"
        android:pathData="M25,91V37h16l23,28 23,-28h16v54H87V59L64,87 41,59v32H25Z"/>
</vector>
""", encoding="utf-8")
(drawable / "musick_launch_background.xml").write_text("""<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/musick_splash_background"/>
    <item
        android:width="112dp"
        android:height="112dp"
        android:gravity="center"
        android:drawable="@drawable/musick_splash_icon"/>
</layer-list>
""", encoding="utf-8")

colors = res / "values" / "colors.xml"
colors.parent.mkdir(parents=True, exist_ok=True)
if colors.exists():
    colors_tree = ET.parse(colors)
    colors_root = colors_tree.getroot()
else:
    colors_root = ET.Element("resources")
    colors_tree = ET.ElementTree(colors_root)
splash_color = colors_root.find("./color[@name='musick_splash_background']")
if splash_color is None:
    splash_color = ET.SubElement(colors_root, "color", {"name": "musick_splash_background"})
splash_color.text = "#050706"
colors_tree.write(colors, encoding="utf-8", xml_declaration=True)

styles = res / "values" / "styles.xml"
if not styles.is_file():
    sys.exit("Generated Android styles.xml is missing")
styles_tree = ET.parse(styles)
styles_root = styles_tree.getroot()
launch_theme = styles_root.find("./style[@name='AppTheme.NoActionBarLaunch']")
if launch_theme is None:
    sys.exit("Could not find AppTheme.NoActionBarLaunch in generated Android styles.xml")
def set_style_item(style, name, value):
    item = style.find(f"./item[@name='{name}']")
    if item is None:
        item = ET.SubElement(style, "item", {"name": name})
    item.text = value

set_style_item(launch_theme, "android:background", "@drawable/musick_launch_background")
set_style_item(launch_theme, "android:windowBackground", "@drawable/musick_launch_background")
styles_tree.write(styles, encoding="utf-8", xml_declaration=True)

# Android 12+ draws the app's launcher icon in its system splash. Keep its
# window background a solid color so the legacy centered logo is not doubled.
v31 = res / "values-v31"
v31.mkdir(parents=True, exist_ok=True)
(v31 / "styles.xml").write_text("""<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme.NoActionBarLaunch" parent="AppTheme.NoActionBar">
        <item name="android:background">@color/musick_splash_background</item>
        <item name="android:windowBackground">@color/musick_splash_background</item>
    </style>
</resources>
""", encoding="utf-8")

print("Applied Musick launcher icons and native splash screen branding.")
