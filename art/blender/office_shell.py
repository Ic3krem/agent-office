# Office room shell: one seamless floor tile texture per zone floor, the two back wall strips (warm white, light oak
# trim, large windows with plants on the sills) and the static bases of the wall fixtures. Original art, Apache-2.0.
# Run: blender -b -P art/blender/office_shell.py -- <out raw dir>
# Writes the same render sets as office_assets.py (<name>.png, .ground.png, .noshadow.png, .json, .glow.png), so
# art/post.py packs them into the office atlas with the office palette:
#   floor@<kind>   128 x 64 tile: 4 x 4 of the 32 x 16 iso diamonds (a world period of S = 64 / 0.7071 = 90.51 units
#                  along x and y). Anchor = the tile pixel of a lattice point; the page repeats it as a Canvas pattern
#                  translated so that pixel sits on P(0, 0, 0), so every floor shares one grid and the tiles meet.
#   wall@x, wall@y the wall on the plane x = 0 (left) and y = 0 (back), home (0, 0). wall@*.glow.png holds the window
#                  panes as a night sky, which the page lays over the day panes as it gets dark.
#   wall-<fixture> corkboard, breaker box, Today board, usage board, whiteboard and clock bases; text, switches and the
#                  clock hands stay live on the page.
# Everything is modelled in world units at its real place (W() / 10 into kit units), home (0, 0).
import sys, os, json, math, random, shutil, array
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import kit

args = sys.argv[sys.argv.index('--') + 1:]
out = os.path.abspath(args[0]); os.makedirs(out, exist_ok=True)
only = set(args[1].split(',')) if len(args) > 1 else None

S = 64 / 0.70710678  # floor period in world units: (S, 0) and (0, S) project to (64, 32) and (-64, 32) px
WX, WY, WH = 1240, 780, 150
OAK, OAK_D, OAK_L = '#d6ae7c', '#b5875a', '#e6c79a'
WALL, CREAM, INK = '#efe4d2', '#efe3c8', '#2a2d33'
TERRA, LEAVES = '#c4704a', ['#3f7a3c', '#4f8f45', '#63a453', '#7dba5e']
PANE = 0.0005  # material tag (glow value) of a window pane: day sky in the colour pass, night sky in the glow pass
STAR = 0.0007  # night-only bits (stars, moon): hidden in the colour pass
DAY2NIGHT = {'#a9d6f0': '#16204a', '#c4e4f4': '#22306a', '#e9f5fb': '#2c3c78', '#8cc07a': '#183026'}


def B(x, y, z, w, d, h, col, glow=0.0): kit.box(x / 10, y / 10, z / 10, w / 10, d / 10, h / 10, col, glow)
def C(x, y, z, r, h, col, v=12): kit.cyl(x / 10, y / 10, z / 10, r / 10, h / 10, col, v)
def blob(x, y, z, r, col): kit.blob(x / 10, y / 10, z / 10, r / 10, col)


def emit(col):
    """Emission-only material: renders as exactly col whatever the light (sky panes)."""
    m = bpy.data.materials.new('e'); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    e = nt.nodes.new('ShaderNodeEmission'); e.inputs['Color'].default_value = (*[kit.srgb2lin(c) for c in kit.hx(col)], 1); e.inputs['Strength'].default_value = 1.0
    nt.links.new(e.outputs[0], nt.nodes.new('ShaderNodeOutputMaterial').inputs['Surface'])
    return m


def tagged(col, tag):
    if (col, tag) not in kit.MATS: kit.MATS[(col, tag)] = emit(col)
    return col, tag


# ---------------- floor tiles: one period cell [0, S) x [0, S), repeated so the render is periodic ----------------
def cells(f, seed):
    """Run f(x0, y0, q) for the cells round the origin with the same random stream each time (identical cells)."""
    for i in range(-4, 5):
        for j in range(-4, 5): f(i * S, j * S, random.Random(seed))


