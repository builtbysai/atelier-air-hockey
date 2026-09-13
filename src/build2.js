// Build: node build2.js -> dist/air-hockey-atelier_v4.html (one self-contained file, 4 tables)
const fs = require('fs');
const path = require('path');
const src = p => fs.readFileSync(path.join(__dirname, 'src', p), 'utf8');

const template = src('template2.html');
const themeJs = src('themes.js');
const engineJs = src('engine2.js');

let html = template;
const rep = {
  '%%THEME_JS%%': themeJs,
  '%%ENGINE_JS%%': engineJs,
};
for (const [k, v] of Object.entries(rep)) html = html.split(k).join(v);

fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
const out = path.join(__dirname, 'dist', 'air-hockey-atelier_v4.html');
fs.writeFileSync(out, html);
console.log('wrote air-hockey-atelier_v4.html', (html.length / 1024).toFixed(1) + 'KB');
