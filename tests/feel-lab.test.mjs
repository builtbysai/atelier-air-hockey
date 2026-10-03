import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../src/feel-events.js', import.meta.url), 'utf8');
const lab = readFileSync(new URL('../src/feel-lab.js', import.meta.url), 'utf8');
const game = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../src/template.html', import.meta.url), 'utf8');

function fakeDOM() {
  class Element {
    constructor(tag) {
      this.tag = tag;
      this.children = [];
      this.dataset = {};
      this.handlers = {};
      this.hidden = false;
      this.textContent = '';
      this.value = '';
    }
    append(...items) {
      for (const item of items) {
        const prev = this.children.at(-1);
        if (prev) prev.nextSibling = item;
        this.children.push(item);
      }
    }
    appendChild(item) { this.append(item); return item; }
    setAttribute(key, value) { this[key] = value; }
    addEventListener(type, fn) { this.handlers[type] = fn; }
    emit(type, data = {}) { this.handlers[type]?.({ key:'', stopPropagation() {}, ...data }); }
    querySelectorAll(query) {
      if (query !== 'input[data-feel]') throw new Error('unexpected query: ' + query);
      const result = [];
      const visit = n => {
        if (n.tag === 'input' && n.dataset.feel) result.push(n);
        n.children.forEach(visit);
      };
      visit(this);
      return result;
    }
    select() { this.selected = true; }
    focus() { this.focused = true; }
  }
  const head = new Element('head'), body = new Element('body');
  return { head, body, createElement: tag => new Element(tag) };
}

function load(search) {
  const document = fakeDOM();
  const ctx = {
    document, URLSearchParams, location: { search },
    MusicSys: { calls:[], setRally(level, force) { this.calls.push([level, force]); } },
    G: { stats: { rally: 10 } },
  };
  const api = runInNewContext(source + '\n' + lab + '\n({ Feel, FeelLab })', ctx);
  return { ...api, document, ctx };
}

test('normal players do not mount or persist development controls', () => {
  const t = load('?table=deco');
  assert.equal(t.FeelLab.enabled, false);
  assert.equal(t.document.body.children.length, 0);
  t.FeelLab.recordHit({perfect:true,impact:1800});
  assert.equal(t.document.head.children.length, 0);
});

test('URL opt-in mounts a collapsed, keyboard-operable live tuning panel', () => {
  const t = load('?table=deco&feelLab=1');
  assert.equal(t.FeelLab.enabled, true);
  const host = t.document.body.children[0];
  assert.equal(host.id, 'atelierFeelLab');
  const panel = host.children[0], toggle = host.children[1];
  assert.equal(panel.hidden, true);
  toggle.emit('click');
  assert.equal(panel.hidden, false);
  assert.equal(toggle['aria-expanded'], 'true');
  const sliders = panel.querySelectorAll('input[data-feel]');
  const strike = sliders.find(x => x.dataset.feel === 'minNormalSpeed');
  assert.ok(strike, 'actual threshold slider available');
  strike.value = '1550';
  strike.emit('input');
  assert.equal(t.Feel.tuning.minNormalSpeed, 1550);
  assert.ok(t.ctx.MusicSys.calls.length >= 1, 'live tuning refreshes existing music bus');
  t.FeelLab.recordHit({perfect:true,impact:2000});
  t.FeelLab.recordRally(12);
  t.FeelLab.recordGoal(12);
  assert.match(panel.children.find(x=>x.className==='fl-status').textContent,/clean 1/);
  const reset = panel.children.find(x => x.className === 'fl-row').children[0];
  reset.emit('click');
  assert.equal(t.Feel.tuning.minNormalSpeed, 1000);
  host.emit('keydown', {key:'Escape'});
  assert.equal(panel.hidden, true);
  assert.equal(toggle.focused, true);
});

test('feel-lab scripts load after game and remain absent from public preferences', () => {
  assert.ok(html.indexOf('src/feel-events.js') < html.indexOf('src/game.js'));
  assert.ok(html.indexOf('src/game.js') < html.indexOf('src/feel-lab.js'));
  assert.doesNotMatch(html, /id="atelierFeelLab"/, 'dev-only panel is generated after URL gating');
  assert.match(lab, /get\('feelLab'\) === '1'/);
  assert.match(game, /Feel\.tuning\.perfectCrackGain/);
  assert.match(game, /Feel\.tuning\.rallyTrailLift/);
});