def speckle(x0, y0, q, n, cols, h=.2, s=1.2):
    for _ in range(n): B(x0 + q.random() * S, y0 + q.random() * S, 0, s, s, h, q.choice(cols))


def wood(x0, y0, q):
    B(x0, y0, -1, S, S, 1, '#a17a55')  # the gaps between boards: about half the old contrast, so light furniture keeps its edges
    rows, cols = 6, ['#c69e72', '#c69e72', '#d0a97c']  # one honey mid-tone and a lighter board (two palette steps)
    for r in range(rows):
        y, w, j = y0 + r * S / rows, S / rows, q.random() * S
        for k in range(2):  # two boards a row, the joint at a random place; the second runs on into the next cell
            a = j + k * S / 2; B(x0 + a + .5, y + .5, 0, S / 2 - 1, w - 1, .05, q.choice(cols))  # flush: the gap shows the base, not grey board sides


def carpet(x0, y0, q):
    B(x0, y0, -1, S, S, 1, '#a597c4'); speckle(x0, y0, q, 160, ['#b4a7d0', '#988ab8', '#ad9fca'], .15, 1.4)


def grass(x0, y0, q):
    B(x0, y0, -1, S, S, 1, '#5a9447')
    for _ in range(260): B(x0 + q.random() * S, y0 + q.random() * S, 0, .9, .9, .6 + q.random() * 1.6, q.choice(LEAVES))


def concrete(x0, y0, q):
    B(x0, y0, -1, S, S, 1, '#b3ada3')  # joints every half period
    for (u, v) in ((0, 0), (S / 2, 0), (0, S / 2), (S / 2, S / 2)): B(x0 + u + .5, y0 + v + .5, 0, S / 2 - 1, S / 2 - 1, .4, q.choice(['#d3cec5', '#cdc8be', '#d8d3ca']))
    speckle(x0, y0, q, 70, ['#c2bcb2', '#e0dcd4'], .5, 1)


def asphalt(x0, y0, q):
    B(x0, y0, -1, S, S, 1, '#5e6169'); speckle(x0, y0, q, 220, ['#6d7179', '#52555c', '#777b83'], .15, 1)


def pavers(x0, y0, q):
    B(x0, y0, -1, S, S, 1, '#a69c88')
    w, d = S / 4, S / 8
    for r in range(8):
        for k in range(4):
            B(x0 + k * w + (w / 2 if r % 2 else 0) + .5, y0 + r * d + .5, 0, w - 1, d - 1, .6, q.choice(['#d8cdb8', '#cbbfa8', '#e2d8c4', '#d1c4ab']))


def water(x0, y0, q):
    B(x0, y0, -1, S, S, 1, '#3f8fc0')
    for _ in range(18): B(x0 + q.random() * S, y0 + q.random() * S, 0, 3 + q.random() * 5, .9, .1, q.choice(['#6fb6dd', '#9fd3ec', '#5aa6d4']))


def rug(x0, y0, q):
    B(x0, y0, -1, S, S, 1, '#a24e38'); w = S / 4
    for i in range(4):
        for j in range(4):
            B(x0 + i * w + .6, y0 + j * w + .6, 0, w - 1.2, w - 1.2, .4, ('#b65a40', '#c9724f')[(i + j) % 2])
            B(x0 + i * w + w / 2 - 2.5, y0 + j * w + w / 2 - 2.5, .4, 5, 5, .3, ('#ecd9b8', '#d9a441')[(i + j) % 2])


def terracotta(x0, y0, q):
    B(x0, y0, -1, S, S, 1, '#e6d3b8'); w = S / 4  # cream grout
    for i in range(4):
        for j in range(4): B(x0 + i * w + .5, y0 + j * w + .5, 0, w - 1, w - 1, .6, q.choice(['#c4704a', '#cf7d55', '#b9663f', '#c87650']))


FLOORS = {'wood': wood, 'carpet': carpet, 'grass': grass, 'concrete': concrete, 'asphalt': asphalt, 'pavers': pavers,
          'water': water, 'rug': rug, 'terracotta': terracotta}


