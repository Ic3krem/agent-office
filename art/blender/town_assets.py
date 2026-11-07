# Town building and prop sprites. Original art, Apache-2.0.
# Run: blender -b -P art/blender/town_assets.py -- <in town.json> <out raw dir>
# Each asset is modelled around its world origin (footprint centre, x east, y south) and rendered three times:
# <name>.png (colour, no ground), <name>.ground.png (white ground, shadows on), <name>.noshadow.png (ground, shadows off),
# <name>.glow.png (emissive parts only: lit windows, lamps, neon) for assets with any,
# plus <name>.json {anchor: [ax, ay], footprint: [x0, y0, x1, y1] in world units, relative to the origin, glow}.
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
    box(LX + w - 0.5, LY + d + 0.3, 0, 0.2, 0.2, 2.4, '#5a3a22'); box(LX + w - 0.75, LY + d + 0.15, 2.4, 0.7, 0.5, 0.15, '#2e2a30')  # garden lantern
    box(LX + w - 0.65, LY + d + 0.2, 2.0, 0.5, 0.4, 0.4, '#ffcf6b', 3.0)
    return w, d


def sill_flowers(x, y, z, w, face='y'):
    """Window box under a window on the +y or +x wall: planter plus a row of flowers."""
    if face == 'y':
        box(x - 0.2, y + 0.1, z - 0.8, w + 0.4, 0.55, 0.45, '#7a4a2a')
        for i in range(int((w + 0.2) / 0.35)): box(x - 0.1 + i * 0.35, y + 0.2, z - 0.4, 0.3, 0.35, 0.3, R().choice(FLOWERS))
    else:
        box(x + 0.1, y - 0.2, z - 0.8, 0.55, w + 0.4, 0.45, '#7a4a2a')
        for i in range(int((w + 0.2) / 0.35)): box(x + 0.2, y - 0.1 + i * 0.35, z - 0.4, 0.35, 0.3, 0.3, R().choice(FLOWERS))


