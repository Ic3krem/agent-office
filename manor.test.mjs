import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWorld } from './world-vm.mjs';
import { MANOR_THEMES } from './party/protocol.mjs';

const W = loadWorld({ extra: ['manor.js', 'town-map.js'] }), M = W.Manor, TM = W.TownMap;
const J = v => JSON.parse(JSON.stringify(v));

test('the presets are the protocol themes, each on a town building style', () => {
  assert.deepEqual(Object.keys(M.THEMES), MANOR_THEMES);
  const atlas = ['office-country', 'office-japanese', 'office-modern'];
  for (const t of Object.values(M.THEMES)) { assert.ok(atlas.includes(t.base)); for (const c of Object.values(t.colors)) assert.match(c, /^#[0-9a-f]{6}$/); }
  assert.equal(M.THEMES.beach.base, 'office-modern'); assert.equal(M.THEMES.cyber.base, 'office-modern'); assert.equal(M.THEMES.cottage.base, 'office-country');
});

test('resolve: classic styles stay as drawn; new presets and overrides wash and tint', () => {
  const classic = J(M.resolve({ theme: 'japanese', colors: {} }));
  assert.equal(classic.base, 'office-japanese'); assert.equal(classic.wash, null); assert.equal(classic.tint, 0);
  const beach = J(M.resolve({ theme: 'beach' }));
  assert.deepEqual(beach.wash, { wall: '#f3e3c2', floor: '#e8cf9a' }); assert.ok(beach.tint > 0);
  const over = J(M.resolve({ theme: 'modern', colors: { floor: '#112233', wall: 'red' } }));
  assert.equal(over.colors.floor, '#112233'); assert.equal(over.colors.wall, '#d9dde3', 'a bad colour keeps the preset one'); assert.ok(over.wash);
  assert.equal(J(M.resolve({ theme: 'castle' })).theme, 'modern');
  assert.equal(M.lighten('#000000', 0.5), 0x808080);
});

test('withFriends: a friend lot and the main house draw their owner\'s manor', () => {
  const map = { lots: [{ id: 'home', kind: 'home', building: { type: 'office-modern', x: 0, y: 0 } }, { id: 'friend-1', kind: 'friend', building: { type: 'lot-empty', x: 0, y: 0 } }, { id: 'friend-2', kind: 'friend', building: { type: 'lot-empty', x: 0, y: 0 } }] };
  const world = { owners: { home: { id: 'aa', me: true }, 'friend-1': { id: 'bb', manor: { theme: 'cottage', colors: {} } }, 'friend-2': { id: 'cc' } } };
  const out = J(TM.withFriends(map, world, { theme: 'japanese', colors: {} })).lots;
  assert.equal(out[0].building.type, 'office-japanese', 'your own house: your manor');
  assert.equal(out[1].building.type, 'office-country'); assert.ok(out[1].building.tint > 0);
  assert.equal(out[2].building.type, TM.styleOf('cc'), 'no manor: the style from the id, as before');
  assert.equal(J(TM.withFriends(map, null, { theme: 'cottage' })).lots[0].building.type, 'office-country', 'outside a party the main house is yours');
});
