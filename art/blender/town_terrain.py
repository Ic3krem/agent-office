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

# ---- grass variation, tufts and wildflower specks ----
GRASS = ['#66aa44', '#549637', '#71b84b', '#4c8a33', '#5fa23f']
for _ in range(int(W * D * 0.14)):
    x, y = rnd.uniform(0, W - 1.2), rnd.uniform(0, D - 1.2)
    box(x, y, 0, rnd.uniform(.5, 1.6), rnd.uniform(.5, 1.6), 0.03, rnd.choice(GRASS))
paved = lambda x, y: inside(x, y, PLAZA, .5) or any(inside(x, y, p, .3) for p in PATHS) or any(inside(x, y, w, .6) for w in WATER)
for _ in range(int(W * D * 0.05)):
    x, y = rnd.uniform(0.3, W - 0.5), rnd.uniform(0.3, D - 0.5)
    if paved(x, y): continue
    if rnd.random() < 0.7: box(x, y, 0, .2, .2, rnd.choice([.12, .2]), rnd.choice(['#7cc455', '#4c8a33', '#3f7a2c']))
    else: box(x, y, 0, .2, .2, .12, rnd.choice(['#ffd23f', '#ffffff', '#ff7aa8', '#8fc5ff']))

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
json.dump({'originPx': [ox, oy]}, open(os.path.join(out, 'terrain.json'), 'w'))
print('TERRAIN', w, h, ox, oy)
