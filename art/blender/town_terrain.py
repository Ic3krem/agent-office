# Town ground: grass, plaza pavers, dirt paths, stream with stone banks, bridges and the soil block sides. Original art, Apache-2.0.
# Run: blender -b -P art/blender/town_terrain.py -- <in town.json> <out raw dir>
# Writes terrain.png (10 px per unit) and terrain.json {originPx: [ox, oy]} = the pixel of world (0,0,0).
import sys, os, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit
from kit import box

args = sys.argv[sys.argv.index('--') + 1:]
town = json.load(open(args[0], encoding='utf8')); out = os.path.abspath(args[1]); os.makedirs(out, exist_ok=True)
kit.reset_scene(seed=7); rnd = kit.rnd
U = lambda r: [v / 10 for v in r]  # world-unit rect -> Blender units
W, D, DEP = town['size']['w'] / 10, town['size']['h'] / 10, town['block']['depth'] / 10
PLAZA, PATHS, WATER, BRIDGES = U(town['plaza']), [U(p) for p in town['paths']], [U(w) for w in town['water']], [U(b) for b in town['bridges']]
inside = lambda x, y, r, m=0: r[0] - m <= x <= r[2] + m and r[1] - m <= y <= r[3] + m
STONE = ['#9a948c', '#7f7a74', '#a39f99']

# ---- land levels: the same rules as TownMap.heightAt (LEVEL_H = 28 world units = 2.8 here; user decision 2026-11-08) ----
LH = 2.8
SH = LH / 1.4  # the contact shadow and face stones scale with the cliff height (tuned at LH 1.4)
LEVELS = [(U(t['rect']), t['level']) for t in town.get('levels', [])]
RAMPS = [(U(r['rect']), r['dir']) for r in town.get('ramps', [])]
_in = lambda x, y, r: r[0] <= x < r[2] and r[1] <= y < r[3]
def level_at(x, y):
    best = None
    for r, lv in LEVELS:
        if _in(x, y, r) and (best is None or (r[2] - r[0]) * (r[3] - r[1]) < (best[0][2] - best[0][0]) * (best[0][3] - best[0][1])): best = (r, lv)
    return best[1] if best else 0
def ramp_ends(r, d):
    x0, y0, x1, y1 = r; cx, cy, e = (x0 + x1) / 2, (y0 + y1) / 2, 0.05
    hi = {'n': (cx, y0 + e), 's': (cx, y1 - e), 'e': (x1 - e, cy), 'w': (x0 + e, cy)}[d]
    lo = {'n': (cx, y1 - e), 's': (cx, y0 + e), 'e': (x0 + e, cy), 'w': (x1 - e, cy)}[d]
    return level_at(*lo) * LH, level_at(*hi) * LH
def on_ramp(x, y): return any(_in(x, y, r) for r, _ in RAMPS)
def z_at(x, y):  # ground height; ramps are not scattered on, so they need no slope here
    return level_at(x, y) * LH
def flat(x, y, w, d):  # a patch that does not cross a cliff or a ramp
    pts = [(x, y), (x + w, y), (x, y + d), (x + w, y + d)]
    return len({level_at(*p) for p in pts}) == 1 and not any(on_ramp(*p) for p in pts)
def cut(r, holes):  # rect minus holes (same split as TownMap's water minus bridges)
    out = [r]
    for b in holes:
        nxt = []
        for q in out:
            if b[2] <= q[0] or b[0] >= q[2] or b[3] <= q[1] or b[1] >= q[3]: nxt.append(q); continue
            xa, xb = max(b[0], q[0]), min(b[2], q[2])
            if b[0] > q[0]: nxt.append([q[0], q[1], b[0], q[3]])
            if b[2] < q[2]: nxt.append([b[2], q[1], q[2], q[3]])
            if b[1] > q[1]: nxt.append([xa, q[1], xb, b[1]])
            if b[3] < q[3]: nxt.append([xa, b[3], xb, q[3]])
        out = nxt
    return out
def spans(a0, a1, holes):  # [a0, a1] minus the hole intervals
    out = [(a0, a1)]
    for h0, h1 in holes: out = [p for (u, v) in out for p in ((u, min(v, h0)), (max(u, h1), v)) if p[1] - p[0] > 0.05]
    return out

