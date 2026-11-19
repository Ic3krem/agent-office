// Glass proof for the notch redesign (not in npm test): does the Windows 11 system material (acrylic) blur what is behind
// the notch while the notch is not focused, do 20 open/close cycles show no white/black flash, and is the shape
// bottom-corners-only (top corners pushed off-screen by an overhang)? Captures ONLY the notch rectangle plus 40 px,
// cropped in memory before writing. A striped backdrop window sits behind the notch so the blur has a known pattern.
// usage: node_modules/.bin/electron perf/notch-glass-check.cjs <outDir> [variant A|B|C|D] [overhang]
const { app, BrowserWindow, screen, desktopCapturer } = require('electron');
const fs = require('fs'), os = require('os'), path = require('path');
app.commandLine.appendSwitch('mute-audio');
const outDir = path.resolve(process.argv.find((a, i) => i >= 2 && !a.startsWith('-') && !/notch-glass-check/.test(a) && !/^[A-D]$/.test(a) && !/^\d+$/.test(a)) || '.');
const variant = process.argv.find(a => /^[A-D]$/.test(a)) || 'A';
const overhang = Number(process.argv.find(a => /^\d+$/.test(a)) || 12);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-glasscheck-'));
app.setPath('userData', tmp);
const wins = [];
const done = c => { for (const w of wins) try { w.destroy(); } catch {} setTimeout(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} app.exit(c); }, 300); };
setTimeout(() => { console.log('FAIL watchdog'); done(1); }, 170000).unref();
process.on('uncaughtException', e => { console.log('FAIL ' + e.stack); done(1); });
process.on('unhandledRejection', e => { console.log('FAIL ' + (e && e.stack || e)); done(1); });
app.on('window-all-closed', () => {}); // never quit on our own window closes; done() ends the run
app.on('before-quit', () => console.log('note: app quitting'));
const wait = ms => new Promise(r => setTimeout(r, ms));
let t0 = Date.now();
const html = s => 'data:text/html;charset=utf-8,' + encodeURIComponent(s);

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const { windowOptions, rectFor } = await import(require('url').pathToFileURL(path.join(__dirname, '..', 'desktop', 'notch-window.mjs')).href);
  const disp = screen.getPrimaryDisplay(), d = disp.bounds, sf = disp.scaleFactor;
  const visible = st => { const r = rectFor(d, st); return r; }; // the notch as seen (no overhang)
  const region = st => { const r = visible(st), x = r.x - 40, y = Math.max(d.y, r.y - 40); return { x, y, width: r.width + 80, height: r.y + r.height + 40 - y }; };

  // Backdrop: wide black/white bands under the whole open region (sharp edges the blur must soften).
  const big = region('open');
  // its top edge sits 4 px above the screen so its own DWM border is not on screen row 0 (the notch's top corners are measured there)
  const back = new BrowserWindow({ ...big, y: big.y - 4, height: big.height + 4, frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true, focusable: false, show: false, hasShadow: false, backgroundColor: '#000' });
  wins.push(back);
  await back.loadURL(html('<body style="margin:0;height:100vh;background:repeating-linear-gradient(90deg,#000 0 48px,#fff 48px 96px)"></body>'));
  back.showInactive();

  const opts = { ...windowOptions('material', 'win32') };
  if (variant === 'B') opts.backgroundColor = '#00000000';
  if (variant === 'C') delete opts.backgroundMaterial;
  if (variant === 'D') opts.backgroundMaterial = 'mica';
  const r0 = rectFor(d, 'closed', { overhang });
  const win = new BrowserWindow({ ...opts, ...r0 });
  wins.push(win);
  await win.loadURL(html('<body style="margin:0;background:transparent;color:#fff;font:12px system-ui;overflow:hidden"><div style="position:absolute;left:10px;bottom:8px">Glass</div></body>'));
  if (variant === 'C') win.setBackgroundMaterial('acrylic');
  console.log('variant', variant, 'options', JSON.stringify(opts), 'overhang', overhang, 'display', JSON.stringify(d), 'scale', sf);

  // ---- capture + pixel stats (physical pixels, display-relative) ----
  const tw = Math.round(d.width * sf), th = Math.round(d.height * sf);
  const grab = async (st, name) => {
    const src = (await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: tw, height: th } })).find(s => s.display_id === String(disp.id)) || null;
    if (!src) throw new Error('no screen source for the primary display');
    const g = region(st), c = { x: Math.round((g.x - d.x) * sf), y: Math.round((g.y - d.y) * sf), width: Math.round(g.width * sf), height: Math.round(g.height * sf) };
    const img = src.thumbnail.crop(c); // crop in memory; nothing outside the region is written
    if (name) fs.writeFileSync(path.join(outDir, name + '.png'), img.toPNG());
    const sz = img.getSize(); return { bmp: img.toBitmap(), w: sz.width, h: sz.height, st, thumb: src.thumbnail.getSize() };
  };
  const px = (cap, x, y) => { const i = (y * cap.w + x) * 4, b = cap.bmp; return [b[i + 2], b[i + 1], b[i]]; }; // BGRA
  const lum = p => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];
  const cdiff = (p, q) => Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2]));
  // the notch rectangle inside the capture, in capture pixels
  const inner = st => { const r = visible(st), g = region(st); return { x: Math.round((r.x - g.x) * sf), y: Math.round((r.y - g.y) * sf), w: Math.round(r.width * sf), h: Math.round(r.height * sf) }; };
  const stats = (cap, base) => {
    const R = inner(cap.st), m = Math.round(4 * sf), x0 = R.x + Math.round(60 * sf); // skip the label at the left
    let n = 0, sum = 0, sq = 0, dsum = 0, maxGrad = 0, baseGrad = 0, white = 0, black = 0;
    for (let y = R.y + m; y < R.y + R.h - Math.round(22 * sf); y += 2) for (let x = x0; x < R.x + R.w - m; x++) {
      const p = px(cap, x, y), l = lum(p); n++; sum += l; sq += l * l; dsum += cdiff(p, px(base, x, y));
      if (l > 245) white++; if (l < 10) black++;
      if (x > x0) { maxGrad = Math.max(maxGrad, Math.abs(l - lum(px(cap, x - 1, y)))); baseGrad = Math.max(baseGrad, Math.abs(lum(px(base, x, y)) - lum(px(base, x - 1, y)))); }
    }
    const mean = sum / n, std = Math.sqrt(Math.max(0, sq / n - mean * mean));
    // outside ring: pixels of the region outside the notch that changed vs the hidden capture
    // (> 30 catches any change incl. a soft shadow; > 120 only a hard edge such as a stray window rectangle)
    let ring = 0, ringHard = 0, rn = 0;
    for (let y = 0; y < cap.h; y += 2) for (let x = 0; x < cap.w; x += 2) {
      if (x >= R.x - 1 && x < R.x + R.w + 1 && y >= R.y - 1 && y < R.y + R.h + 1) continue;
      rn++; const c = cdiff(px(cap, x, y), px(base, x, y)); if (c > 30) ring++; if (c > 120) ringHard++;
    }
    // corners: how many pixels of a 6x6 DIP block at each corner look like the backdrop rather than the window interior
    // 10 DIP diagonally inward (0 = square corner; the DWM 1 px border counts as window)
    const k = Math.round(6 * sf), inset = Math.round(10 * sf);
    const corner = (cx, cy, dx, dy) => { const w = px(cap, cx + dx * inset, cy + dy * inset); let u = 0; for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) { const x = cx + dx * i, y = cy + dy * j, p = px(cap, x, y); if (cdiff(p, px(base, x, y)) < cdiff(p, w)) u++; } return u; };
    const tl = corner(R.x, R.y, 1, 1), tr = corner(R.x + R.w - 1, R.y, -1, 1), bl = corner(R.x, R.y + R.h - 1, 1, -1), br = corner(R.x + R.w - 1, R.y + R.h - 1, -1, -1);
    const flat = std < 6, blurred = !flat && dsum / n > 8 && maxGrad < 0.5 * baseGrad;
    return { mean: +mean.toFixed(1), std: +std.toFixed(1), diff: +(dsum / n).toFixed(1), grad: Math.round(maxGrad), baseGrad: Math.round(baseGrad), blurred, allWhite: white / n > 0.98, allBlack: black / n > 0.98, ringChanged: +(ring / rn * 100).toFixed(2), ringHard: +(ringHard / rn * 100).toFixed(2), corners: { tl, tr, bl, br }, cornerPx: k * k };
  };

  // baselines: notch hidden, same regions
  win.hide(); await wait(600);
  await grab('closed', null); await wait(300); // the first capture can return a stale frame; throw it away
  const base = { closed: await grab('closed', variant + '-base-closed'), open: await grab('open', variant + '-base-open') };
  console.log('capture thumbnail', JSON.stringify(base.closed.thumb), 'expected', tw + 'x' + th);
  const rows = [];
  const measure = async (label, st, save) => { const s = stats(await grab(st, save ? variant + '-' + label : null), base[st]); rows.push({ label, st, ...s }); return s; };
  const setState = st => { const want = rectFor(d, st, { overhang }); win.setBounds(want); return { want, got: win.getBounds() }; };

  setState('closed'); win.showInactive(); await wait(800);
  const b0 = { want: rectFor(d, 'closed', { overhang }), got: win.getBounds() };
  await measure('shown-closed', 'closed', true);
  const bounds = [b0];
  for (let i = 1; i <= 20; i++) {
    bounds.push(setState('open')); await wait(150); await measure('c' + i + '-open', 'open', i === 1 || i === 20); await wait(450);
    bounds.push(setState('closed')); await wait(150); await measure('c' + i + '-closed', 'closed', i === 1 || i === 20); await wait(450);
  }
  // hold open 60 s with a small ordinary window focused in the bottom-right corner
  setState('open'); await wait(300);
  const wa = disp.workArea, other = new BrowserWindow({ width: 300, height: 200, x: wa.x + wa.width - 310, y: wa.y + wa.height - 210, show: false, title: 'glass-check other' });
  wins.push(other);
  for (const [n, w] of [['backdrop', back], ['notch', win], ['other', other]]) w.on('closed', () => console.log('note: ' + n + ' window closed at ' + Math.round((Date.now() - t0) / 1000) + ' s'));
  await other.loadURL(html('<body style="margin:0;background:#2a6;font:14px system-ui">other window</body>'));
  other.show(); other.focus(); await wait(300);
  const focus = { otherFocused: other.isFocused(), notchFocused: win.isFocused() };
  t0 = Date.now();
  for (const s of [5, 30, 60]) { await wait(t0 + s * 1000 - Date.now()); await measure('hold-' + s + 's', 'open', true); }
  focus.atEnd = other.isDestroyed() || win.isDestroyed() ? 'a window was closed during the hold' : { otherFocused: other.isFocused(), notchFocused: win.isFocused() };

  // ---- report ----
  console.log('\nlabel            state   blurred mean  std  diff grad/base ring% hard%  corners tl/tr/bl/br (of ' + rows[0].cornerPx + ')  flash');
  for (const r of rows) console.log([r.label.padEnd(16), r.st.padEnd(7), String(r.blurred).padEnd(7), String(r.mean).padStart(5), String(r.std).padStart(5), String(r.diff).padStart(5), (r.grad + '/' + r.baseGrad).padStart(9), String(r.ringChanged).padStart(6), String(r.ringHard).padStart(5), (r.corners.tl + '/' + r.corners.tr + '/' + r.corners.bl + '/' + r.corners.br).padStart(14), r.allWhite ? 'WHITE' : r.allBlack ? 'BLACK' : '-'].join(' '));
  const yGot = [...new Set(bounds.map(b => b.got.y))], negY = bounds.every(b => b.got.y === b.want.y);
  console.log('\nbounds asked vs got (first 3):', JSON.stringify(bounds.slice(0, 3)));
  console.log('distinct y got:', JSON.stringify(yGot), 'negative y held:', negY);
  console.log('focus:', JSON.stringify(focus));
  const holds = rows.filter(r => r.label.startsWith('hold-'));
  const crit = {
    blurAtHolds: holds.length === 3 && holds.every(r => r.blurred),
    noFlash: rows.every(r => !r.allWhite && !r.allBlack),
    noRectOutside: rows.every(r => r.ringHard < 1),
    topCornersSquare: rows.every(r => r.corners.tl <= 1 && r.corners.tr <= 1),
    bottomCornersRounded: rows.every(r => r.corners.bl > 1 && r.corners.br > 1),
  };
  console.log('criteria:', JSON.stringify(crit));
  const ok = crit.blurAtHolds && crit.noFlash && crit.topCornersSquare;
  console.log(ok ? 'GLASS PROOF PASSED' : 'GLASS PROOF FAILED');
  done(ok ? 0 : 1);
});
