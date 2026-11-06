# Town building and prop sprites. Original art, Apache-2.0.
# Run: blender -b -P art/blender/town_assets.py -- <in town.json> <out raw dir>
# Each asset is modelled around its world origin (footprint centre, x east, y south) and rendered three times:
# <name>.png (colour, no ground), <name>.ground.png (white ground, shadows on), <name>.noshadow.png (ground, shadows off),
# plus <name>.json {anchor: [ax, ay], footprint: [x0, y0, x1, y1] in world units, relative to the origin}.
import sys, os, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import kit
from kit import box, cyl, cone, blob, roof, planks, stones_base, window, prism

args = sys.argv[sys.argv.index('--') + 1:]
town = json.load(open(args[0], encoding='utf8')); out = os.path.abspath(args[1]); os.makedirs(out, exist_ok=True)
FLOWERS = ['#e8566b', '#ffcf4d', '#ffffff', '#c86bd6']
def R(): return kit.rnd

# footprint (w, d) in units per building type, from town.json (fallbacks for types the map does not use yet)
FOOT = {'office-modern': (18, 10), 'office-country': (18, 10), 'office-japanese': (18, 10), 'karinderya': (12, 9), 'gamehall': (13, 10), 'lot-empty': (18, 10)}
for l in town['lots']:
    f = l['building']['footprint']; FOOT[l['building']['type']] = ((f[2] - f[0]) / 10, (f[3] - f[1]) / 10)


# ---------------- props (lifted from the spike) ----------------
def tree(x, y, s=1.0, tones=('#3e7d34', '#4e9a3c', '#62b04a', '#2f6a2c')):
    cyl(x, y, 0, 0.35 * s, 2.4 * s, '#6b4226', 6)
    for (dx, dy, dz, r) in [(0, 0, 3.2, 1.9), (-1.0, 0.5, 2.6, 1.3), (1.0, -0.4, 2.8, 1.3), (0.2, 0.3, 4.4, 1.3), (0.6, 0.9, 3.4, 1.1), (-0.5, -0.8, 3.6, 1.0)]:
        blob(x + dx * s, y + dy * s, dz * s, r * s, R().choice(tones))
    for _ in range(5): blob(x + R().uniform(-1.3, 1.3) * s, y + R().uniform(-1.3, 1.3) * s, R().uniform(3.0, 4.6) * s, 0.35 * s, '#7cc455')


def pine(x, y, s=1.0):
    cyl(x, y, 0, 0.25 * s, 1.2 * s, '#5a3a22', 6)
    for i, (r, h) in enumerate([(1.6, 2.2), (1.25, 2.0), (0.9, 1.8)]): cone(x, y, (1.0 + i * 1.3) * s, r * s, h * s, ['#2f5e3a', '#36704a', '#3f7f52'][i], 8)


def bush(x, y, s=1.0, berries=False):
    for (dx, dy, r) in [(0, 0, .8), (.6, .2, .6), (-.5, .3, .6)]: blob(x + dx * s, y + dy * s, .6 * s, r * s, R().choice(['#4b9a3e', '#3f8a37', '#5aa847']))
    if berries:
        for _ in range(6): blob(x + R().uniform(-.7, .7) * s, y + R().uniform(-.3, .7) * s, R().uniform(.7, 1.1) * s, .13, '#e04a5a')


def barrel(x, y): cyl(x, y, 0, 0.45, 1.0, '#8a5a32', 10); cyl(x, y, 0.15, 0.47, 0.12, '#4a4a52', 10); cyl(x, y, 0.75, 0.47, 0.12, '#4a4a52', 10); cyl(x, y, 1.0, 0.36, 0.03, '#6b4226', 10)


def crate(x, y, h=0.8):
    box(x, y, 0, 0.9, 0.9, h, '#b07a45'); box(x + 0.05, y + 0.9, 0.1, 0.8, 0.04, h - 0.2, '#8a5a32'); box(x + 0.9, y + 0.05, 0.1, 0.04, 0.8, h - 0.2, '#8a5a32')


def lamp(x, y):
    cyl(x, y, 0, 0.3, 0.3, '#2e2a30', 8); cyl(x, y, 0, 0.1, 4.0, '#2e2a30', 6)
    box(x - 0.35, y - 0.35, 4.0, 0.7, 0.7, 0.7, '#ffcf6b', 3.0); box(x - 0.45, y - 0.45, 4.7, 0.9, 0.9, 0.2, '#2e2a30')


