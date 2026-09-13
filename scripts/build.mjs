import { readFile, writeFile } from 'node:fs/promises';
const template = await readFile(new URL('../src/template.html', import.meta.url), 'utf8');
await writeFile(new URL('../index.html', import.meta.url), template);
console.log('Built index.html from src/template.html');
