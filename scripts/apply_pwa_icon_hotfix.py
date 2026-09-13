#!/usr/bin/env python3
from pathlib import Path
import json

manifest = {
  "id": "./",
  "name": "Atelier Air Hockey",
  "short_name": "Air Hockey",
  "description": "A handcrafted browser air-hockey game with nine art-directed tables.",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "orientation": "any",
  "background_color": "#070606",
  "theme_color": "#070606",
  "prefer_related_applications": False,
  "icons": [
    {"src": "./assets/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
    {"src": "./assets/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
    {"src": "./assets/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
    {"src": "./assets/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any"}
  ]
}
Path('manifest.webmanifest').write_text(json.dumps(manifest, indent=2) + '\n')

template_path = Path('src/template.html')
template = template_path.read_text()
old = '<link rel="icon" type="image/svg+xml" sizes="any" href="./assets/icon.svg">'
new = old + '\n<link rel="apple-touch-icon" sizes="180x180" href="./assets/icon-180.png">'
if template.count(old) != 1:
    raise SystemExit(f'template icon anchor expected once, found {template.count(old)}')
template_path.write_text(template.replace(old, new, 1))

sw_path = Path('sw.js')
sw = sw_path.read_text()
sw = sw.replace("const CACHE='atelier-air-hockey-v24';", "const CACHE='atelier-air-hockey-v24.1';", 1)
old_core = "'./manifest.webmanifest','./assets/icon.svg','./src/styles.css'"
new_core = "'./manifest.webmanifest','./assets/icon.svg','./assets/icon-180.png','./assets/icon-192.png','./assets/icon-512.png','./src/styles.css'"
if sw.count(old_core) != 1:
    raise SystemExit(f'service-worker core anchor expected once, found {sw.count(old_core)}')
sw_path.write_text(sw.replace(old_core, new_core, 1))

check_path = Path('scripts/check.mjs')
check = check_path.read_text()
anchor = "assert.match(themes, /THEMES\\.deco/); assert.match(css, /focus-visible/);\n"
insert = anchor + "const manifest = await readFile('manifest.webmanifest','utf8');\nassert.match(manifest, /icon-192\\.png/); assert.match(manifest, /icon-512\\.png/); assert.match(manifest, /\\\"id\\\"\\s*:\\s*\\\"\\.\\/\\\"/);\nassert.match(template, /apple-touch-icon/);\n"
if check.count(anchor) != 1:
    raise SystemExit(f'check anchor expected once, found {check.count(anchor)}')
check_path.write_text(check.replace(anchor, insert, 1))

print('PWA icon compatibility hotfix applied')