def render_floor(kind, seed):
    name = 'floor@' + kind
    sc = kit.reset_scene(seed); sc.render.dither_intensity = 0
    sc.objects['sun'].data.use_shadow = False  # shadow maps are not periodic; flat floors need none
    cells(FLOORS[kind], seed); kit.flush(name)
    kit.iso_camera(0, 0, 0, 384, 192)  # world (0, 0, 0) on the pixel corner (192, 96)
    raw = os.path.join(out, name + '.full.png'); kit.render(raw)
    im = bpy.data.images.load(raw); w, h = im.size; px = array.array('f', bytes(4 * w * h * 4)); im.pixels.foreach_get(px)
    bpy.data.images.remove(im); os.remove(raw)
    # crop the 128 x 64 tile at (128, 64) (Blender's pixel rows run bottom-up) and check that the render repeats
    row = lambda x, y: px[((h - 1 - y) * w + x) * 4:((h - 1 - y) * w + x) * 4 + 4]
    tile = [[row(128 + x, 64 + y) for x in range(128)] for y in range(64)]
    off = sum(1 for y in range(64) for x in range(128) if max(abs(a - b) for a, b in zip(tile[y][x], row(x, y))) > 2 / 255)
    if off > 64: print('FLOOR NOT PERIODIC', name, off); sys.exit(1)
    img = bpy.data.images.new(name, 128, 64, alpha=True)
    img.pixels = [c for y in range(63, -1, -1) for x in range(128) for c in tile[y][x]]
    p = os.path.join(out, name + '.png'); img.filepath_raw = p; img.file_format = 'PNG'; img.save()
    for ext in ('.ground.png', '.noshadow.png'): shutil.copy(p, os.path.join(out, name + ext))  # no ground shadow
    json.dump({'anchor': [192 - 128, 96 - 64], 'footprint': None, 'glow': False, 'alpha': False}, open(os.path.join(out, name + '.json'), 'w', newline='\n'))
    print('SHELL', name, 'periodic, off', off)


# ---------------- walls ----------------
def sky(x, y, z, w, h, face):
    """Window pane on the wall face: sky bands, far hills, and (glow pass only) stars."""
    bands = [('#8cc07a', 0, .16), ('#e9f5fb', .16, .38), ('#c4e4f4', .38, .66), ('#a9d6f0', .66, 1)]
    for col, a, b in bands:
        c, t = tagged(col, PANE)
        if face == 'x': B(x, y, z + a * h, .4, w, (b - a) * h, c, t)
        else: B(x, y, z + a * h, w, .4, (b - a) * h, c, t)
    q = random.Random(int(x * 7 + y * 13))
    for _ in range(max(2, int(w / 25))):
        u, v = 3 + q.random() * (w - 6), h * (.5 + q.random() * .45)
        c, t = tagged('#fff4c8', STAR)
        if face == 'x': B(x + .5, y + u, z + v, .2, 1, 1, c, t)
        else: B(x + u, y + .5, z + v, 1, .2, 1, c, t)


def window(u0, u1, face, plants=()):
    """A large window from u0 to u1 along the wall (y on the x wall, x on the y wall), panes z 46..128, oak frame and
    sill, mullions every 40 or so, small pots on the sill at the given offsets."""
    z0, z1, L = 46, 128, u1 - u0
    n = max(1, round(L / 45))
    def bx(u, du, z, h, t, col): (B(0, u, z, t, du, h, col) if face == 'x' else B(u, 0, z, du, t, h, col))
    sky(.2, u0, z0, L, z1 - z0, 'x') if face == 'x' else sky(u0, .2, z0, L, z1 - z0, 'y')
    for k in range(n + 1): bx(u0 + k * L / n - 1.5, 3, z0, z1 - z0, 1.6, OAK_L)  # posts and mullions
    bx(u0 - 3, L + 6, z1, 4, 1.8, OAK_L); bx(u0 - 3, L + 6, z0 - 2, 2, 1.8, OAK_L)
    bx(u0, L, z0 + (z1 - z0) * .62, 1.6, 1.4, OAK_L)  # transom bar
    bx(u0 - 5, L + 10, z0 - 5, 3, 7, OAK)  # sill
    for (du, kind) in plants:
        u = u0 + du
        cx, cy = (3.5, u) if face == 'x' else (u, 3.5)
        C(cx, cy, z0 - 2, 4.2, 8, TERRA if kind else '#f4ecdf', 10)
        for (a, b, r, col) in ((0, 0, 5.4, LEAVES[1]), (-2.6, 2, 4, LEAVES[2]), (2.4, -1.5, 3.8, LEAVES[0]), (0, 3.5, 3.4, LEAVES[3])):
            blob(cx + (a if face == 'y' else 0), cy + (a if face == 'x' else 0), z0 + 9 + b + r * .6, r, col)


