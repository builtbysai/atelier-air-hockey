import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const feelSrc=readFileSync(new URL('../src/feel-events.js',import.meta.url),'utf8');
const game=readFileSync(new URL('../src/game.js',import.meta.url),'utf8');
const net=readFileSync(new URL('../src/net.js',import.meta.url),'utf8');
const Feel=vm.runInNewContext(feelSrc+'\nFeel;');
test('a directional wave begins immediately, fades smoothly and never persists beyond 170ms',()=>{
  const first=Feel.goalWave(0),middle=Feel.goalWave(0.09);
  assert.ok(first && first.alpha>0.2 && first.alpha<0.3);
  assert.ok(middle && middle.alpha<first.alpha);
  assert.ok(middle.advance>first.advance);
  assert.ok(middle.span>first.span);
  assert.ok(Feel.goalWave(0.169).alpha<0.001);
  assert.equal(Feel.goalWave(0.17),null);
  assert.equal(Feel.goalWave(0.8),null);
  assert.equal(Feel.goalWave(-1),null);
  assert.equal(Feel.goalWave(NaN),null);
  assert.equal(Object.isFrozen(first),true);
});
const start=game.indexOf('function goalWavePaths() {');
const end=game.indexOf('function drawGoalWaveFlat(',start);
assert.ok(start>=0 && end>start);
function getPaths(side, reduce=false) {
  const G={state:'goal',goalSide:side,goalT:0.04,goalShockY:551};
  const sandbox={G,PX:200,PW:1040,CY:520,Feel,clamp:(v,a,b)=>Math.min(b,Math.max(a,v)),
    goalW:()=>200,fxFlash:()=>!reduce};
  const fn=vm.runInNewContext(game.slice(start,end)+'\ngoalWavePaths;',sandbox);
  return fn();
}
test('shared world geometry travels into the scored-on goal for both sides',()=>{
  const right=getPaths(0),left=getPaths(1);
  assert.equal(right.paths.length,3);
  assert.equal(left.paths.length,3);
  for(const path of right.paths){assert.equal(path.length,7);assert.ok(path.every(p=>p[0]>1240 && p[1]>=420 && p[1]<=620));}
  for(const path of left.paths)assert.ok(path.every(p=>p[0]<200 && p[1]>=420 && p[1]<=620));
  assert.ok(right.alpha<=0.27);
});
test('minimal/reduced effects avoid the work and geometry is never sent to physics',()=>{
  assert.equal(getPaths(0,true),null);
  assert.match(game,/if \(G.state !== 'goal' \|\| !fxFlash\(\)\) return null;/);
  assert.match(game,/drawGoalWaveFlat\(c\);/);
  assert.match(game,/drawGoalWave25\(cam\);/);
  assert.match(game,/camProject\(cam,x,y,0\)/);
  assert.doesNotMatch(game.slice(start,end),/G\.puck\s*=|G\.puck\.|G\.timeScale\s*=/);
});
test('online goal event carries a scalar crossing point and clamps it on presentation',()=>{
  assert.match(net,/gy: Math\.round\(G\.goalShockY\)/);
  assert.match(net,/Number\.isFinite\(ev\.gy\) \? ev\.gy : null/);
  assert.match(game,/G\.goalShockY = clamp\(crossingY, CY - goalW\(\)\/2 \+ 18, CY \+ goalW\(\)\/2 - 18\)/);
});