def fence_run(x0, y0, x1, y1):
    n = max(1, int(math.hypot(x1 - x0, y1 - y0) / 1.2))
    for i in range(n + 1):
        t = i / n; box(x0 + (x1 - x0) * t - 0.13, y0 + (y1 - y0) * t - 0.13, 0, 0.26, 0.26, 1.3, '#7a4a2a')
    if x0 == x1: box(x0 - 0.06, min(y0, y1), 0.8, 0.12, abs(y1 - y0), 0.18, '#a8693a'); box(x0 - 0.06, min(y0, y1), 0.35, 0.12, abs(y1 - y0), 0.15, '#a8693a')
    else: box(min(x0, x1), y0 - 0.06, 0.8, abs(x1 - x0), 0.12, 0.18, '#a8693a'); box(min(x0, x1), y0 - 0.06, 0.35, abs(x1 - x0), 0.12, 0.15, '#a8693a')


def flowerbox(x, y, w):
    for i in range(int(w / 0.35)): box(x + i * 0.35, y + 0.2, 0, 0.3, 0.3, 0.3, R().choice(FLOWERS))


def stool(x, y, c): box(x - .3, y - .3, 0.55, .6, .6, .12, c); [box(x + dx, y + dy, 0, .1, .1, .55, c) for dx in (-.28, .18) for dy in (-.28, .18)]


def umbrella_table(x, y, top):
    cyl(x, y, 0, 0.12, 1.0, '#5a5a62', 6); cyl(x, y, 1.0, 0.85, 0.1, '#f6efe3', 12); cyl(x, y, 1.1, 0.05, 2.0, '#5a5a62', 6)
    cone(x, y, 2.9, 1.7, 0.7, top, 8); cyl(x, y, 2.85, 1.72, 0.08, '#f6efe3', 8)
    for (dx, dy, c) in [(-1.2, 0.1, '#d63a3a'), (1.2, -0.1, '#2f78d6'), (0.1, 1.2, '#2f78d6'), (-0.1, -1.2, '#d63a3a')]: stool(x + dx, y + dy, c)


# ---------------- buildings ----------------
def office_modern():
    w, d = FOOT['office-modern']; OX, OY, OW, OD = -w / 2, -d / 2, w, d
    fy = OY + OD  # south (front) wall, faces the plaza
    stones_base(OX, OY, OW, OD)
    planks(OX, OY, 0.8, OW, OD, 7.2, ['#c58b56', '#b77d4a', '#d0965f'], 'x', 0.5)
    box(OX - 0.05, OY - 0.05, 4.5, OW + 0.1, OD + 0.1, 0.3, '#8a5a36')  # floor band between storeys
    for i in range(4):
        if i != 2: window(OX + 1.0 + i * 4.3, fy + 0.02, 1.6, 3.0, 2.4)
        window(OX + 1.0 + i * 4.3, fy + 0.02, 5.2, 3.0, 2.0)
    for i in range(2): window(OX + OW + 0.02, OY + 1.2 + i * 4.6, 1.6, 3.2, 2.4, 'x'); window(OX + OW + 0.02, OY + 1.2 + i * 4.6, 5.2, 3.2, 2.0, 'x')
    # glass door with a slate canopy and porch step
    box(-1.5, fy + 0.02, 0.8, 3, 0.2, 3.0, '#5a341c'); box(-1.2, fy + 0.1, 0.9, 2.4, 0.14, 2.6, '#ffd98a', 1.2)
    box(-0.06, fy + 0.18, 0.9, 0.12, 0.1, 2.6, '#5a341c'); box(-2, fy, 0, 4, 1.2, 0.8, '#9a958d')
    box(-2.5, fy, 3.9, 5, 1.8, 0.25, '#4a5a6a'); box(-2.5, fy + 1.7, 3.6, 0.15, 0.15, 0.3, '#2e2a30'); box(2.35, fy + 1.7, 3.6, 0.15, 0.15, 0.3, '#2e2a30')
    box(-3.5, fy + 0.1, 8.2, 7, 0.15, 1.1, '#6b4530'); box(-3.2, fy + 0.22, 8.4, 6.4, 0.08, 0.7, '#f3e3c3')  # sign board
    for i in range(5): box(-2.7 + i * 1.15, fy + 0.3, 8.55, 0.7, 0.04, 0.4, ['#3a5a7a', '#b8432f', '#3a5a7a', '#e3b23c', '#3a5a7a'][i])
    roof(OX, OY, 8.0, OW, OD, 3.4, ['#4a5a72', '#56688a'], over=0.6, rows=7)
    box(OX + 3, OY + 2.5, 10.6, 1.0, 1.0, 1.6, '#8d8a86'); box(OX + 2.9, OY + 2.4, 12.2, 1.2, 1.2, 0.2, '#6f6b66')  # chimney
    for x in (OX + 0.5, OX + OW - 2.5): box(x, fy + 0.4, 0, 2, 1, 0.8, '#7a4a2a'); bush(x + 1, fy + 0.9, .7, True)
    flowerbox(3.0, fy + 0.3, 3.5); flowerbox(-6.5, fy + 0.3, 3.5)
    return w, d


