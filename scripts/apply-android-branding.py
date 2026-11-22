#!/usr/bin/env python3
"""Apply Musick launcher icon resources to the generated Capacitor Android project."""
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
print("Applied Musick app label and adaptive/fallback launcher icons.")