# ---- soil block with layered sides and embedded stones (only the +x and +y sides are seen) ----
t1, t2 = DEP * 0.4, DEP * 0.43
box(0, 0, -DEP, W, D, t1, '#6e4a33'); box(0, 0, -DEP + t1, W, D, t2, '#8c5e3c'); box(0, 0, -DEP + t1 + t2, W, D, DEP - t1 - t2, '#a46f45')
for _ in range(int((W + D) * 1.3)):
    z, h = rnd.uniform(-DEP + 0.4, -1.0), rnd.uniform(.4, .8)
    if rnd.random() < W / (W + D): box(rnd.uniform(0, W - 1.6), D, z, rnd.uniform(.8, 1.6), 0.1, h, rnd.choice(STONE))
    else: box(W, rnd.uniform(0, D - 1.6), z, 0.1, rnd.uniform(.8, 1.6), h, rnd.choice(STONE))
for _ in range(int((W + D) * 0.8)):  # roots and dark pebbles
    if rnd.random() < W / (W + D): box(rnd.uniform(0, W - .5), D, rnd.uniform(-DEP + .3, -.8), .3, .1, .3, '#5a3a28')
    else: box(W, rnd.uniform(0, D - .5), rnd.uniform(-DEP + .3, -.8), .1, .3, .3, '#5a3a28')
box(0, 0, -0.4, W, D, 0.4, '#5c9e3c')
box(0, D - 0.2, -0.9, W, 0.5, 0.9, '#4f8f35'); box(W - 0.2, 0, -0.9, 0.5, D, 0.9, '#4f8f35')  # grass lip
for i in range(int(W / 1.3)): box(i * 1.3 + rnd.uniform(0, .3), D + 0.25, -1.3, rnd.uniform(.4, .9), 0.12, rnd.uniform(.3, .6), '#4f8f35')
for i in range(int(D / 1.3)): box(W + 0.25, i * 1.3 + rnd.uniform(0, .3), -1.3, 0.12, rnd.uniform(.4, .9), rnd.uniform(.3, .6), '#4f8f35')

# ---- terraces: soil cliffs (the block's side layers and stones) under a grass top; a notch is left where a ramp climbs in ----
for r, lv in sorted(LEVELS, key=lambda t: t[1]):
    H = lv * LH
    notches = [rr for rr, d in RAMPS if ramp_ends(rr, d)[1] == H]
    for (x0, y0, x1, y1) in cut(r, notches):
        box(x0, y0, 0, x1 - x0, y1 - y0, (H - 0.4) * 0.55, '#8c5e3c'); box(x0, y0, (H - 0.4) * 0.55, x1 - x0, y1 - y0, (H - 0.4) * 0.45, '#a46f45')
        box(x0, y0, H - 0.4, x1 - x0, y1 - y0, 0.4, '#5c9e3c')
    x0, y0, x1, y1 = r
    base = lambda x, y: level_at(x, y) * LH  # the ground the cliff stands on
    for (a, b) in spans(x0, x1, [(n[0], n[2]) for n in notches]):  # south (+y) face, seen from the camera
        if y1 >= D: continue
        box(a, y1 - 0.2, H - 0.3, b - a, 0.35, 0.3, '#4f8f35')  # a thin grass lip, so the soil face shows
        z0 = base(a, y1 + .1)  # contact shadow on the low ground at the cliff foot, so the step reads as height
        box(a, y1, z0 + 0.04, b - a + 0.55 * SH, 0.55 * SH, 0.02, '#3f7a2c'); box(a, y1, z0 + 0.05, b - a + 0.22 * SH, 0.22 * SH, 0.02, '#5a3a28')
        for i in range(int((b - a) / 1.3)): box(a + i * 1.3 + rnd.uniform(0, .3), y1 + 0.15, H - 0.55, rnd.uniform(.3, .7), 0.1, rnd.uniform(.2, .35), '#4f8f35')
        for _ in range(int((b - a) * 1.2 * SH)):
            z0 = base(rnd.uniform(a, b), y1 + .1)
            if H - z0 > 1.2: box(rnd.uniform(a, b - .8), y1, rnd.uniform(z0 + .1, H - .8), rnd.uniform(.5, 1.0), 0.1, rnd.uniform(.2, .35), rnd.choice(STONE + ['#5a3a28']))
    for (a, b) in spans(y0, y1, [(n[1], n[3]) for n in notches]):  # east (+x) face
        if x1 >= W: continue
        box(x1 - 0.2, a, H - 0.3, 0.35, b - a, 0.3, '#4f8f35')
        z0 = base(x1 + .1, a)
        box(x1, a, z0 + 0.04, 0.55 * SH, b - a, 0.02, '#3f7a2c'); box(x1, a, z0 + 0.05, 0.22 * SH, b - a, 0.02, '#5a3a28')
        for i in range(int((b - a) / 1.3)): box(x1 + 0.15, a + i * 1.3 + rnd.uniform(0, .3), H - 0.55, 0.1, rnd.uniform(.3, .7), rnd.uniform(.2, .35), '#4f8f35')
        for _ in range(int((b - a) * 1.2 * SH)):
            z0 = base(x1 + .1, rnd.uniform(a, b))
            if H - z0 > 1.2: box(x1, rnd.uniform(a, b - .8), rnd.uniform(z0 + .1, H - .8), 0.1, rnd.uniform(.5, 1.0), rnd.uniform(.2, .35), rnd.choice(STONE + ['#5a3a28']))