def office_country():
    # rustic farmhouse: tall stone base, honey clapboard, one storey under a steep shingle roof with a dormer,
    # a stone chimney up the east gable, a porch with posts round the door, window boxes and green shutters
    w, d = FOOT['office-country']; OX, OY, OW, OD = -w / 2, -d / 2, w, d
    fy, ex, WT = OY + OD, OX + OW, 5.6  # front wall, east wall, wall top
    stones_base(OX, OY, OW, OD, 1.2)
    for k in range(int((WT - 1.2) / 0.4)):  # horizontal clapboard, each board lapped a little proud of the one above
        box(OX - 0.04 * (k % 2), OY - 0.04 * (k % 2), 1.2 + k * 0.4, OW + 0.08 * (k % 2), OD + 0.08 * (k % 2), 0.4, ['#d9a066', '#c98f58', '#e0aa70'][k % 3])
    for (x, y) in [(OX - 0.1, fy - 0.15), (ex - 0.15, fy - 0.15), (ex - 0.15, OY - 0.1)]: box(x, y, 1.2, 0.25, 0.25, WT - 1.2, '#f3e3c3')  # corner boards
    roof(OX, OY, WT, OW, OD, 6.6, ['#8a4a36', '#9c5640', '#7a4030'], over=0.7, rows=11, trim='#d39a5e', ridge='#5a2e22')
    # dormer on the front slope: box, warm window, its own little gable facing south
    box(-1.8, -0.6, 8.0, 3.6, 3.2, 2.6, '#e0aa70'); window(-0.9, 2.62, 8.7, 1.8, 1.4)
    prism([(-1.9, 10.3), (1.9, 10.3), (0, 11.7)], -0.6, 2.65, '#d39a5e', 'y')
    prism([(-2.3, 10.2), (0, 12.1), (2.3, 10.2), (1.9, 10.2), (0, 11.7), (-1.9, 10.2)], -0.8, 3.0, '#8a4a36', 'y')
    # stone chimney climbing the east gable
    box(ex, -1.1, 0, 1.4, 2.2, 13.4, '#8d8a86'); box(ex - 0.1, -1.2, 13.4, 1.6, 2.4, 0.35, '#6f6b66')
    for _ in range(40):
        z = R().uniform(0, 13.0)
        if R().random() < .5: box(ex + 1.42, R().uniform(-1.1, 0.4), z, 0.06, R().uniform(0.5, 0.8), 0.32, R().choice(kit.STONES))
        else: box(ex + R().uniform(0, 0.8), 1.12, z, R().uniform(0.4, 0.6), 0.06, 0.32, R().choice(kit.STONES))
    # porch: plank deck, steps, four posts, rail, shingle lean-to roof
    PX0, PX1, PD = -4.6, 4.6, 2.6
    planks(PX0, fy, 0, PX1 - PX0, PD, 1.1, ['#a8693a', '#b07a45'], 'x', 0.45)
    box(-1.3, fy + PD, 0, 2.6, 0.7, 0.75, '#9a958d'); box(-1.3, fy + PD + 0.7, 0, 2.6, 0.6, 0.4, '#a39f99')
    for x in (PX0, -1.6, 1.4, PX1 - 0.2): box(x, fy + PD - 0.25, 1.1, 0.2, 0.2, 3.5, '#f3e3c3')
    for (x0, x1) in [(PX0, -1.6), (1.6, PX1)]:
        box(x0, fy + PD - 0.2, 2.1, x1 - x0, 0.12, 0.15, '#f3e3c3')
        for i in range(int((x1 - x0) / 0.5)): box(x0 + 0.2 + i * 0.5, fy + PD - 0.2, 1.1, 0.1, 0.1, 1.0, '#f3e3c3')
    for i in range(int((PX1 - PX0 + 1.0) / 0.55)):
        prism([(fy, 5.4), (fy + PD + 0.4, 4.6), (fy + PD + 0.4, 4.4), (fy, 5.2)], PX0 - 0.5 + i * 0.55, PX0 + 0.05 + i * 0.55, ['#8a4a36', '#9c5640'][i % 2])
    # door (with a little lit window) and windows: two on the porch, two outside it with shutters and window boxes
    box(-1.0, fy + 0.02, 1.1, 2.0, 0.16, 3.0, '#7a3f24'); box(-0.5, fy + 0.1, 3.0, 1.0, 0.12, 0.8, '#ffd98a', 1.4)
    box(0.5, fy + 0.18, 2.3, 0.15, 0.1, 0.15, '#e3b23c')
    for x in (-3.6, 2.2): window(x, fy + 0.02, 2.2, 1.4, 1.6)
    for x in (-8.0, 5.6):
        window(x, fy + 0.02, 2.4, 2.4, 2.0); sill_flowers(x, fy, 2.4, 2.4)
        for sx in (x - 0.75, x + 2.45): box(sx, fy + 0.04, 2.25, 0.3, 0.12, 2.3, '#4f7a52')
    for y in (OY + 1.2, OY + 6.6):
        window(ex + 0.02, y, 2.4, 2.2, 2.0, 'x'); sill_flowers(ex, y, 2.4, 2.2, 'x')
        for sy in (y - 0.75, y + 2.25): box(ex + 0.04, sy, 2.25, 0.12, 0.3, 2.3, '#4f7a52')
    window(ex + 0.12, -0.9, 7.2, 1.8, 1.6, 'x')  # attic window in the gable, beside the chimney
    bush(OX + 1.0, fy + 1.0, .7, True); bush(PX1 + 0.9, fy + 1.0, .6); flowerbox(PX0 - 1.8, fy + 1.4, 1.4)
    return w, d


