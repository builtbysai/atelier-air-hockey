import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

function memoryStorage() {
  const data = new Map();
  return {
    getItem:key => data.has(key) ? data.get(key) : null,
    setItem:(key,value) => data.set(key, String(value)),
    removeItem:key => data.delete(key),
    has:key => data.has(key),
  };
}

async function loadNet() {
  const source = await readFile(new URL('../src/net.js', import.meta.url), 'utf8');
  const localStorage = memoryStorage();
  const G = {
    state:'play', pausedFrom:'play', winSide:0, gwNet:0,
    puck:{x:500,y:300,vx:700,vy:-40,w:0.2,ang:1.1},
    m1:{x:300,y:300,tx:310,ty:300,vx:120,vy:0},
    m2:{x:900,y:300,tx:890,ty:300,vx:-100,vy:0},
    score:[3,2], serveVX:500, serveVY:20, serveDir:1,
    countT:0, countN:3, goPlayed:false,
    goalT:0, goalSlowT:0, goalSide:0, timeScale:1,
    stats:{
      topSpeed:2100,rally:4,bestRally:11,bestGoalRally:8,bankGoals:[1,0],
      rallyLastSide:1,saves:[3,2],t0:0,streak:[1,0],bestStreak:[2,1],worstDef:[-1,0],
    },
  };
  const context = {
    console, Math, Date, Promise, URL, TextEncoder, Uint8Array, ArrayBuffer, DataView, Set,
    setTimeout, clearTimeout, performance, localStorage, G,
    Settings:{firstTo:7,pace:'classic',goalW:'standard'},
    THEME:{id:'deco'},
  };
  vm.createContext(context);
  vm.runInContext(source + '\nthis.__Net = Net;', context, {filename:'src/net.js'});
  return {Net:context.__Net, G, localStorage};
}

test('session id validation rejects short or malformed resurrection ids', async () => {
  const {Net} = await loadNet();
  assert.equal(Net.validSessionId('short'), false);
  assert.equal(Net.validSessionId('abc<script>abcdefghijkl'), false);
  assert.equal(Net.validSessionId('abcdefghijklmnopqrstuvwx'), true);
});

test('guest checkpoint is short lived and contains no guest-authored authority state', async () => {
  const {Net, localStorage} = await loadNet();
  Net.active = true; Net.role = 'guest'; Net.code = 'ABC234';
  Net.sessionId = 'abcdefghijklmnopqrstuvwx';
  Net.matchStarted = true;
  Net._localPlayer = {id:'player1234567890',name:'PLAYER 7890'};

  const checkpoint = Net.buildSessionCheckpoint();
  assert.equal(checkpoint.role, 'guest');
  assert.equal(checkpoint.code, 'ABC234');
  assert.equal(checkpoint.sid, Net.sessionId);
  assert.equal(checkpoint.authority, null);
  assert.equal(checkpoint.expiresAt - checkpoint.savedAt, 45000);

  assert.equal(Net.saveSessionCheckpoint(), true);
  assert.equal(localStorage.has('atelier-ah-session-v1'), true);
  assert.equal(Net.readSessionCheckpoint(checkpoint.savedAt + 1000).code, 'ABC234');
  assert.equal(Net.readSessionCheckpoint(checkpoint.expiresAt + 1), null);
  assert.equal(localStorage.has('atelier-ah-session-v1'), false);
});

test('host checkpoint carries authoritative score, puck, mallets and stats', async () => {
  const {Net, G} = await loadNet();
  Net.active = true; Net.role = 'host'; Net.code = 'XYZ678';
  Net.sessionId = 'hostsessionabcdefghijkl';
  Net.matchStarted = true;
  Net._localPlayer = {id:'hostplayer123456',name:'HOST'};

  const checkpoint = Net.buildSessionCheckpoint();
  assert.equal(checkpoint.role, 'host');
  assert.deepEqual(Array.from(checkpoint.authority.snapshot.slice(8, 10)), [3,2]);
  assert.equal(checkpoint.authority.snapshot[0], G.puck.x);
  assert.equal(checkpoint.authority.m1.tx, G.m1.tx);
  assert.equal(checkpoint.authority.m2.vx, G.m2.vx);
  assert.equal(checkpoint.authority.stats.bestRally, 11);
});

test('reconnect-induced pause persists the state being recovered, not a fake manual pause', async () => {
  const {Net, G} = await loadNet();
  Net.active = true; Net.role = 'host'; Net.code = 'XYZ678';
  Net.sessionId = 'hostsessionabcdefghijkl';
  Net._localPlayer = {id:'hostplayer123456',name:'HOST'};
  Net.reconnecting = true;
  Net.dropPaused = false;
  Net.reconnectState = 'play';
  G.state = 'pause';
  G.pausedFrom = 'play';

  const authority = Net.authorityCheckpoint();
  assert.equal(authority.state, 'play');
  assert.equal(authority.pausedFrom, 'play');
});

test('manual pause remains a manual pause in the saved authority state', async () => {
  const {Net, G} = await loadNet();
  Net.active = true; Net.role = 'host'; Net.code = 'XYZ678';
  Net.sessionId = 'hostsessionabcdefghijkl';
  Net._localPlayer = {id:'hostplayer123456',name:'HOST'};
  Net.reconnecting = true;
  Net.dropPaused = true;
  Net.reconnectState = 'play';
  G.state = 'pause';
  G.pausedFrom = 'play';

  const authority = Net.authorityCheckpoint();
  assert.equal(authority.state, 'pause');
  assert.equal(authority.pausedFrom, 'play');
});
