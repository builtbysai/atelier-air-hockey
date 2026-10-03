import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Every file the service worker precaches contributes to its cache identity.
// A content change must make sw.js byte-different so installed clients get a
// waiting worker and the safe update prompt can appear.
const coreFiles = [
  'index.html', 'manifest.webmanifest',
  'assets/icon.svg', 'assets/icon-maskable.svg',
  'assets/icon-180.png', 'assets/icon-192.png', 'assets/icon-512.png',
  'src/styles.css', 'src/themes.js', 'src/scoreboards.js',
  'src/vendor/qrcode.js', 'src/net.js', 'src/feel-events.js', 'src/game.js',
  'src/share.js', 'src/ui.js',
];

export async function appCacheName() {
  const hash = createHash('sha256');
  for (const path of coreFiles) {
    hash.update(path);
    const bytes = await readFile(new URL('../' + path, import.meta.url));
    // Git checkouts may use CRLF on Windows and LF in CI. The deployed text
    // is the same app, so its cache identity must be the same on both hosts.
    hash.update(path.endsWith('.png') ? bytes : bytes.toString('utf8').replace(/\r\n/g, '\n'));
  }
  const sw = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  hash.update(sw.replace(/\r\n/g, '\n').replace(/^const CACHE = '[^']+';/, "const CACHE = '<generated>';"));
  return 'atelier-air-hockey-' + hash.digest('hex').slice(0, 12);
}