def karinderya():
    # The door faces west (plaza) but the camera sees only the south and east walls, so the turo-turo counter,
    # awning, sign and tables sit on the south wall, next to the west corner.
    w, d = FOOT['karinderya']; KX, KY, KW, KD = -w / 2, -d / 2, w, d
    fy = KY + KD
    stones_base(KX, KY, KW, KD, 0.7)
    planks(KX, KY, 0.7, KW, KD, 3.8, ['#d39a5e', '#c48a52', '#dba468'], 'x', 0.45)
    roof(KX, KY, 4.5, KW, KD, 3.4, ['#b8432f', '#c9533a', '#a63a28'], over=0.6, rows=7)
    # open serving hatch behind the counter, food trays on the counter
    box(KX + 0.8, fy + 0.02, 1.5, 7.4, 0.14, 1.9, '#3a2416')
    box(KX + 0.6, fy, 0, 7.8, 1.1, 1.3, '#8a5a32'); box(KX + 0.5, fy, 1.3, 8.0, 1.25, 0.12, '#e8dcc4')
    for i in range(7): box(KX + 0.8 + i * 1.08, fy + 0.4, 0.2, 0.9, 0.06, 0.9, '#a8693a' if i % 2 else '#9c5e32')
    for i, c in enumerate(['#7a3b1c', '#e3b23c', '#9cc06a', '#c98d3a', '#f6f1e3', '#c0392b', '#d9773a']):
        box(KX + 0.8 + i * 1.05, fy + 0.15, 1.42, 0.9, 0.85, 0.08, '#c9ccd0'); box(KX + 0.9 + i * 1.05, fy + 0.25, 1.5, 0.7, 0.65, 0.12, c)
    box(KX + 0.6, fy + 0.35, 1.42, 0.3, 0.3, 0.5, '#f6efe3'); box(KX + 7.9, fy + 0.25, 1.42, 0.5, 0.4, 0.45, '#d63a3a')  # rice pot, thermos
    # striped awning sloping out over the counter, string lights along its edge
    for i in range(16):
        x0 = KX + 0.2 + i * 0.55
        prism([(fy, 3.7), (fy + 2.4, 2.9), (fy + 2.4, 2.75), (fy, 3.55)], x0, x0 + 0.55, '#e05545' if i % 2 == 0 else '#f6efe3')
    for i in range(16): box(KX + 0.2 + i * 0.55, fy + 2.35, 2.5, 0.55, 0.06, 0.25, '#e05545' if i % 2 == 0 else '#f6efe3')
    for x in (KX + 0.3, KX + 8.8): box(x, fy + 2.2, 0, 0.15, 0.15, 2.9, '#6b4226')
    for i in range(12): box(KX + 0.4 + i * 0.75, fy + 2.5, 2.25 - (i % 2) * 0.15, .2, .2, .2, ['#ffd27a', '#ff8a6b', '#9fe07a'][i % 3], 4)
    # hand-painted sign above the awning
    box(KX + 1.6, fy + 0.08, 3.85, 6.2, 0.12, 0.62, '#f1c40f'); box(KX + 1.75, fy + 0.18, 3.95, 5.9, 0.06, 0.42, '#b3261e')
    for i in range(8): box(KX + 2.0 + i * 0.7, fy + 0.22, 4.03, 0.45, 0.04, 0.26, '#fbeed2')
    # side door and window on the east wall, menu board
    window(KX + KW + 0.02, KY + 1.4, 1.6, 2.4, 1.8, 'x'); box(KX + KW + 0.02, KY + 5.2, 0.7, 0.2, 1.8, 2.8, '#5a341c')
    box(KX + 9.4, fy + 0.6, 0, 1.2, .1, 1.6, '#2e3a2e'); box(KX + 9.5, fy + 0.65, .3, 1.0, .06, 1.2, '#3c5a3c')
    for i in range(4): box(KX + 9.6, fy + 0.7, .5 + i * .25, 0.4 + (i % 2) * 0.3, .03, .08, '#f6efe3')
    # outdoor tables with umbrellas and plastic stools in front
    umbrella_table(KX + 2.4, fy + 4.0, '#e05545'); umbrella_table(KX + 7.0, fy + 4.4, '#2f78d6')
    return w, d


