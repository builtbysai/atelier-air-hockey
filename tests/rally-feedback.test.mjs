import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const game = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');
const feel = await readFile(new URL('../src/feel-events.js', import.meta.url), 'utf8');
const rallySource = game.slice(game.indexOf('function noteRallyTouch(side) {'), game.indexOf('function onMalletHit('));

function harness(mode = 'workshop') {
  let clock = 0;
  const events = [], music = [];
  const state = {
    G: { state:'play', demo:false, mode, puck:{x:320,y:520},
      stats: { rally:0,bestRally:0,rallyLastSide:-1,rallyLastX:0,rallyLastY:0,rallyLastMs:0 } },
    performance: { now:()=>clock },
    Practice: { onRally:n=>events.push(n) },
    MusicSys: { setRally:x=>music.push(x) },
  };
  vm.runInNewContext(feel + '\n' + rallySource + '\nthis.touch = noteRallyTouch;', state);
  return {
    events, music, G:state.G,
    touch(side,x,y,ms) { state.G.puck.x=x; state.G.puck.y=y; clock=ms; state.touch(side); },
  };
}

test('only spaced alternating returns advance the real rally counter', () => {
  const h=harness();
  h.touch(0,320,520,1000); // first touch
  h.touch(0,500,520,1400); // same side, ignore
  h.touch(1,350,520,1500); // close scramble, ignore
  h.touch(1,1080,520,1700); // meaningful second return
  h.touch(1,1100,520,1900); // dribble, ignore
  h.touch(0,320,520,2100); // meaningful third
  assert.deepEqual(h.events,[1,2,3]);
  assert.equal(h.G.stats.bestRally,3);
});

test('Workshop stage resets accept the first touch after a fresh exchange', () => {
  const h=harness();
  h.touch(0,320,520,1000);
  h.touch(1,1050,520,1300);
  h.G.stats.rally=0; h.G.stats.rallyLastSide=-1;
  h.touch(0,320,520,1600);
  assert.deepEqual(h.events,[1,2,1]);
  const start=game.indexOf('  resetPoint(note) {');
  const end=game.indexOf('  complete() {',start);
  assert.match(game.slice(start,end),/G\.stats\.rally = 0; G\.stats\.rallyLastSide = -1/);
});

test('sound/music intensity is computed without intrusive rally text', () => {
  const h=harness('ai');
  let t=0;
  for(let n=1;n<=13;n++){
    const side=(n-1)%2;
    h.touch(side,side===0?320:1050,520,t+=240);
  }
  assert.equal(h.G.stats.rally,13);
  assert.equal(h.music[0],0);
  assert.ok(h.music.at(-1)>0.9);
  assert.doesNotMatch(rallySource,/addText|rallyHudN|rallyHudT/);
  assert.match(game,/MusicSys\.setRally\(0\)/);
  assert.match(game,/Feel\.goalRelease\(G\.stats \? G\.stats\.rally : 0\)/);
});

test('normal collision uses measured geometry; assisted escape stays ordinary', () => {
  assert.match(game,/noteRallyTouch\(m\.side\);[\s\S]{0,80}onMalletHit\(p\.x, p\.y, 500, nx, ny\)/);
  assert.match(game,/noteRallyTouch\(m\.side\);[\s\S]{0,80}onMalletHit\(p\.x, p\.y, 750, rx, ry\)/);
  assert.match(game,/normalSpeed:-vn, malletDrive:Math\.max\(0, mvn\), malletSpeed:msp0/);
  assert.match(game,/tangentialSpeed:rvx \* -ny \+ rvy \* nx/);
  assert.match(game,/onMalletHit\(p\.x, p\.y, impact, nx, ny, savedThisHit, \{/);
});

test('live-play effects never slow the host simulation or suppress the network pump', () => {
  assert.match(game,/else playStep\(rdt\);/);
  assert.doesNotMatch(game,/if \(G\.freezeT > 0\) \{ G\.freezeT -= rdt; render\(\); return;/);
  assert.doesNotMatch(game,/G\.dipT/);
});
