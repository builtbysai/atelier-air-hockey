import { readFile, writeFile } from 'node:fs/promises';
import { appCacheName } from './app-version.mjs';
const template = await readFile(new URL('../src/template.html', import.meta.url), 'utf8');
await writeFile(new URL('../index.html', import.meta.url), template);
const swUrl = new URL('../sw.js', import.meta.url);
const sw = await readFile(swUrl, 'utf8');
const next = sw.replace(/^const CACHE = '[^']+';/, `const CACHE = '${await appCacheName()}';`);
if (next === sw && !/^const CACHE = 'atelier-air-hockey-[a-f0-9]{12}';/.test(sw))
  throw new Error('Could not update service worker cache identity');
if (next !== sw) await writeFile(swUrl, next);
console.log('Built index.html from src/template.html');