def gamehall():
    # red barn arcade; the gable end with the barn door, neon sign and cabinets faces east (the plaza)
    w, d = FOOT['gamehall']; GX, GY, GW, GD = -w / 2, -d / 2, w, d
    ex = GX + GW
    stones_base(GX, GY, GW, GD, 0.7)
    planks(GX, GY, 0.7, GW, GD, 4.8, ['#b5402f', '#a63a2b', '#c04a36'], 'y', 0.5)
    for z in (0.7, 5.3): box(GX - 0.05, GY - 0.05, z, GW + 0.1, GD + 0.1, 0.2, '#f3ede2')  # white trim bands
    for (x, y) in [(GX - 0.08, GY - 0.08), (ex - 0.12, GY - 0.08), (GX - 0.08, GY + GD - 0.12), (ex - 0.12, GY + GD - 0.12)]: box(x, y, 0.7, 0.2, 0.2, 4.8, '#f3ede2')
    roof(GX, GY, 5.5, GW, GD, 3.8, ['#5a4a46', '#665450'], over=0.6, rows=7, trim='#b5402f')
    for t in range(8):  # white boards up the east gable edge
        f = t / 8; box(ex + 0.02, GY + f * GD / 2, 5.5 + f * 3.8, 0.12, 0.65, 0.25, '#f3ede2'); box(ex + 0.02, GY + GD - f * GD / 2 - 0.65, 5.5 + f * 3.8, 0.12, 0.65, 0.25, '#f3ede2')
    # barn door with X braces
    box(ex + 0.02, GY + 2.8, 0.7, 0.14, 4.4, 3.6, '#f3ede2'); box(ex + 0.05, GY + 3.0, 0.7, 0.14, 4.0, 3.3, '#5a2a22')
    box(ex + 0.1, GY + 4.94, 0.7, 0.14, 0.12, 3.3, '#f3ede2')
    for (y0, y1) in [(GY + 3.0, GY + 4.94), (GY + 5.06, GY + 7.0)]:
        for k in range(9):
            t = k / 8; box(ex + 0.12, y0 + (y1 - y0) * t - 0.08, 0.8 + 3.0 * t, 0.06, 0.16, 0.2, '#f3ede2'); box(ex + 0.12, y0 + (y1 - y0) * t - 0.08, 3.8 - 3.0 * t, 0.06, 0.16, 0.2, '#f3ede2')
    box(ex + 0.2, GY + 4.6, 0.7, 0.14, 0.8, 1.2, '#ffd98a', 1.5)  # warm light through the door gap
    # neon sign on the gable
    box(ex + 0.1, GY + 2.9, 5.9, 0.1, 4.2, 1.2, '#2b1d3a'); box(ex + 0.15, GY + 3.05, 6.05, 0.08, 3.9, 0.9, '#ff5c8a', 3.5)
    for i in range(5): box(ex + 0.22, GY + 3.25 + i * 0.75, 6.2, 0.04, 0.45, 0.6, '#2b1d3a')
    box(ex + 0.15, GY + 3.6, 7.25, 0.08, 2.8, 0.25, '#3dd6ff', 3.5)
    window(ex + 0.02, GY + 0.6, 1.8, 1.6, 1.8, 'x'); window(ex + 0.02, GY + 7.8, 1.8, 1.6, 1.8, 'x')
    window(GX + 2, GY + GD + 0.02, 2.0, 2.4, 1.8); window(GX + 8.5, GY + GD + 0.02, 2.0, 2.4, 1.8)
    # arcade cabinets either side of the door
    for (y, c) in [(GY + 1.0, '#3dd6ff'), (GY + 7.9, '#ffd23f')]:
        x = ex + 0.6
        box(x, y, 0, 1.1, 1.1, 2.5, '#2a2430'); box(x + 0.9, y + 0.1, 1.0, 0.5, 0.9, 0.3, '#3a3440')
        box(x + 1.12, y + 0.15, 1.5, 0.06, 0.8, 0.7, c, 3); box(x + 1.0, y + 0.1, 2.3, 0.15, 0.9, 0.2, '#ff5c8a', 2.5)
        box(x + 1.4, y + 0.3, 1.32, 0.12, 0.12, 0.12, '#e04a5a'); box(x + 1.4, y + 0.6, 1.32, 0.12, 0.12, 0.12, '#3dd6ff')
        box(x - 0.02, y + 0.42, 0.3, 0.02, 0.26, 2.0, c, 1.5)
    box(GX + 3, GY + GD + 1.2, 0, 1.8, 1.2, 0.9, '#a8693a'); cyl(GX + 4, GY + GD + 1.7, 0.9, 0.4, 0.1, '#e8e2d2', 10)
    return w, d


