import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function loadNet() {
  const source = await readFile(new URL('../src/net.js', import.meta.url), 'utf8');
  const G = {
    state:'pause', pausedFrom:'play', focusLost:false, winSide:0, gwNet:0,
    puck:{x:700,y:500,vx:0,vy:0,w:0,ang:0,r:26},
    m1:{x:370,y:520,tx:370,ty:520,vx:0,vy:0,r:46},
    m2:{x:1070,y:520,tx:1070,ty:520,vx:0,vy:0,r:46},
    score:[2,2], serveVX:0,serveVY:0,serveDir:1,
    stats:{topSpeed:0,rally:0,bestRally:0,bestGoalRally:0,bankGoals:[0,0],rallyLastSide:-1,saves:[0,0],t0:0,streak:[0,0],bestStreak:[0,0],worstDef:[0,0]},
    countT:0,countN:3,goPlayed:false,goalT:0,goalSlowT:0,goalSide:0,timeScale:1,
    trail:[],
  };
  const localStorage = {getItem:()=>null,setItem(){},removeItem(){}};
  const context = {
    console, Math, Date, Promise, URL, TextEncoder, Uint8Array, ArrayBuffer, DataView, Set,
    setTimeout, clearTimeout, performance, localStorage, G,
    Settings:{firstTo:7,pace:'classic',goalW:'standard'},
    THEME:{id:'deco'},
    PX:200,PY:200,PW:1040,PH:640,CX:720,CY:520,PUCK_R:26,MALLET_R:46,PLAYER_CAP:4200,
    clamp:(v,a,b)=>Math.min(b,Math.max(a,v)),
  };
  vm.createContext(context);
  vm.runInContext(source + '\nthis.__Net = Net;', context, {filename:'src/net.js'});
  return {Net:context.__Net,G};
}

function snapshot(overrides = {}) {
  const values = {
    px:760,py:520,pvx:-500,pvy:30,
    m1x:390,m1y:500,m2x:1050,m2y:540,
    s0:4,s1:3,flags:2,top:1900,br:12,sv0:2,sv1:4,
    svx:600,svy:0,sdir:1,
    ...overrides,
  };
  return [
    values.px,values.py,values.pvx,values.pvy,
    values.m1x,values.m1y,values.m2x,values.m2y,
    values.s0,values.s1,values.flags,values.top,values.br,values.sv0,values.sv1,
    values.svx,values.svy,values.sdir,
  ];
}

test('legacy host and guest roles infer stable player sides', async () => {
  const {Net} = await loadNet();
  Net.role='host'; Net.side=null;
  assert.equal(Net.playerSide(),0);
  Net.role='guest'; Net.side=null;
  assert.equal(Net.playerSide(),1);
  Net.role='spectator'; Net.side=null;
  assert.equal(Net.playerSide(),null);
});

test('authority election prefers higher epoch with deterministic equal-epoch tie break', async () => {
  const {Net} = await loadNet();
  Net.authoritySide=0; Net.authorityEpoch=4;
  assert.equal(Net.authorityTupleWins(5,1),true);
  assert.equal(Net.authorityTupleWins(3,1),false);
  assert.equal(Net.authorityTupleWins(4,1),false, 'side zero wins an equal-epoch split-brain tie');
  Net.authoritySide=1;
  assert.equal(Net.authorityTupleWins(4,0),true);
});

test('non-authority side promotes from the last host-authored snapshot', async () => {
  const {Net,G} = await loadNet();
  Net.active=true; Net.role='guest'; Net.side=1;
  Net.authoritySide=0; Net.authorityEpoch=1;
  Net.sessionId='abcdefghijklmnopqrstuvwx';
  Net.rsnap=Net.decodeSnapshot(snapshot());
  Net.rtLastStateSeq=321;
  Net.openSpectatorHost=async()=>{};
  Net.saveSessionCheckpoint=()=>true;
  Net.clearGuestPrediction=()=>{ Net.guestPrediction=null; };

  assert.equal(Net.promoteAuthority(),true);
  assert.equal(Net.isAuthority(),true);
  assert.equal(Net.authoritySide,1);
  assert.equal(Net.authorityEpoch,2);
  assert.equal(Net.rtStateSeq,321);
  assert.deepEqual(G.score,[4,3]);
  assert.equal(G.puck.x,760);
  assert.equal(G.m1.x,390);
  assert.equal(G.m2.x,1050);
  assert.equal(Net.remote.tx,390, 'promoted side one now consumes remote side-zero input');
});

test('former host adopts a higher guest authority epoch and converged state', async () => {
  const {Net,G} = await loadNet();
  Net.active=true; Net.role='host'; Net.side=0;
  Net.authoritySide=0; Net.authorityEpoch=1;
  Net.sessionId='abcdefghijklmnopqrstuvwx';
  Net.reconnecting=true; Net.reconnectState='play'; Net.dropPaused=false;
  Net.closeSpectatorRoom=()=>{};
  Net.saveSessionCheckpoint=()=>true;

  const accepted=Net.onAuthorityClaim({
    v:1,sid:Net.sessionId,epoch:2,side:1,
    authority:{snapshot:snapshot({px:810,s0:5,s1:4}),state:'play',pausedFrom:'play',winSide:0},
  });
  assert.equal(accepted,true);
  assert.equal(Net.authoritySide,1);
  assert.equal(Net.authorityEpoch,2);
  assert.equal(Net.isAuthority(),false);
  assert.equal(G.puck.x,810);
  assert.deepEqual(G.score,[5,4]);
  assert.equal(Net.reconnectState,'play');
});

test('migrated authority clamps incoming target to the remote player half', async () => {
  const {Net} = await loadNet();
  Net.active=true; Net.role='guest'; Net.side=1;
  Net.authoritySide=1; Net.authorityEpoch=2;
  Net.peerId='peer-zero';
  Net.onInput([1000,520],'peer-zero');
  assert.equal(Net.remote.tx,712, 'side zero target cannot cross the center guard');
  Net.onInput([250,100],'peer-zero');
  assert.equal(Net.remote.tx,250);
  assert.equal(Net.remote.ty,246);
});

test('game source routes online scoring and simulation through authority helpers', async () => {
  const source = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');
  assert.match(source,/G\.mode === 'online' && !onlineIsAuthority\(\)\) return;/);
  assert.match(source,/if \(onlineIsAuthority\(\)\) \{/);
  assert.match(source,/const local = onlineLocalMallet\(\)/);
  assert.match(source,/onlinePlayerSide\(\) === scorer/);
});