def wall_x():
    """Left wall, plane x = 0, inner face +x, y 0..780."""
    B(-8, -8, 0, 8, WY + 8, WH + 7, WALL); B(-9, -9, WH + 7, 10, WY + 9, 2.5, OAK)  # body and its top cap
    B(0, 0, 0, 1.4, WY, 10, OAK); B(0, 0, 34, 1, WY, 3, OAK_L)  # baseboard and a light chair rail
    for (u0, u1, pl) in ((60, 125, [(12, 1)]), (135, 200, [(50, 0)]), (240, 330, [(16, 1), (72, 0)])): window(u0, u1, 'x', pl)


def wall_y():
    """Back wall, plane y = 0, inner face +y, x 0..1240."""
    B(0, -8, 0, WX, 8, WH + 7, WALL); B(0, -9, WH + 7, WX + 1, 10, 2.5, OAK)
    B(0, 0, 0, WX, 1.4, 10, OAK); B(0, 0, 34, WX, 1, 3, OAK_L)
    for (u0, u1, pl) in ((40, 120, [(60, 0)]), (500, 640, [(20, 1), (118, 0)]), (660, 800, [(70, 1)]), (820, 960, [(24, 0), (110, 1)]),
                         (980, 1100, [(60, 1)]), (1120, 1220, [(18, 0)])): window(u0, u1, 'y', pl)


# ---------------- wall fixture bases (the page draws their text and live parts over them) ----------------
def on_y(x, z, w, h, t, col):   # a flat panel on the back wall: x from x, z from z down by h
    B(x, 0, z - h, w, t, h, col)


def on_x(y, z, w, h, t, col):   # a flat panel on the left wall: y from y down by w (the page's u runs toward -y)
    B(0, y - w, z - h, t, w, h, col)


def fx_today():
    on_y(129, 131, 186, 78, .8, OAK_L); on_y(129, 131, 186, 3, 1, OAK)
    on_y(132, 128, 180, 72, 1.2, '#2f4a38')


def fx_usage():
    on_y(352, 123, 106, 66, .8, '#c9ccd4'); on_y(355, 120, 100, 60, 1.2, '#f6f1e6')


def fx_whiteboard():
    on_x(473, 129, 126, 62, .8, '#c9ccd4'); on_x(470, 126, 120, 56, 1.2, '#f8f8f6')
    on_x(440, 72, 30, 2, 3, '#a3a6ab')  # marker tray