def lot_empty():
    # a friend's empty lot: fenced garden plot (gap in the north fence by the door)
    w, d = FOOT['lot-empty']; LX, LY = -w / 2, -d / 2
    box(LX + .3, LY + .3, 0, w - .6, d - .6, 0.05, '#8a6a46')
    for k in range(int((d - 1) / 1.3)):
        box(LX + 1, LY + .8 + k * 1.3, 0.05, w - 2, 0.6, 0.1, '#6f5236')
        for j in range(int((w - 3) / 1.6)):
            if R().random() < .6: box(LX + 1.6 + j * 1.6 + R().uniform(0, .4), LY + .9 + k * 1.3, 0.15, .3, .3, R().choice([.25, .4]), R().choice(['#5fb84a', '#4c9a3a', '#7cc455']))
    fence_run(LX, LY + d, LX + w, LY + d); fence_run(LX, LY, LX, LY + d); fence_run(LX + w, LY, LX + w, LY + d)
    fence_run(LX, LY, -1.5, LY); fence_run(1.5, LY, LX + w, LY)
    barrel(LX + w - 1.2, LY + d - 1.4); crate(LX + 0.6, LY + d - 1.6)
    return w, d


def greybox(kind):
    def build():
        w, d = FOOT[kind]
        box(-w / 2, -d / 2, 0, w, d, 6, '#9a9a9a'); box(-w / 2 - .4, -d / 2 - .4, 6, w + .8, d + .8, .5, '#7a7a7a'); box(-w / 2 + 1, -d / 2 + 1, 6.5, w - 2, d - 2, 2.5, '#8a8a8a')
        box(-1.5, d / 2, 0, 3, 0.15, 3, '#5a5a5a')
        return w, d
    return build


def well():
    for a in range(12):
        ang = a / 12 * 2 * math.pi; box(math.cos(ang) * 2.0 - .45, math.sin(ang) * 2.0 - .45, 0, 0.9, 0.9, 1.0, R().choice(['#a39f99', '#8f8b85', '#b3aea6']))
    cyl(0, 0, 0, 1.7, 0.8, '#4f9fd1', 16); cyl(0.3, -0.2, 0.8, 0.3, 0.02, '#bfe6ff', 8)
    for dx in (-1.6, 1.6): box(dx - .15, -.15, 0, .3, .3, 3.6, '#6b4226')
    box(-1.6, -.08, 3.0, 3.2, .16, .16, '#5a3a2a'); cyl(0, 0, 2.2, 0.25, 0.5, '#8a5a32', 8)
    roof(-2.0, -1.6, 3.6, 4.0, 3.2, 1.3, ['#8a3b2a', '#9c4632'], over=0.3, rows=3)
    for a in range(14):
        ang = a / 14 * 2 * math.pi; box(math.cos(ang) * 2.9 - .15, math.sin(ang) * 2.9 - .15, 0, .3, .3, .35, R().choice(FLOWERS))
    return 1, 1


