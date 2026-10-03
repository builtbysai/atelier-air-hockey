import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const feelSource = readFileSync(new URL('../src/feel-events.js', import.meta.url),'utf8');
const net = readFileSync(new URL('../src/net.js', import.meta.url),'utf8');
const game = readFileSync(new URL('../src/game.js', import.meta.url),'utf8');
const Feel = vm.runInNewContext(feelSource + '\nFeel;');
const base = {scorer:0, score:[3,1], prevScore:[2,1], target:7, speedKmh:15, rally:2};
const classify = props => Feel.goalContext({...base,...props});
const normal = () => ({...base});

test('primary goal classification is prioritized without inventing own goals or angles', () => {
  assert.equal(classify({score:[7,6],prevScore:[6,6], bankShot:true,rally:17,speedKmh:34}).kind,'winning');
  assert.equal(classify({score:[4,4],prevScore:[3,4],erasedDeficit:true,bankShot:true}).kind,'comeback');
  assert.equal(classify({score:[6,3],prevScore:[5,3],bankShot:true}).kind,'match-point');
  assert.equal(classify({bankShot:true,rally:16,speedKmh:32}).kind,'bank');
  assert.equal(classify({rally:15,speedKmh:32}).kind,'long-rally');
  assert.equal(classify({rally:2,speedKmh:28}).kind,'rocket');
  assert.equal(classify({rally:2,speedKmh:15}).kind,'goal');
  assert.equal(classify({score:[3,2],prevScore:[2,2],erasedDeficit:true}).kind,'goal');
});
test('winner context retains a single non-competing secondary craft label', () => {
  const g=classify({score:[7,4],prevScore:[6,4],rally:15,bankShot:true});
  assert.equal(g.kind,'winning');
  assert.equal(g.craft,'bank');
  assert.equal(Feel.craftLabel(g),'BANK SHOT');
  assert.equal(Object.isFrozen(g),true);
});
test('wire metadata must be bounded, score-consistent and non-executable', () => {
  const c=classify({score:[6,5],prevScore:[5,5],bankShot:true,rally:15,speedKmh:28});
  assert.equal(Feel.validGoalContext(c,[6,5],0,7),true);
  assert.equal(Feel.validGoalContext({...c,kind:'winning'},[6,5],0,7),false);
  assert.equal(Feel.validGoalContext({...c,kind:'match-point'},[5,5],0,7),false);
  assert.equal(Feel.validGoalContext({...c,rally:1e12},[6,5],0,7),false);
  assert.equal(Feel.validGoalContext({...c,craft:'<img onerror=x>'},[6,5],0,7),false);
  assert.equal(Feel.validGoalContext({...c,kind:'rocket',craft:'bank'},[6,5],0,7),false);
  assert.equal(Feel.validGoalContext(null,[6,5],0,7),false);
});

const guestStart=net.indexOf('Net.guestGoal = function (ev) {');
const guestEnd=net.indexOf('/* Remote pause',guestStart);
const sendStart=net.indexOf('Net.sendGoal = function (scorer) {');
const sendEnd=net.indexOf('Net.sendPause = function',sendStart);
assert.ok(guestStart>0&&guestEnd>guestStart&&sendStart>0&&sendEnd>sendStart);
function netHarness() {
  const sent=[],watch=[],ceremonies=[];
  const state={
    G:{score:[2,1],state:'play',goalContext:null},
    Settings:{firstTo:7},Net:{
      wire:{sendEv:v=>sent.push(v)},active:true,role:'host',rsnap:{s0:2,s1:1},
      clearGuestPrediction(){},spectatorSendEvent:v=>{watch.push(v);return Promise.resolve();},
      rememberRival(){},
    },
    beginGoalCeremony:(scorer,context)=>ceremonies.push([scorer,context]),
  };
  const api=vm.runInNewContext(feelSource+'\n'+net.slice(guestStart,guestEnd)+'\n'+net.slice(sendStart,sendEnd)+'\nNet;',state);
  return {Net:api,G:state.G,sent,watch,ceremonies};
}
test('authority sends the same compact goal context to rival and spectator', () => {
  const h=netHarness();
  h.G.score=[3,1];
  h.G.goalContext=classify({score:[3,1],speedKmh:27});
  h.Net.sendGoal(0);
  assert.equal(h.sent.length,1);
  assert.equal(h.watch.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.watch[0])),JSON.parse(JSON.stringify(h.sent[0])));
  assert.deepEqual(JSON.parse(JSON.stringify(h.sent[0].fx)),{k:'rocket',c:'rocket',r:2,v:27});
});
test('guests render accepted authority context, never increment a delivered score', () => {
  const h=netHarness();
  const fx={k:'bank',c:'bank',r:13,v:26};
  h.Net.guestGoal({scorer:0,s0:3,s1:1,fx});
  assert.equal(h.G.score[0],3);
  assert.equal(h.ceremonies[0][0],0);
  assert.deepEqual(JSON.parse(JSON.stringify(h.ceremonies[0][1])),
    {kind:'bank',craft:'bank',rally:13,speed:26});
  assert.equal(h.Net.rsnap.s0,3);
});
test('old goal packets and malicious metadata fall back to generic visuals', () => {
  const h=netHarness();
  h.Net.guestGoal({scorer:0,s0:3,s1:1});
  assert.equal(h.ceremonies[0][1],null);
  h.Net.guestGoal({scorer:0,s0:4,s1:1,fx:{k:'winning',c:'bank',r:13,v:26}});
  assert.equal(h.ceremonies[1][1],null);
  assert.equal(h.G.score[0],4);
});
test('the live game produces context after recording Highlights and before sending', () => {
  const start=game.indexOf('function onGoal(scorer) {'),end=game.indexOf('function goalIsYours(',start);
  const s=game.slice(start,end);
  assert.ok(s.indexOf('Highlights.recordGoal(scorer, goalClip)') <
    s.indexOf('beginGoalCeremony(scorer)'));
  assert.ok(s.indexOf('beginGoalCeremony(scorer)') < s.indexOf('Net.sendGoal(scorer)'));
  assert.match(game,/G\.goalContext = remoteGoalContext/);
});
