import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const [game, ui, template] = await Promise.all([
  readFile(new URL('../src/game.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/ui.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/template.html', import.meta.url), 'utf8'),
]);

async function loadReplayMath() {
  const sb = await readFile(new URL('../src/scoreboards.js', import.meta.url), 'utf8');
  const canvasStub = { getContext: () => ({}), addEventListener() {}, style: {}, width: 0, height: 0 };
  const context = vm.createContext({
    console, Math, JSON,
    Net: { role:'host' },
    THEMES: {}, THEME_ORDER: [],
    THEME: { gold:'#c9a227', font:{ body:'sans-serif', display:'sans-serif' }, ink:'#fff' },
    document: {
      getElementById: () => canvasStub,
      createElement: () => ({ getContext: () => ({}), width:0, height:0, style:{}, classList:{ add(){}, remove(){} } }),
      addEventListener() {}, hidden:false, title:'',
    },
    window: { addEventListener() {}, devicePixelRatio:1, innerWidth:1440, innerHeight:900 },
    screen: {},
    navigator: {},
    requestAnimationFrame() {}, cancelAnimationFrame() {},
    localStorage: { getItem: () => null, setItem() {} },
    performance: { now: () => 0 },
  });
  vm.runInContext(`${sb}\n${game}
this.__replay = { replayAngle, replayLerp, replayMix, REPLAY_HZ, REPLAY_MAX };`,
    context, { filename:'src/game.js' });
  return context.__replay;
}

test('goal replay offer defaults on and is persisted with Settings', () => {
  assert.match(game, /instantReplay: 'goals'/);
  assert.match(game, /\['goals', 'off'\]\.includes\(Settings\.instantReplay\)/);
  assert.match(template, />Goal replay<\/div>/);
  assert.match(template, /data-set="instantReplay" data-val="off">Off<\/button>/);
  assert.match(template, /data-set="instantReplay" data-val="goals">Offer<\/button>/);
});

test('replay buffer is five seconds at 30 Hz', async () => {
  const R = await loadReplayMath();
  assert.equal(R.REPLAY_HZ, 30);
  assert.equal(R.REPLAY_MAX, 150);
});

test('snapshot interpolation is linear for bodies', async () => {
  const R = await loadReplayMath();
  const a = {
    puck:{ x:0,y:10,vx:20,vy:30,w:2,ang:0 },
    m1:{ x:0,y:0,vx:10,vy:20 },
    m2:{ x:100,y:200,vx:30,vy:40 },
    puckSq:0.8,puckSqA:0,
  };
  const b = {
    puck:{ x:100,y:30,vx:40,vy:50,w:6,ang:Math.PI },
    m1:{ x:20,y:40,vx:30,vy:40 },
    m2:{ x:200,y:300,vx:50,vy:60 },
    puckSq:1,puckSqA:Math.PI / 2,
  };
  const m = R.replayMix(a,b,0.5);
  assert.equal(m.puck.x,50);
  assert.equal(m.puck.y,20);
  assert.equal(m.m1.x,10);
  assert.equal(m.m2.y,250);
  assert.equal(m.puck.w,4);
  assert.ok(Math.abs(m.puckSq - 0.9) < 1e-12);
});

test('puck angle interpolation takes the shortest path across 360 degrees', async () => {
  const R = await loadReplayMath();
  const a = 350 * Math.PI / 180;
  const b = 10 * Math.PI / 180;
  const mid = R.replayAngle(a,b,0.5);
  const wrapped = ((mid % (Math.PI*2)) + Math.PI*2) % (Math.PI*2);
  assert.ok(wrapped < 1e-9 || Math.abs(wrapped - Math.PI*2) < 1e-9,
    '350 to 10 degrees should interpolate through 0, not through 180');
});

test('v1 replay is local-only and never sends network traffic', () => {
  const start = game.indexOf('const Replay = {');
  const end = game.indexOf('const pointers = new Map()', start);
  const replay = game.slice(start,end);
  assert.match(replay, /G\.mode === 'online'/);
  assert.doesNotMatch(replay, /Net\.send|Net\.wire|sendGoal/);
  assert.match(game, /Replay\.capture\(scorer\);[\s\S]*?beginGoalCeremony\(scorer\);/);
  assert.match(game, /if \(G\.mode === 'online'\) Net\.sendGoal\(scorer\)/);
});

