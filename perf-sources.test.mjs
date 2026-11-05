import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Source guards for the power-saver work: these are the things that made the render cost, so they must not come back.
test('power saver sources: no unconditional rAF loop, no filter or inset-glow animation on the small windows', () => {
  const rd = f => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
  const world = rd('./public/office-world.js'), kiro = rd('./public/kiro.html'), isle = rd('./public/island.html');
  assert.ok(!/raf = requestAnimationFrame\(loop\);\s*\n\s*if \(!last\)/.test(world), 'the loop no longer re-arms itself every frame');
  assert.match(world, /M\.frameWait\(frameState\(\)/); assert.match(world, /document\.hidden/);
  assert.ok(!/#kiro \{[^}]*drop-shadow/.test(kiro), 'no drop-shadow filter on the animated Tiro sprite');
  assert.match(kiro, /#kiro\.rest/); assert.match(kiro, /animation-play-state: paused/);
  assert.ok(!/@keyframes glow/.test(isle), 'the box-shadow glow animation is gone'); assert.ok(!/#isle::after \{[^}]*box-shadow/.test(isle));
  assert.match(isle, /function animOn\(\)/);
});
