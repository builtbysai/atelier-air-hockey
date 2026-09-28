import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const game = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');
const persistence = game.slice(0, game.indexOf('// puck pace:'));

function loadWorld(raw) {
  const saved = new Map(Object.entries(raw));
  const localStorage = {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, String(value)),
  };
  const context = vm.createContext({
    localStorage,
    clamp: (value, low, high) => Math.max(low, Math.min(high, value)),
  });
  vm.runInContext(persistence + '\nthis.stores = { Settings, loadSettings, Record, Best, Feats, Tour, Mastery, TableChallenges, Workshop };', context);
  return context.stores;
}

test('malformed saved settings cannot stop boot', () => {
  for (const raw of ['null', '[]', '"broken"', '{bad json']) {
    const world = loadWorld({ 'atelier-ah-settings': raw });
    assert.doesNotThrow(() => world.loadSettings(), raw);
    assert.equal(world.Settings.firstTo, 7);
    assert.equal(world.Settings.musicVolume, 70);
  }
});

test('saved progress loaders discard non-object JSON before writing', () => {
  const cases = [
    ['Record', 'atelier-ah-record', 'null'],
    ['Best', 'atelier-ah-best', '[]'],
    ['Feats', 'atelier-ah-feats', '"broken"'],
    ['Tour', 'atelier-ah-tour', '42'],
    ['Mastery', 'atelier-ah-mastery', 'false'],
    ['TableChallenges', 'atelier-ah-table-challenges', '{bad json'],
    ['Workshop', 'atelier-ah-workshop', '[]'],
  ];
  const world = loadWorld(Object.fromEntries(cases.map(([, key, raw]) => [key, raw])));
  for (const [name] of cases) {
    world[name].load();
    assert.deepEqual(Object.keys(world[name].data), [], name);
  }
  assert.doesNotThrow(() => world.Record.bump('ai0', true));
  assert.doesNotThrow(() => world.Workshop.completeStage('power', 1));
});
