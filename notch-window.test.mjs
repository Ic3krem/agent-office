import test from 'node:test';
import assert from 'node:assert/strict';
import { windowForm, windowOptions, rectFor, resizePlan, topOverhang, SIZES } from './desktop/notch-window.mjs';

test('windowForm: material only for glass on Windows 11 22H2+ or macOS', () => {
  assert.equal(windowForm({ platform: 'win32', release: '10.0.26200', look: 'glass' }), 'material');
  assert.equal(windowForm({ platform: 'win32', release: '10.0.19045', look: 'glass' }), 'transparent');
  assert.equal(windowForm({ platform: 'win32', release: '10.0.26200', look: 'solid' }), 'transparent');
  assert.equal(windowForm({ platform: 'win32', release: '10.0.26200', look: 'glass', materialOk: false }), 'transparent');
  assert.equal(windowForm({ platform: 'darwin', release: '24.0.0', look: 'glass' }), 'material');
  assert.equal(windowForm({ platform: 'linux', release: '6.8', look: 'glass' }), 'transparent');
  assert.equal(windowForm({ platform: 'win32', release: '10.0.22621', look: 'glass' }), 'material', '22H2 itself counts');
  assert.equal(windowForm({ platform: 'win32', release: '10.0.22000', look: 'glass' }), 'transparent', '21H2 has no backdrop API');
});
test('rectFor: centred on the top edge, open never wider than the display minus 80', () => {
  const d = { x: 1920, y: 0, width: 1920, height: 1080 };
  assert.deepEqual(rectFor(d, 'closed'), { x: 1920 + 870, y: 0, width: 180, height: 32 });
  assert.deepEqual(rectFor(d, 'open'), { x: 1920 + 410, y: 0, width: 1100, height: 370 });
  assert.equal(rectFor({ x: 0, y: 0, width: 1024, height: 768 }, 'open').width, 944);
  assert.deepEqual(rectFor(d, 'closed', { overhang: 12 }), { x: 1920 + 870, y: -12, width: 180, height: 44 });
  assert.deepEqual(SIZES, { closed: { w: 180, h: 32 }, line: { w: 400, h: 36 }, game: { w: 360, h: 36 }, open: { w: 1100, h: 370 } });
});
test('windowOptions: forms differ only in transparency and material', () => {
  const t = windowOptions('transparent', 'win32'), m = windowOptions('material', 'win32');
  assert.equal(t.transparent, true); assert.equal('backgroundMaterial' in t, false);
  assert.equal(m.transparent, false); assert.equal(m.backgroundMaterial, 'acrylic');
  for (const o of [t, m]) { assert.equal(o.frame, false); assert.equal(o.show, false); assert.equal(o.resizable, false); }
  const strip = ({ transparent, backgroundMaterial, ...rest }) => rest;
  assert.deepEqual(strip(t), strip(m));
  const mac = windowOptions('material', 'darwin');
  assert.equal(mac.vibrancy, 'hud'); assert.equal(mac.visualEffectState, 'active'); assert.equal('backgroundMaterial' in mac, false);
});

test('resizePlan: grow resizes first; shrink waits for the page unless the delay is 0; same size does nothing', () => {
  assert.equal(resizePlan('closed', 'open', 220), 'grow');
  assert.equal(resizePlan('closed', 'line', 0), 'grow');
  assert.equal(resizePlan('open', 'closed', 220), 'later');
  assert.equal(resizePlan('open', 'line', 0), 'now', 'no delay (Power saver, reduced motion): shrink at once');
  assert.equal(resizePlan('open', 'open', 220), 'none', 'reopened before a pending shrink ran: the window is already open-sized');
  assert.equal(resizePlan('line', 'closed', 220), 'later');
});

test('topOverhang: 12 px unless another display sits directly above the strip (it would show there and take clicks)', () => {
  const d = { x: 0, y: 0, width: 1920, height: 1080 };
  assert.equal(topOverhang(d, [d]), 12, 'one display');
  assert.equal(topOverhang(d, [d, { x: 1920, y: 0, width: 2560, height: 1440 }]), 12, 'side by side');
  assert.equal(topOverhang(d, [d, { x: 1920, y: -1440, width: 2560, height: 1440 }]), 12, 'above but only diagonally (edges touch)');
  assert.equal(topOverhang(d, [d, { x: 0, y: 1080, width: 1920, height: 1080 }]), 12, 'below');
  assert.equal(topOverhang(d, [d, { x: 0, y: -1080, width: 1920, height: 1080 }]), 0, 'stacked directly above');
  assert.equal(topOverhang(d, [d, { x: 1500, y: -1440, width: 2560, height: 1440 }]), 0, 'partly above');
  assert.equal(topOverhang({ x: 0, y: 1080, width: 1920, height: 1080 }, [d, { x: 0, y: 1080, width: 1920, height: 1080 }]), 0, 'the lower of two stacked');
});