def fx_cork():
    on_x(685, 121, 76, 62, .8, OAK); on_x(682, 118, 70, 56, 1.2, '#b8875a')
    for i in range(6):  # pinned notes (the count under them is live)
        u, v = 5 + (i % 3) * 22 + (1, 2, 0, 2, 1, 0)[i], 5 + (i // 3) * 24
        on_x(682 - u, 118 - v, 16, 18, 1.6, ['#fdf3dc', '#fff7d6', '#f2e6c8', '#ffd0e0'][i % 4])
        on_x(682 - (13 + (i % 3) * 22) + 1, 118 - (7 + (i // 3) * 24) + 1, 2, 2, 2.2, ['#e04a3a', '#3a8ae0', '#3ae07a', '#e0c43a'][i % 4])


def fx_breaker():
    on_x(600, 114, 38, 52, 1, '#3b3f45'); on_x(598, 112, 34, 48, 2.6, '#8a9099'); on_x(595, 109, 28, 42, 2.8, '#5e646c')
    for i in range(6): on_x(598 - (6 + (i % 3) * 8), 112 - (7 + (i // 3) * 18), 5, 13, 3, '#2b2b33')  # switch slots


def fx_clock():
    pts = lambda r, n=20: [((520 + r * math.cos(2 * math.pi * k / n)) / 10, (120 + r * math.sin(2 * math.pi * k / n)) / 10) for k in range(n)]
    kit.prism(pts(20), 0, .15, OAK); kit.prism(pts(17), .15, .25, '#f6f1e6')
    for k in range(12):
        a = k * math.pi / 6; B(0, 520 + math.sin(a) * 15 - .7, 120 + math.cos(a) * 15 - .7, 2.7, 1.4, 1.4, INK)


SPRITES = {'wall@x': wall_x, 'wall@y': wall_y, 'wall-today': fx_today, 'wall-usage': fx_usage, 'wall-whiteboard': fx_whiteboard,
           'wall-cork': fx_cork, 'wall-breaker': fx_breaker, 'wall-clock': fx_clock}


def holdout():
    m = bpy.data.materials.new('hold'); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    nt.links.new(nt.nodes.new('ShaderNodeHoldout').outputs[0], nt.nodes.new('ShaderNodeOutputMaterial').inputs['Surface'])
    return m


def render_sprite(name, seed):
    sc = kit.reset_scene(seed); sc.render.dither_intensity = 0
    sun = sc.objects['sun'].data; sun.shadow_maximum_resolution = 0.002; sun.shadow_filter_radius = 0; sun.angle = 0; sun.use_shadow_jitter = False; sc.eevee.shadow_ray_count = 1
    fill = bpy.data.lights.new('fill', 'SUN'); fill.energy = 2.6; fill.color = (1.0, 0.9, 0.78); fill.use_shadow = False  # room light on the
    fo = bpy.data.objects.new('fill', fill); sc.collection.objects.link(fo); fo.rotation_euler = (kit.CAM_ROT[0] - .35, 0, kit.CAM_ROT[2])  # faces the sun never reaches
    SPRITES[name](); objs = kit.flush(name)
    key = {id(m): k for k, m in kit.MATS.items()}
    tag = lambda o: key.get(id(o.data.materials[0]), (None, 0))
    for o in objs:
        if tag(o)[1] == STAR: o.hide_render = True
    bw, bh, ox, oy = kit.frame(kit.bounds(), 2)
    p = os.path.join(out, name + '.png'); kit.render(p)
    for ext in ('.ground.png', '.noshadow.png'): shutil.copy(p, os.path.join(out, name + ext))  # the page draws no shadow under walls
    panes = [o for o in objs if tag(o)[1] in (PANE, STAR)]
    if panes:  # glow pass: panes as the night sky, stars on; everything else holds out (occludes, renders transparent)
        hold = holdout()
        for o in objs:
            col, t = tag(o)
            if t == PANE: o.data.materials[0] = emit(DAY2NIGHT[col])
            elif t == STAR: o.hide_render = False
            else: o.data.materials[0] = hold
        kit.render(os.path.join(out, name + '.glow.png'))
    json.dump({'anchor': [ox, oy], 'footprint': None, 'glow': bool(panes), 'alpha': False}, open(os.path.join(out, name + '.json'), 'w', newline='\n'))
    print('SHELL', name, bw, bh, ox, oy)


for i, kind in enumerate(FLOORS):
    if not only or 'floor@' + kind in only: render_floor(kind, 400 + i)
for i, name in enumerate(SPRITES):
    if not only or name in only: render_sprite(name, 500 + i)
print('DONE')