def bench():
    box(-1.4, -0.45, 0.5, 2.8, 0.9, 0.15, '#a8693a'); box(-1.4, 0.3, 0.65, 2.8, 0.15, 0.8, '#a8693a')
    box(-1.3, -0.45, 0, .2, .9, .5, '#4a3a32'); box(1.1, -0.45, 0, .2, .9, .5, '#4a3a32')
    return 1, 1


def flowers():
    for (dx, dy) in [(-.3, -.2), (.3, .1), (0, .4), (-.1, -.5), (.45, -.35)]: blob(dx, dy, 0.15, 0.3, R().choice(['#4c9a3a', '#5fb84a']))
    for _ in range(12): box(R().uniform(-.6, .5), R().uniform(-.6, .5), 0.2, .2, .2, R().choice([.25, .35, .45]), R().choice(FLOWERS))
    return 1, 1


def sign():
    box(-0.1, -0.1, 0, 0.2, 0.2, 2.2, '#7a4a2a')
    box(-1.0, 0.1, 1.2, 2.0, 0.12, 0.9, '#efe0bd'); box(-1.1, 0.05, 1.1, 2.2, 0.1, 1.1, '#7a4a2a')
    for i in range(3): box(-0.75 + i * 0.55, 0.22, 1.45, 0.4, 0.04, 0.4, ['#b8432f', '#3a5a7a', '#4c9a3a'][i])
    return 1, 1


ASSETS = {
    'office-modern': office_modern, 'office-country': greybox('office-country'), 'office-japanese': greybox('office-japanese'),
    'karinderya': karinderya, 'gamehall': gamehall, 'lot-empty': lot_empty,
    'tree-round': lambda: (tree(0, 0, 1.05), (1, 1))[1], 'tree-pine': lambda: (pine(0, 0, 1.05), (1, 1))[1],
    'bush': lambda: (bush(0, 0, 0.8, True), (1, 1))[1], 'bench': bench, 'lamp': lambda: (lamp(0, 0), (1, 1))[1], 'well': well,
    'barrel': lambda: (barrel(0, 0), (1, 1))[1], 'crate': lambda: (crate(-0.45, -0.45), (1, 1))[1], 'flowers': flowers, 'sign': sign,
}
only = set(args[2].split(',')) if len(args) > 2 else None  # optional: render a subset while iterating

for i, (name, build) in enumerate(ASSETS.items()):
    if only and name not in only: continue
    sc = kit.reset_scene(seed=100 + i)
    w, d = build(); kit.flush(name)
    b = kit.bounds()
    # white ground plane under the asset, reaching as far as its shadow can fall
    xs, ys, top = [], [], 0
    for o in sc.objects:
        if o.type == 'MESH':
            for c in o.bound_box:
                v = o.matrix_world @ kit.Vector(c); xs.append(v.y); ys.append(v.x); top = max(top, v.z / kit.ZS)
    sx, sy, sz = kit.sun_dir(); L = top / -sz
    gx0, gx1 = min(xs) + min(0, sx * L) - 1, max(xs) + max(0, sx * L) + 1
    gy0, gy1 = min(ys) + min(0, sy * L) - 1, max(ys) + max(0, sy * L) + 1
    box(gx0, gy0, -0.1, gx1 - gx0, gy1 - gy0, 0.1, '#ffffff'); ground = kit.flush('ground')
    bw, bh, ox, oy = kit.frame(kit.bounds(), 2)
    sun = sc.objects['sun'].data
    for g in ground: g.hide_render = True
    kit.render(os.path.join(out, name + '.png'))
    for g in ground: g.hide_render = False
    kit.render(os.path.join(out, name + '.ground.png'))
    sun.use_shadow = False
    kit.render(os.path.join(out, name + '.noshadow.png'))
    json.dump({'anchor': [ox, oy], 'footprint': [-w * 5, -d * 5, w * 5, d * 5]}, open(os.path.join(out, name + '.json'), 'w', newline='\n'))
    print('ASSET', name, bw, bh, ox, oy)
print('DONE')