def office_japanese():
    # machiya/minka house: dark timber frame over light plaster, low grey tiled hip roof with upturned eaves,
    # a tiled pent roof over the engawa (veranda), indigo noren at the door, a stone lantern and a cloud-pruned pine
    w, d = FOOT['office-japanese']; JX, JY = -w / 2, -d / 2
    fy, ex, WT = JY + d, JX + w, 7.0
    TIM, PL, TILE = '#3b2a22', '#f3e2bf', ['#6b717a', '#7d838c']
    box(JX - 0.1, JY - 0.1, 0, w + 0.2, d + 0.2, 0.6, '#8d8a86')
    box(JX, JY, 0.6, w, d, WT - 0.6, PL)
    # timber frame on the two walls the camera sees
    posts = [-9, -6.5, -4, -1.5, 1.5, 4, 6.5, 9]
    for x in posts: box(min(max(x - 0.15, JX - 0.05), ex - 0.25), fy - 0.05, 0.6, 0.3, 0.2, WT - 0.6, TIM)
    for y in (JY, JY + 2.5, JY + 5, JY + 7.5): box(ex - 0.05, y, 0.6, 0.2, 0.3, WT - 0.6, TIM)
    for (z, h) in [(0.6, 0.35), (3.9, 0.4), (WT - 0.35, 0.35)]:
        box(JX - 0.05, fy - 0.05, z, w + 0.1, 0.2, h, TIM); box(ex - 0.05, JY, z, 0.2, d, h, TIM)
    # ground floor: lattice (koshi) bays glowing warm, plaster at the ends
    for x0 in (-6.5, -4, 1.5, 4):
        box(x0 + 0.25, fy + 0.02, 1.2, 2.0, 0.08, 2.4, '#ffd98a', 1.4)
        for i in range(7): box(x0 + 0.3 + i * 0.3, fy + 0.08, 1.2, 0.12, 0.1, 2.4, TIM)
        box(x0 + 0.2, fy + 0.06, 1.05, 2.1, 0.12, 0.15, TIM); box(x0 + 0.2, fy + 0.06, 3.6, 2.1, 0.12, 0.15, TIM)
    # door with the noren: three indigo strips hung from a rod, a white crest on the middle one
    box(-1.3, fy + 0.02, 0.95, 2.6, 0.08, 2.9, '#2a1c16'); box(-1.1, fy + 0.04, 0.95, 2.2, 0.06, 1.4, '#ffd98a', 1.2)
    box(-1.45, fy + 0.15, 3.55, 2.9, 0.12, 0.12, TIM)
    for i in range(3): box(-1.35 + i * 0.92, fy + 0.2, 1.9, 0.86, 0.06, 1.65, '#3f62a0')
    box(-0.25, fy + 0.24, 2.6, 0.5, 0.04, 0.4, '#f3ede2')
    cyl(2.0, fy + 0.6, 2.4, 0.3, 0.7, '#d8543c', 10, 1.2); box(1.97, fy + 0.57, 3.1, 0.06, 0.06, 0.45, TIM)  # red paper lantern
    # upper floor: slatted mushiko windows (front), shoji grids (east)
    for x0 in (-6.5, -4, 1.5, 4):
        box(x0 + 0.35, fy + 0.02, 5.0, 1.8, 0.08, 1.3, '#ffe0a0', 1.3)
        for i in range(5): box(x0 + 0.4 + i * 0.42, fy + 0.08, 5.0, 0.18, 0.1, 1.3, TIM)
    for y0 in (JY + 0.4, JY + 5.4):
        for z0, h in ((1.3, 2.2), (4.9, 1.4)):
            box(ex + 0.02, y0 + 0.3, z0, 0.08, 1.9, h, '#ffe6b0', 1.3)
            for i in range(4): box(ex + 0.08, y0 + 0.3 + i * 0.6, z0, 0.1, 0.1, h, TIM)
            for k in range(int(h / 0.55) + 1): box(ex + 0.08, y0 + 0.3, z0 + k * 0.55, 0.1, 1.9, 0.1, TIM)
    # engawa: raised plank veranda along the front, a step stone at the door, two posts holding the pent roof
    planks(JX + 0.4, fy, 0, w - 0.8, 1.8, 0.75, ['#b07a45', '#a06a3c', '#b8844e'], 'x', 0.5)
    for x in (JX + 0.5, -1.5, 1.3, ex - 0.7): box(x, fy + 1.5, 0, 0.2, 0.2, 0.75, TIM)
    box(-1.0, fy + 1.8, 0, 2.0, 0.9, 0.35, '#a39f99')
    for x in (JX + 0.4, ex - 0.6): box(x, fy + 1.5, 0.75, 0.2, 0.2, 3.6, TIM)
    # tiled pent roofs (hisashi) over the engawa and the east wall, tile columns in two greys
    n = int((w + 1.0) / 0.45)
    for i in range(n): prism([(fy, 5.0), (fy + 1.9, 4.45), (fy + 1.9, 4.25), (fy, 4.8)], JX - 0.5 + i * 0.45, JX - 0.05 + i * 0.45, TILE[i % 2])
    box(JX - 0.5, fy + 1.8, 4.2, n * 0.45, 0.25, 0.3, '#4a4e56')
    for i in range(int((d + 0.5) / 0.45)): prism([(ex, 4.9), (ex + 1.6, 4.3), (ex + 1.6, 4.1), (ex, 4.7)], JY - 0.5 + i * 0.45, JY - 0.05 + i * 0.45, TILE[i % 2], 'y')
    # main hip roof: tile courses stepping in on all four sides, dark fascia, ridge with raised ends, upturned corners
    O = 1.0; X0, Y0, W, D = JX - O, JY - O, w + 2 * O, d + 2 * O
    box(X0 + 0.1, Y0 + 0.1, WT - 0.15, W - 0.2, D - 0.2, 0.25, TIM)
    s = i = 0
    while D - 2 * s > 1.0:
        z = WT + 0.1 + i * 0.42
        box(X0 + s, Y0 + s, z, W - 2 * s, D - 2 * s, 0.5, TILE[i % 2])
        for k in range(int((W - 2 * s) / 0.5)): box(X0 + s + 0.2 + k * 0.5, Y0 + D - s, z, 0.08, 0.04, 0.5, '#565b63')
        for k in range(int((D - 2 * s) / 0.5)): box(X0 + W - s, Y0 + s + 0.2 + k * 0.5, z, 0.04, 0.08, 0.5, '#565b63')
        s += 0.55; i += 1
    zt = WT + 0.1 + i * 0.42
    box(X0 + s - 0.3, Y0 + D / 2 - 0.35, zt - 0.1, W - 2 * s + 0.6, 0.7, 0.4, '#4a4e56')
    for x in (X0 + s - 0.5, X0 + W - s - 0.1): box(x, Y0 + D / 2 - 0.4, zt - 0.1, 0.6, 0.8, 0.9, '#4a4e56')
    for (x, y) in [(X0 - 0.3, Y0 - 0.3), (X0 + W - 0.5, Y0 - 0.3), (X0 - 0.3, Y0 + D - 0.5), (X0 + W - 0.5, Y0 + D - 0.5)]:
        box(x, y, WT + 0.55, 0.8, 0.8, 0.3, '#4a4e56')
    # stone lantern (toro) by the east end of the veranda
    LX, LY = 7.4, fy + 3.0
    box(LX - 0.5, LY - 0.5, 0, 1.0, 1.0, 0.3, '#8f8b85'); cyl(LX, LY, 0.3, 0.2, 1.2, '#a39f99', 8)
    box(LX - 0.45, LY - 0.45, 1.5, 0.9, 0.9, 0.2, '#8f8b85'); box(LX - 0.35, LY - 0.35, 1.7, 0.7, 0.7, 0.7, '#a39f99')
    box(LX - 0.2, LY + 0.3, 1.8, 0.4, 0.1, 0.45, '#ffcf6b', 3.0); box(LX + 0.3, LY - 0.2, 1.8, 0.1, 0.4, 0.45, '#ffcf6b', 3.0)
    box(LX - 0.65, LY - 0.65, 2.4, 1.3, 1.3, 0.2, '#8f8b85'); cone(LX, LY, 2.6, 0.75, 0.5, '#a39f99', 4); blob(LX, LY, 3.2, 0.2, '#a39f99')
    # cloud-pruned pine in a gravel bed at the west end
    TX, TY = -7.3, fy + 3.0
    cyl(TX, TY, 0, 1.4, 0.12, '#cfc8bb', 12)
    for (dx, dy, z) in [(0, 0, 0), (0.2, 0, 0.8), (0.4, 0.1, 1.6), (0.3, 0, 2.4)]: box(TX + dx - 0.15, TY + dy - 0.15, z, 0.3, 0.3, 0.9, '#5a3a22')
    for (dx, dy, z, r) in [(-0.6, 0.2, 1.4, 0.9), (0.9, 0, 2.2, 0.85), (-0.2, 0.1, 3.0, 0.8), (0.4, 0.1, 3.6, 0.55)]:
        cyl(TX + dx, TY + dy, z, r, 0.4, '#2f5e3a', 10); cyl(TX + dx, TY + dy, z + 0.3, r * 0.75, 0.25, '#3f7f52', 10)
    return w, d


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
    'office-modern': office_modern, 'office-country': office_country, 'office-japanese': office_japanese,
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
    for g in ground: g.hide_render = True
    # glow pass in the parts' own colour: no sun or sky, emission at strength 1 (lit + strong emission clips to white)
    sun.energy = 0; sc.world.node_tree.nodes['Background'].inputs[1].default_value = 0
    for (col, gl), m in kit.MATS.items():
        if gl > 0: m.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = 1
    glows = kit.glow_pass([o for o in sc.objects if o.type == 'MESH'], os.path.join(out, name + '.glow.png'))
    json.dump({'anchor': [ox, oy], 'footprint': [-w * 5, -d * 5, w * 5, d * 5], 'glow': glows}, open(os.path.join(out, name + '.json'), 'w', newline='\n'))
    print('ASSET', name, bw, bh, ox, oy)
print('DONE')
