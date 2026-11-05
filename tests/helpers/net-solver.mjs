// The shared mallet/puck normal-contact solver is defined once, in src/net.js.
// Tests that load game.js in a sandbox WITHOUT net.js (they stub `Net`) need
// the same functions the browser gets from the net.js script tag. Extract the
// real source instead of keeping a second copy.
import { readFile } from 'node:fs/promises';

export async function malletSolverSource() {
  const net = await readFile(new URL('../../src/net.js', import.meta.url), 'utf8');
  const start = net.indexOf('function malletImpulseVelocity(');
  const solver = net.indexOf('function solveMalletImpulse(');
  const end = net.indexOf('\n}\n', solver) + 3;
  if (start < 0 || solver < 0 || end < 3) throw new Error('shared mallet solver not found in src/net.js');
  return net.slice(start, end);
}