# ---- ramps: a soil wedge from the low ground up into the notch, a dirt slope with treads, stone kerbs ----
for (x0, y0, x1, y1), d in RAMPS:
    zl, zh = ramp_ends((x0, y0, x1, y1), d)
    ns = d in ('n', 's')
    a0, a1 = (y0, y1) if ns else (x0, x1)  # along the climb
    b0, b1 = (x0, x1) if ns else (y0, y1)  # across it
    lo, hi = (a1, a0) if d in ('n', 'w') else (a0, a1)
    axis = 'x' if ns else 'y'
    T = 0.08
    kit.prism([(lo, zl), (hi, zh), (hi, zl)], b0, b1, '#8c5e3c', axis)
    kit.prism([(lo, zl), (hi, zh), (hi, zh + T), (lo, zl + T)], b0 + .25, b1 - .25, '#c49a62', axis)
    for (k0, k1) in ((b0, b0 + .25), (b1 - .25, b1)): kit.prism([(lo, zl), (hi, zh), (hi, zh + .2), (lo, zl + .2)], k0, k1, '#9a948c', axis)
    n = max(3, int(abs(hi - lo) / 0.7))
    for i in range(1, n):
        u = lo + (hi - lo) * i / n; z = zl + (zh - zl) * i / n + T
        if ns: box(b0 + .3, u - .06, z, b1 - b0 - .6, .12, .04, '#a98250')
        else: box(u - .06, b0 + .3, z, .12, b1 - b0 - .6, .04, '#a98250')

# ---- grass variation, tufts and wildflower specks ----
GRASS = ['#66aa44', '#549637', '#71b84b', '#4c8a33', '#5fa23f']
for _ in range(int(W * D * 0.14)):
    x, y, gw, gd = rnd.uniform(0, W - 1.2), rnd.uniform(0, D - 1.2), rnd.uniform(.5, 1.6), rnd.uniform(.5, 1.6)
    col = rnd.choice(GRASS)
    if flat(x, y, gw, gd): box(x, y, z_at(x, y), gw, gd, 0.03, col)
paved = lambda x, y: inside(x, y, PLAZA, .5) or any(inside(x, y, p, .3) for p in PATHS) or any(inside(x, y, w, .6) for w in WATER)
for _ in range(int(W * D * 0.05)):
    x, y = rnd.uniform(0.3, W - 0.5), rnd.uniform(0.3, D - 0.5)
    if paved(x, y): continue
    z, ok = z_at(x, y), flat(x, y, .2, .2)
    if rnd.random() < 0.7: h, col = rnd.choice([.12, .2]), rnd.choice(['#7cc455', '#4c8a33', '#3f7a2c'])
    else: h, col = .12, rnd.choice(['#ffd23f', '#ffffff', '#ff7aa8', '#8fc5ff'])
    if ok: box(x, y, z, .2, .2, h, col)

# ---- plaza: irregular stone pavers ----
PX0, PY0, PX1, PY1 = PLAZA
box(PX0 - .3, PY0 - .3, 0, PX1 - PX0 + .6, PY1 - PY0 + .6, 0.06, '#7d7468')
y = PY0
while y < PY1 - 0.3:
    hgt = rnd.choice([0.9, 1.1, 1.3]); x = PX0 + rnd.uniform(0, .6)
    while x < PX1 - 0.3:
        wd = min(rnd.choice([0.9, 1.2, 1.5, 1.8]), PX1 - x)
        box(x + 0.06, y + 0.06, 0.06, wd - 0.12, min(hgt, PY1 - y) - 0.12, 0.08, rnd.choice(['#c2b49a', '#b5a78d', '#cdbfa6', '#a89a80', '#bbac90']))
        x += wd
    y += hgt

