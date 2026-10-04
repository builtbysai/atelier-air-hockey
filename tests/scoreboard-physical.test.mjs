import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../src/scoreboards.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');
function world() {
  const state={
    CX:720,TAU:Math.PI*2,performance:{now:()=>1000},PRM:{reduce:false},
    Settings:{effects:'full',firstTo:7},THEME:{scoreboard:'solari',board:{}},
    clamp:(n,a,b)=>Math.min(b,Math.max(a,n)),lerp:(a,b,t)=>a+(b-a)*t,
    rr:(c,x,y,w,h,r)=>{c.beginPath();c.rect(x,y,w,h)},
    G:{score:[3,3]},sideLabel:s=>s===0?'YOU':'RIVAL',
    Math:Object.assign(Object.create(Math),{random:()=>{throw new Error('render-time randomness')}}),
  };
  runInNewContext(source+'\nthis.t={Scoreboards,scoreImpact,freshBoard,boardKick,tickBoard,scoreboardHudLayout}',state);
  return {state,...state.t};
}
test('the physical score pulse is derived from the existing animation clock',()=>{
  const w=world(),{G,PRM,Settings}=w.state;G.board=w.freshBoard();
  G.score[0]=1;w.boardKick(0);
  assert.equal(w.scoreImpact(G.board,0),1);
  assert.equal(w.scoreImpact(G.board,1),0);
  G.board.anim[0].t=.29;
  assert.ok(Math.abs(w.scoreImpact(G.board,0)-.25)<1e-7);
  G.board.anim[0].t=.58;
  assert.equal(w.scoreImpact(G.board,0),0);
  PRM.reduce=true;G.board.anim[0].t=0;assert.equal(w.scoreImpact(G.board,0),0);
  PRM.reduce=false;Settings.effects='minimal';assert.equal(w.scoreImpact(G.board,0),0);
});
test('scoreboard layout avoids controls at narrow phone, landscape, tablet and desktop widths',()=>{
  const w=world();
  for(const width of [280,320,360,390,600,601,680,760,761,844,1280]){
    for(const mode of ['ai','online']){
      const {hs,hudCenter,rightReserve}=w.scoreboardHudLayout(width,mode);
      assert.ok(hs>0&&hs<=1, String(width));
      assert.ok(hudCenter-200*hs>=7.9, 'clipped board at '+width+' '+mode);
      assert.ok(hudCenter+200*hs<=width-rightReserve-7.9,'control overlap '+width+' '+mode);
    }
  }
  assert.match(css,/@media \(min-width:601px\) and \(max-width:760px\)/);
});
function canvas(){
  const log=[],texts=[];
  const gradients=()=>({addColorStop(){}});
  return new Proxy({},{
    get(o,k){if(k==='log')return log;if(k==='texts')return texts;if(k==='createLinearGradient'||k==='createRadialGradient')return gradients;
      if(k==='measureText')return str=>({width:String(str).length*10});
      if(k in o)return o[k];
      return (...args)=>{if(k==='fillText')texts.push(String(args[0]));if(['translate','scale','arc','rect','fillRect','lineTo'].includes(k))
        assert.ok(args.every(Number.isFinite),String(k)+' has nonfinite coordinates: '+args);log.push(k)};
    },set(o,k,v){o[k]=v;return true;}
  });
}
test('all five physical devices render stable frames through scoring and reduced motion',()=>{
  const w=world(),{G,Settings,PRM}=w.state;
  for(const device of ['solari','reels','cribbage','bulbs','neon']){
    for(const side of [0,1]){
      G.board=w.freshBoard();G.score=[3,3];G.board.shown=[3,3];
      G.score[side]=4;w.boardKick(side);
      const c=canvas();w.Scoreboards[device].draw(c,4,3,7,null,G.board,['YOU','RIVAL']);
      assert.ok(c.log.length>0,device+' did not paint');
      for(const reduced of [true,false]){
        PRM.reduce=reduced;Settings.effects=reduced?'minimal':'full';
        G.board.anim[side].t=.24;
        w.Scoreboards[device].draw(canvas(),4,3,7,null,G.board,['YOU','RIVAL']);
      }
    }
  }
});
test('bulb score lighting has no frame-to-frame random jitter',()=>{
  const w=world(),c=canvas();w.state.G.board=w.freshBoard();
  w.state.G.board.shown=[4,3];w.state.G.board.anim[0]={t:.25,from:3};
  // Math.random in the sandbox throws: drawing animated bulbs must not call it.
  w.Scoreboards.bulbs.draw(c,4,3,7,null,w.state.G.board,['YOU','RIVAL']);
  assert.ok(c.log.length>0);
});

test('visual-review finding: only one numeral face at a time on flap and neon devices',()=>{
  const w=world(),B=w.freshBoard();B.shown=[4,3];
  B.anim[0]={t:.16,from:3};B.anim[1]={t:1,from:3};
  const flap=canvas();w.Scoreboards.solari.draw(flap,4,3,7,null,B,['YOU','RIVAL']);
  assert.equal(flap.texts.filter(x=>x==='3').length,2,'old flap and rival only');
  assert.equal(flap.texts.filter(x=>x==='4').length,0,'new flap waits for turnover');
  const neon=canvas();w.Scoreboards.neon.draw(neon,4,3,7,null,B,['YOU','RIVAL']);
  assert.equal(neon.texts.filter(x=>x==='3').length,2,'only rival numeral lit');
  assert.equal(neon.texts.filter(x=>x==='4').length,2,'new neon tube drawn once');
  B.anim[0].t=.42;
  const done=canvas();w.Scoreboards.solari.draw(done,4,3,7,null,B,['YOU','RIVAL']);
  assert.equal(done.texts.filter(x=>x==='3').length,1);
  assert.equal(done.texts.filter(x=>x==='4').length,1);
});