test('replay uses an explicit replay state that freezes normal physics', () => {
  assert.match(game, /G\.state = 'replay'/);
  assert.match(game, /case 'replay':[\s\S]*?Replay\.update\(rdt\);[\s\S]*?break;/);
  assert.doesNotMatch(game, /case 'replay':[\s\S]{0,120}playStep/);
});

test('replay uses one visible HUD with progress, Skip, and Escape', () => {
  assert.match(template, /id="replayHud"/);
  assert.match(template, /id="replayProgress"/);
  assert.match(template, /id="replaySkip"[^>]*>Skip<\/button>/);
  assert.match(game, /replayHud/);
  assert.match(game, /replayProgress/);
  assert.match(game, /style\.transform = 'scaleX\('/);
  assert.match(ui, /replaySkip'\)\.addEventListener\('click', \(\) => Replay\.finish\(\)\)/);
  assert.match(ui, /G\.state === 'replay'\) Replay\.finish\(true\)/);
  assert.doesNotMatch(game, /drawPlaque\(ctx, CX, 128, 'REPLAY'\)/);
});


test('a goal celebrates first and only starts replay after an explicit choice', () => {
  assert.match(game, /Replay\.capture\(scorer\);[\s\S]*?Highlights\.recordGoal\(scorer, goalClip\);[\s\S]*?beginGoalCeremony\(scorer\);/);
  assert.doesNotMatch(game, /Replay\.start\(scorer\)/);
  assert.match(game, /const REPLAY_OFFER_AT = 1\.00/);
  assert.match(game, /const REPLAY_START_AT = 1\.28/);
  assert.match(game, /G\.goalT >= REPLAY_OFFER_AT && Replay\.hasPending\(\)/);
  assert.match(game, /Replay\.requested && G\.goalT >= REPLAY_START_AT/);
  assert.match(template, /id="replayOffer"/);
  assert.match(template, />Watch replay<\/span>/);
  assert.match(ui, /replayOffer'\)\.addEventListener\('click', \(\) => Replay\.request\(\)\)/);
});


test('mid-match replay prompts are player-relevant without discarding highlight clips', () => {
  const start = game.indexOf('capture(scorer)');
  const end = game.indexOf('hasPending()', start);
  const capture = game.slice(start, end);
  assert.match(capture, /const clip = this\.frames\.slice/);
  assert.match(capture, /Settings\.instantReplay === 'goals' && goalIsYours\(scorer\)/);
  assert.match(capture, /return clip/);
  assert.match(game, /function goalIsYours\(scorer\)/);
  assert.match(game, /G\.mode === '2p'\) return true/);
  assert.match(game, /G\.mode === 'watch'\) return false/);
  assert.match(game, /return scorer === 0/);
});

test('winning goal replay is offered from results instead of interrupting celebration', () => {
  assert.match(template, /id="btnWinReplay"[^>]*>Watch winning goal<\/button>/);
  assert.match(game, /btnWinReplay/);
  assert.match(ui, /btnWinReplay'\)\.addEventListener\('click', \(\) => Replay\.startPending\('win'\)\)/);
});


test('ignoring replay never delays the next serve', () => {
  assert.match(game, /const keepOffer = !winningGoal && Replay\.hasPending\(\)/);
  assert.match(game, /startCount\(\);[\s\S]*?Replay\.keepOfferDuringCount\(1\.0\)/);
  assert.match(game, /tickOffer\(dt\)/);
  assert.match(game, /offerT <= 0\) this\.discardPending\(\)/);
});

test('choosing replay during countdown restarts the normal post-goal flow afterwards', () => {
  assert.match(game, /if \(G\.state === 'count'\) this\.startPending\('goal'\)/);
  const start = game.indexOf('finish(forceExit = false) {', game.indexOf('const Replay = {'));
  const end = game.indexOf('applyFrame()', start);
  const finish = game.slice(start, end);
  assert.match(finish, /advanceAfterGoal\(\)/);
});

test('online mode never produces a replay clip or prompt', () => {
  const start = game.indexOf('capture(scorer)');
  const end = game.indexOf('hasPending()', start);
  assert.match(game.slice(start, end), /G\.mode === 'online'/);
});