# ---- dirt paths with specks and a few stepping stones ----
for (x0, y0, x1, y1) in PATHS:
    box(x0, y0, 0, x1 - x0, y1 - y0, 0.07, '#c49a62')
    for _ in range(int((x1 - x0) * (y1 - y0) / 2)): box(rnd.uniform(x0, x1 - .4), rnd.uniform(y0, y1 - .4), 0.07, .35, .35, .03, rnd.choice(['#a98250', '#d8b07a']))
    for _ in range(int((x1 - x0) * (y1 - y0) / 12)): box(rnd.uniform(x0 + .2, x1 - 1), rnd.uniform(y0 + .2, y1 - 1), 0.07, .7, .6, .06, rnd.choice(['#b3a68e', '#a39f99']))

# ---- stream with irregular stone banks, ripples and a waterfall off the east edge ----
for (x0, y0, x1, y1) in WATER:
    box(x0, y0 + .3, 0, x1 - x0, y1 - y0 - .6, 0.08, '#3f8fc4')
    box(x0, y0 + .6, 0.08, x1 - x0, .25, 0.01, '#2f78b0'); box(x0, y1 - .85, 0.08, x1 - x0, .25, 0.01, '#5aa6d6')
    x = x0
    while x < x1:
        sw = min(rnd.uniform(.6, 1.3), x1 - x)
        for (yy, dy) in ((y0, 1), (y1, -1)):
            th = rnd.uniform(.35, .6); box(x, yy if dy > 0 else yy - th, 0, sw - .05, th, rnd.uniform(.15, .3), rnd.choice(['#8f8a83', '#a39f99', '#b3aea6', '#7b7874']))
        x += sw
    for _ in range(int((x1 - x0) / 2.2)): box(rnd.uniform(x0, x1 - 1), rnd.uniform(y0 + 1, y1 - 1.3), 0.08, rnd.uniform(.4, .9), .12, .02, '#bfe6ff')
    if x1 >= W:  # waterfall down the soil side
        box(W, y0 + .3, -DEP - 0.6, 0.12, y1 - y0 - .6, DEP + 0.68, '#3f8fc4')
        for _ in range(14): box(W + 0.12, rnd.uniform(y0 + .4, y1 - .8), rnd.uniform(-DEP, -1), .02, .3, rnd.uniform(1, 2.5), '#bfe6ff')
    if y1 >= D: box(x0, D, -DEP - 0.6, x1 - x0, 0.12, DEP + 0.68, '#3f8fc4')

# ---- wooden bridges (deck runs north-south) ----
for (x0, y0, x1, y1) in BRIDGES:
    bw, bd = x1 - x0, y1 - y0
    box(x0 + .2, y0, 0.15, bw - .4, bd, 0.2, '#7a4a2a')
    for j in range(int(bd / 0.62)): box(x0 + .2, y0 + j * 0.62 + .06, 0.35, bw - .4, 0.52, 0.08, '#b8794a' if j % 2 else '#a8693a')
    for xx in (x0, x1 - .3):
        box(xx, y0 + .3, 0.35, 0.3, bd - .6, 0.15, '#7a4a2a'); box(xx, y0 + .3, 0.95, 0.3, bd - .6, 0.15, '#a8693a')
        for k in range(4): box(xx, y0 + .3 + k * (bd - .9) / 3, 0.35, 0.3, 0.3, 0.8, '#6b4226')

kit.flush('terrain')
w, h, ox, oy = kit.frame(kit.bounds(), 3)
kit.render(os.path.join(out, 'terrain.png'))
# levelsHash: art-output.test checks it against town.json, so editing levels or ramps without rerunning the art fails a test
import hashlib
sig = ';'.join(','.join(str(v) for v in t['rect']) + ':' + str(t['level']) for t in town.get('levels', [])) + '|' + ';'.join(','.join(str(v) for v in r['rect']) + ':' + r['dir'] for r in town.get('ramps', []))
json.dump({'originPx': [ox, oy], 'levelsHash': hashlib.sha256(sig.encode()).hexdigest()[:16], 'levelH': round(LH * 10)}, open(os.path.join(out, 'terrain.json'), 'w', newline='\n'))
print('TERRAIN', w, h, ox, oy)
