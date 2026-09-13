// Build: node build3.js -> dist/air-hockey-atelier_v5.html
// One self-contained file: 6 tables, 4 scoreboard devices, pre-rendered rooms.
const fs = require('fs');
const path = require('path');
const src = p => fs.readFileSync(path.join(__dirname, 'src', p), 'utf8');

const template = src('template2.html');

let html = template;
const rep = {
  '%%THEME_JS%%': src('themes.js'),
  '%%THEME2_JS%%': src('themes2.js'),
  '%%BOARD_JS%%': src('scoreboards.js'),
  '%%ENGINE_JS%%': src('engine2.js'),
};
for (const [k, v] of Object.entries(rep)) {
  if (!html.includes(k)) { console.error('MISSING PLACEHOLDER: ' + k); process.exit(1); }
  html = html.split(k).join(v);
}

fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
const out = path.join(__dirname, 'dist', 'air-hockey-atelier_v5.html');
fs.writeFileSync(out, html);
console.log('wrote air-hockey-atelier_v5.html', (html.length / 1024).toFixed(1) + 'KB');
