// Loads the dedicated server bundle (with test-only exports) as a real ES module.
import { bundle } from '../../infra/cloudflare/air-hockey-server/build.mjs';

export async function loadServer() {
  const src = await bundle({ test: true });
  const mod = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
  return mod;
}

/* Extract a top-level `function name(...) {...}` (brace matched) from source. */
export function extractFunction(source, name) {
  const start = source.search(new RegExp('^function ' + name + '\\(', 'm'));
  if (start < 0) throw new Error('function not found: ' + name);
  let i = source.indexOf('{', source.indexOf(')', start));
  let depth = 0;
  for (; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unbalanced function: ' + name);
}
