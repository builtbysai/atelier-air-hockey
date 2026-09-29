import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function loadNet() {
  const source = await readFile(new URL('../src/net.js', import.meta.url), 'utf8');
  const G = {
    mode:'online', state:'play', onlineFlip:false,
    puck:{x:400,y:300,vx:0,vy:0},
    m1:{x:150,y:300}, m2:{x:650,y:300},
    score:[0,0], stats:{topSpeed:0,bestRally:0,saves:[0,0]},
    trail:[], serveVX:0, serveVY:0, serveDir:1,
  };
  const elements = new Map();
  const $ = id => {
    if (!elements.has(id)) elements.set(id, {
      classList:{ add(){}, remove(){}, toggle(){} },
      textContent:'', innerHTML:'', disabled:false,
    });
    return elements.get(id);
  };
  const context = {
    console, Math, Date, Promise, URL, TextEncoder, Uint8Array, ArrayBuffer, DataView, Set,
    setTimeout, clearTimeout, performance, G,
    Settings:{firstTo:7,pace:'classic'},
    THEME:{id:'deco'}, THEMES:{deco:{}}, PACES:{classic:{}},
    PX:60, PW:680, PY:80, PH:440, CY:300, PUCK_R:26, MALLET_R:46, PUCK_MAX:3100,
    clamp:(v,a,b)=>Math.min(b,Math.max(a,v)),
    $,
    localStorage:{getItem:()=>null,setItem(){}},
    hideAll(){}, clearCeremony(){}, beginGoalCeremony(){}, resetPositions(){}, startCount(){ G.state='count'; },
    freshBoard:()=>({}), freshStats:()=>({topSpeed:0,bestRally:0,saves:[0,0]}),
    pointers:{clear(){}}, goalW:()=>200, setTheme(){}, applySettingsToUI(){},
    MusicSys:{setSessionSeed(){}}, fitCamera(){}, paintTableWarp(){},
  };
  vm.createContext(context);
  vm.runInContext(source + '\nthis.__Net = Net;', context, {filename:'src/net.js'});
  return {Net:context.__Net, G};
}

test('spectator room uses a separate passive Trystero namespace', async () => {
  const {Net} = await loadNet();
  Net.fetchIceServers = async () => [{urls:['stun:stun.cloudflare.com:3478']}];
  let gotConfig, gotRoomId, gotCallbacks;
  const room = {};
  const returned = await Net.makeRoom((config, roomId, callbacks) => {
    gotConfig = config; gotRoomId = roomId; gotCallbacks = callbacks; return room;
  }, 'ABCDEF', {prefix:'atelier-ah-watch-', lockPeer:false, passive:true});
  assert.equal(returned, room);
  assert.equal(gotConfig.passive, true);
  assert.equal(gotRoomId, 'atelier-ah-watch-ABCDEF');
  assert.equal(gotCallbacks.onPeerHandshake, undefined,
    'watchers must never participate in the player-room one-rival lock');
});

test('spectator snapshots adopt authority without owning the player peer id', async () => {
  const {Net} = await loadNet();
  Net.role = 'spectator'; Net.active = true;
  Net.onWatchSnapshot([
    410,300,500,0, 140,300, 660,300,
    2,3,2, 900,7,1,2, 500,0,1,
  ], 'host-peer');
  assert.equal(Net.watchHostPeerId, 'host-peer');
  assert.equal(Net.peerId, null);
  assert.equal(Net.rsnap.px, 410);
  assert.equal(Net.gview.pvx, 500);

  Net.onWatchSnapshot([
    999,999,0,0, 140,300,660,300,
    2,3,2,900,7,1,2,500,0,1,
  ], 'stranger');
  assert.equal(Net.rsnap.px, 410, 'a second peer cannot take over the gallery stream');
});

test('spectator snapshot publisher is optional and targetable', async () => {
  const {Net} = await loadNet();
  const sent = [];
  Net.spectatorWire = {
    sendSt:(data,target) => { sent.push({data,target}); return Promise.resolve(); },
  };
  await Net.spectatorSendState('watcher-1');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].target, 'watcher-1');
  assert.ok(Array.isArray(sent[0].data));
  assert.ok(sent[0].data.length >= 15);
});

test('watching a completed match never records the authority as a recent rival', async () => {
  const {Net} = await loadNet();
  Net.role='spectator';
  let remembered=0;
  Net.rememberRival=()=>{ remembered++; };
  Net.clearGuestPrediction=()=>{};
  Net.guestGoal({s0:7,s1:5,scorer:0,matchEnd:true});
  assert.equal(remembered,0);

  Net.role='guest';
  Net.guestGoal({s0:7,s1:5,scorer:0,matchEnd:true});
  assert.equal(remembered,1, 'played matches still update recent-rival history');
});

test('game loop never gives a spectator physics or input authority', async () => {
  const source = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');
  assert.match(source, /G\.mode === 'online' && Net\.role === 'spectator'\) return;/);
  assert.match(source, /Net\.role === 'spectator'\) \{ \/\* snapshots drive the gallery view \*\//);
  assert.match(source, /Net\.role === 'spectator'\) return false;/);
});
