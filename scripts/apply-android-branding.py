#!/usr/bin/env python3
"""Apply MusicKK launcher and native Android splash branding to generated Capacitor resources."""
from pathlib import Path
import json
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
app_name.text = "MusicKK"
tree.write(values, encoding="utf-8", xml_declaration=True)

drawable = res / "drawable"
drawable.mkdir(parents=True, exist_ok=True)
(drawable / "ic_musick_foreground.xml").write_text("""<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="128" android:viewportHeight="128">
<path android:fillColor="#62F58A" android:pathData="M15,65h12l8,-19 12,39 12,-54 12,67 12,-49 9,26 8,-10h13"/>
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
<path android:fillColor="#62F58A" android:pathData="M15,65h12l8,-19 12,39 12,-54 12,67 12,-49 9,26 8,-10h13"/>
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
        android:pathData="M15,65h12l8,-19 12,39 12,-54 12,67 12,-49 9,26 8,-10h13"/>
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
set_style_item(launch_theme, "windowSplashScreenBackground", "@color/musick_splash_background")
set_style_item(launch_theme, "windowSplashScreenAnimatedIcon", "@drawable/musick_splash_icon")
set_style_item(launch_theme, "postSplashScreenTheme", "@style/AppTheme.NoActionBar")
styles_tree.write(styles, encoding="utf-8", xml_declaration=True)

# Enable the Google Credential Manager implementation in the native plugin.
# The Firebase Android app's google-services.json is supplied from CI configuration
# or added locally after registering package com.harmonia.music in Firebase Console.
variables = Path("android/variables.gradle")
if not variables.is_file():
    sys.exit("Generated Android variables.gradle is missing")
gradle_vars = variables.read_text(encoding="utf-8")
required_vars = {
    "rgcfaIncludeGoogle": "true",
    "androidxCredentialsVersion": "'1.3.0'",
    "androidxCredentialsPlayServicesAuthVersion": "'1.3.0'",
}
for key, value in required_vars.items():
    if key not in gradle_vars:
        gradle_vars = gradle_vars.replace("ext {", f"ext {{\n    {key} = {value}", 1)
variables.write_text(gradle_vars, encoding="utf-8")

google_services = Path("android/app/google-services.json")
if google_services.is_file():
    try:
        google_data = json.loads(google_services.read_text(encoding="utf-8"))
        expected_project = json.loads(Path("firebase-applet-config.json").read_text(encoding="utf-8")).get("projectId")
    except (OSError, json.JSONDecodeError) as exc:
        sys.exit(f"Firebase Android configuration is not valid JSON: {exc}")

    if google_data.get("project_info", {}).get("project_id") != expected_project:
        sys.exit("google-services.json belongs to a different Firebase project than firebase-applet-config.json")

    android_clients = [
        client for client in google_data.get("client", [])
        if client.get("client_info", {}).get("android_client_info", {}).get("package_name") == "com.harmonia.music"
    ]
    if not android_clients:
        sys.exit("google-services.json does not contain the Android package com.harmonia.music")
    web_client_ids = [
        oauth.get("client_id")
        for client in android_clients
        for oauth in client.get("oauth_client", [])
        if oauth.get("client_type") == 3 and oauth.get("client_id")
    ]
    if not web_client_ids:
        sys.exit("google-services.json is missing the Web OAuth client ID required by Credential Manager")

    root_gradle = Path("android/build.gradle")
    if not root_gradle.is_file():
        sys.exit("Generated Android root build.gradle is missing")
    root_text = root_gradle.read_text(encoding="utf-8")
    plugin_classpath = "classpath 'com.google.gms:google-services:4.4.4'"
    if plugin_classpath not in root_text:
        if "dependencies {" not in root_text:
            sys.exit("Could not find dependencies block in Android root build.gradle")
        root_text = root_text.replace(
            "dependencies {",
            "dependencies {\n        " + plugin_classpath,
            1,
        )
        root_gradle.write_text(root_text, encoding="utf-8")

    app_gradle = Path("android/app/build.gradle")
    if not app_gradle.is_file():
        sys.exit("Generated Android app/build.gradle is missing")
    app_text = app_gradle.read_text(encoding="utf-8")
    google_plugin = "apply plugin: 'com.google.gms.google-services'"
    if google_plugin not in app_text:
        app_gradle.write_text(app_text.rstrip() + "\n\n" + google_plugin + "\n", encoding="utf-8")
else:
    print("WARNING: google-services.json not supplied; Android Google sign-in requires Firebase Android app registration before runtime use.")

print("Applied MusicKK launcher branding and native Firebase Google authentication build settings.")
