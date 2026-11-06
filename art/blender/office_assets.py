# Office interior sprites, modern-cozy (light oak, warm white, sage/terracotta/mustard accents). Original art, Apache-2.0.
# Run: blender -b -P art/blender/office_assets.py -- <catalog.json> <office-footprints.json> <out raw dir> [frame,frame]
# catalog.json (scripts/export-catalog.mjs) names every frame the painters ask for, with its instance's home anchor and
# footprint. Each frame is modelled in world units around that home (x east, y south, z up; 1 world unit = 1 px, so
# W() divides by 10 into kit units) and rendered like the town props: <name>.png, .ground.png, .noshadow.png, plus
# .glow.png (emissive parts only) for pieces with lights, and <name>.json {anchor, footprint}. Only the static body is
# modelled: name plates, LEDs, screens, steam, team colours and other live bits stay procedural, drawn over the frame.
import sys, os, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import kit

args = sys.argv[sys.argv.index('--') + 1:]
cat = json.load(open(args[0], encoding='utf8')); fixture = json.load(open(args[1], encoding='utf8'))
out = os.path.abspath(args[2]); os.makedirs(out, exist_ok=True)
only = set(args[3].split(',')) if len(args) > 3 else None

OAK, OAK_D, OAK_L = '#d6ae7c', '#b5875a', '#e6c79a'
WHITE, WHITE_S, CREAM = '#f6ecdb', '#e0d3bd', '#efe3c8'
CHAR, STEEL, INK = '#3c3b40', '#a3a6ab', '#2a2d33'
SAGE, SAGE_D, FELT = '#9fb08c', '#7b9070', '#dccaa6'
TERRA, TERRA_L, MUST, COGNAC = '#c4704a', '#d88a62', '#d9a441', '#a8643c'
LEAVES = ['#3f7a3c', '#4f8f45', '#63a453', '#7dba5e']


def B(x, y, z, w, d, h, col, glow=0.0): kit.box(x / 10, y / 10, z / 10, w / 10, d / 10, h / 10, col, glow)
def C(x, y, z, r, h, col, v=14, glow=0.0): kit.cyl(x / 10, y / 10, z / 10, r / 10, h / 10, col, v, glow)
def blob(x, y, z, r, col): kit.blob(x / 10, y / 10, z / 10, r / 10, col)


# ---------------- pieces ----------------
def swivel(seat, back, h, by=12, bz=15):
    """Office chair at the origin, backrest toward +y (the procedural chair's geometry)."""
    for k in range(5):
        a = k * 1.2566 + .3
        for t in (.4, .75, 1.0): C(math.cos(a) * 11 * t, math.sin(a) * 11 * t, 0.4, 1.5 if t == 1 else 1.1, 1.6, CHAR, 6)
    C(0, 0, 0, 2.2, 10, STEEL, 8)
    C(0, 0, 10, 14, 5, seat, 16); C(0, 0, 14.6, 12, .6, seat, 16)
    B(-12, by, bz, 24, 3, h, back); B(-1.5, by - 1, 10, 3, 2, bz - 10 + 2, STEEL)


def desk(variant):
    bz, top = int(variant[:-1]), variant[-1] == 't'
    y0, side = (-77, 106) if top else (-76, 112)
    if bz:  # felt back partition on an oak plinth (its top band is the team colour, drawn live)
        B(-95, y0 - 14, 0, 190, 5, bz, FELT); B(-95, y0 - 14.2, 0, 190, 5.4, 8, OAK_D)
    B(-97, y0 - 14, 0, 6, side, 48, FELT); B(-97.2, y0 - 14, 0, 6.4, side, 8, OAK_D)
    for x in (-50, 46): B(x, y0, 0, 4, 4, 31, WHITE); B(x, y0 + 48, 0, 4, 4, 31, WHITE); B(x, y0, 27, 4, 52, 4, WHITE)
    B(6, y0 + 2, 0, 40, 46, 31, WHITE)  # drawer pedestal
    for i in range(3):
        z0 = 20.5 - 9.5 * i; B(8, y0 + 48, z0, 36, .6, 8.5, OAK_L); B(22, y0 + 48.6, z0 + 5.5, 8, .4, 1.4, CHAR)
    B(-46, y0 + 2, 8, 52, 2, 20, OAK_D)  # modesty panel
    B(-54, y0 - 2, 31, 108, 56, 4, OAK)
    B(-53, y0 + 53.2, 31.4, 106, .4, .8, OAK_L)  # bevelled front edge catching the light


def tiro_desk(_):
    B(4, 2, 0, 142, 46, 28, WHITE)
    for i in range(6): B(8 + i * 23, 48, 6, 21, .6, 18, OAK_L); B(15 + i * 23, 48.6, 18, 7, .4, 1.6, MUST)
    B(0, 0, 28, 150, 50, 6, OAK); B(1, 49.6, 28.6, 148, .4, 1, OAK_L)
    for x in (8, 104): B(x, 12, 34, 38, 3, 24, INK); B(x + 16, 14, 34, 6, 2, 3, CHAR); B(x + 3, 15, 34, 32, 5, 1, CHAR)  # monitor backs, stands
    B(10, 30, 34, 14, 11, 1, CREAM); B(12, 32, 35, 14, 11, 1, WHITE)  # papers
    C(132, 34, 34, 3.2, 5, MUST, 10)  # Tiro's mug (steam is live)
    C(140, 8, 34, 4, 2, CHAR, 10); B(138.6, 8, 36, 1.6, 1.6, 22, CHAR); B(135, 8.6, 56, 5, 1.6, 1.6, CHAR)
    C(135, 10, 54, 5.5, 5, '#ffd77a', 12, glow=2.2)  # lamp shade, always on


def inbox(_):
    B(0, 2, 34, 26, 16, 1.4, OAK_D)
    B(0, 2, 34, 26, 1.6, 5, OAK); B(0, 16.4, 34, 26, 1.6, 4, OAK); B(0, 2, 34, 1.6, 16, 5, OAK); B(24.4, 2, 34, 1.6, 16, 5, OAK)


def tiro_chair(_):
    for k in range(5):
        a = k * 1.2566 + .3
        for t in (.4, .75, 1.0): C(math.cos(a) * 12 * t, math.sin(a) * 12 * t, .4, 1.6 if t == 1 else 1.2, 1.6, CHAR, 6)
    C(0, 0, 0, 2.4, 11, STEEL, 8); C(0, 0, 11, 15, 6, COGNAC, 16); C(0, 0, 16.6, 13, .6, '#b8744a', 16)
    B(-12, -14, 14, 24, 4, 30, '#93542f'); B(-14, -14, 38, 28, 4, 8, COGNAC)
    for x in (-14, 10): B(x, -6, 18, 4, 14, 3, '#93542f')  # armrests


def hot_desk(_):
    for (x, y) in [(1, 1), (70, 1), (1, 24), (70, 24)]: B(x, y, 0, 3, 3, 27, OAK_D)
    B(4, 1.5, 10, 66, 2, 15, OAK_L)
    B(0, 0, 27, 74, 28, 3, WHITE); B(.5, 27.6, 27.4, 73, .4, 1, WHITE_S)
    for x in (8, 42): B(x, 6, 30, 24, 14, 1.5, INK); B(x + 4, 9, 31.5, 16, 7, .3, '#8fd3f0', glow=1.2)


def side_table(_):
    C(0, 0, 0, 5, 1.5, OAK_D, 12); C(0, 0, 1.5, 1.6, 18, OAK_D, 8); C(0, 0, 19.5, 9, 2.5, OAK, 16)
    C(0, 0, 22, 3.2, 5, MUST, 10)


def filing_cabinet(_):
    B(0, 0, 0, 46, 48, 72, WHITE); B(-.5, -.5, 70, 47, 49, 2.5, OAK)
    for i in range(3):
        z0 = 49 - 23 * i
        B(46, 2, z0, .6, 44, 21, WHITE_S); B(46.6, 14, z0 + 10, .3, 20, 7, CREAM); B(46.6, 18, z0 + 4.6, .5, 12, 2.4, OAK_D)


def server_rack(_):
    B(0, 0, 0, 40, 38, 108, CHAR); B(-.5, -.5, 106, 41, 39, 3, '#4a4950')
    for i in range(7): B(40, 2, 92.5 - 14.5 * i, .5, 34, 12.5, '#24262c'); B(40.5, 18, 103.5 - 14.5 * i, .3, 16, 1, '#4b5160')
    B(40.5, 4, 1, .3, 30, 3, CREAM)
    for y in (2, 34): B(40, y, 0, 1, 2, 108, STEEL)  # rails


def bookshelf(_):
    import random
    q = random.Random(77)
    B(0, 0, 0, 38, 80, 13, OAK_D); B(38, 18, 4, .4, 44, 8, '#3a3330')  # plinth, label plate (the count is live)
    B(0, 0, 13, 38, 2, 115, OAK); B(0, 78, 13, 38, 2, 115, OAK); B(0, 0, 126, 38, 80, 2.5, OAK); B(0, 2, 13, 3, 76, 113, OAK_L)
    books = ['#c4704a', '#9fb08c', '#d9a441', '#6f8fb0', '#e9dfcc', '#8a5a7a', '#5f8f6a', '#d88a62']
    for z in (13, 41, 69, 97):
        B(0, 2, z, 38, 76, 2.2, OAK)
        u = 4
        while u < 74:
            w, h = 3 + q.random() * 4, 15 + q.random() * 8
            if q.random() < .12: u += w; continue  # a gap now and then
            B(8, u, z + 2.2, 28, min(w, 76 - u), min(h, 25), q.choice(books)); u += w + .5
    B(10, 60, 99.2, 26, 12, 2, CREAM); B(10, 60, 101.2, 26, 12, 2, TERRA)  # a stack lying flat


def printer(_):
    B(0, 0, 0, 50, 26, 22, OAK); B(2, 26, 3, 22, .5, 17, OAK_L); B(26, 26, 3, 22, .5, 17, OAK_L)
    B(2, 2, 22, 46, 22, 14, WHITE); B(4, 4, 36, 40, 18, 3, WHITE_S)
    B(6, 24, 28, 38, .5, 4, INK); B(10, 24, 23, 30, 5, 1, WHITE_S)  # output slot, tray
    B(30, 2.5, 39, 14, 6, .6, INK)  # control strip


def recycling_bin(_):
    B(0, 0, 0, 14, 14, 19, SAGE_D); B(-.5, -.5, 18, 15, 15, 2, SAGE)
    B(3, 14, 8, 8, .4, 7, CREAM); B(5, 14.4, 10, 4, .3, 3, SAGE_D)


def water_cooler(_):
    B(0, 0, 0, 20, 18, 44, WHITE); B(-.4, -.4, 0, 20.8, 18.8, 3, WHITE_S)
    B(5, 18, 14, 10, 3, 1.5, STEEL); B(6, 18, 22, 8, 2, 4, '#5a8fd0')
    B(6, 18, 30, 4, .5, 4, '#7ad0ff', glow=1.5); B(12, 18, 30, 4, .5, 4, '#ff8a70', glow=1.5)
    C(10, 9, 44, 8, 18, '#a9d6ee', 16); C(10, 9, 62, 5, 3, '#a9d6ee', 14); C(10, 9, 65, 2.4, 1.6, '#4f8fc4', 10)


def coffee_counter(_):
    B(0, 0, 0, 76, 30, 31, OAK); B(-1, -1, 31, 78, 32, 3, WHITE)
    for x in (3, 41): B(x, 30, 5, 32, .5, 26, OAK_L); B(x + 11, 30.5, 20, 10, .4, 2, CHAR)
    B(12, 4, 34, 30, 20, 30, TERRA); B(12, 4, 62, 30, 20, 2, CHAR)  # espresso machine (its LED and steam are live)
    B(16, 24, 51, 22, .5, 9, INK); B(23, 24, 36, 9, .5, 8, '#e4dccd'); B(20, 22, 44, 2, 4, 4, STEEL); B(30, 22, 44, 2, 4, 4, STEEL)
    C(54, 12, 34, 3.2, 5, MUST, 10); C(64, 18, 34, 3.2, 5, CREAM, 10)
    B(48, 2, 34, 22, 6, 9, WHITE_S); B(49, 3, 43, 20, 4, 1, OAK_D)  # canister shelf


def trophy_shelf(_):
    B(0, 0, 0, 96, 12, 20, WHITE); B(-.5, -.5, 19.5, 97, 13, 2, OAK)
    B(0, 0, 70, 96, 12, 3, OAK); B(0, 0, 40, 96, 12, 3, OAK)
    for x in (10, 84): B(x, 0, 62, 2, 4, 8, STEEL); B(x, 0, 32, 2, 4, 8, STEEL)  # brackets


def plant(s, pot=TERRA, rim=TERRA_L):
    C(0, 0, 0, 9 * s, 12 * s, pot, 14); C(0, 0, 11 * s, 9.6 * s, 2 * s, rim, 14); C(0, 0, 12.6 * s, 8 * s, .6 * s, '#5a3a24', 14)
    k = 0.7071
    for (dx, dy, r, col) in [(-9, -14, 11, LEAVES[0]), (8, -16, 12, LEAVES[1]), (0, -26, 12, LEAVES[2]), (-3, -36, 9, LEAVES[3]),
                             (-4, -20, 7, LEAVES[1]), (6, -30, 6, LEAVES[3]), (-11, -24, 5, LEAVES[2])]:
        blob(dx * s * k, -dx * s * k, 13 * s - dy * s, r * s, col)


def tires(_):
    C(0, 0, 0, 8, 6, '#2c2c31', 16); C(0, 0, 6, 8, 6, '#36363d', 16); C(0, 0, 11.8, 4, .4, '#1d1d21', 12)


MODELS = {
    'dept-desk.0': desk, 'dept-desk.1': lambda v: swivel('#d4cec2', '#c9c2b4', 22),
    'tiro-desk': tiro_desk, 'inbox': inbox, 'tiro-chair': tiro_chair,
    'guest-chair': lambda v: swivel(SAGE, SAGE_D, 18), 'hot-chair': lambda v: swivel(MUST, '#c48f30', 16),
    'hot-desk': hot_desk, 'side-table': side_table, 'filing-cabinet': filing_cabinet, 'server-rack': server_rack,
    'bookshelf': bookshelf, 'printer': printer, 'recycling-bin': recycling_bin, 'water-cooler': water_cooler,
    'coffee-counter': coffee_counter, 'trophy-shelf': trophy_shelf, 'tires': tires,
    'plant': lambda v: plant(float(v or 1)), 'server-plant': lambda v: plant(1.1 + int(v) * .07, WHITE, SAGE),
}

# the fixture is the footprint truth: report any frame whose model sits off its frozen footprint
FROZEN = {(r['id'], r['part']): r['fp'] for r in fixture}
HOLD = None


def holdout():
    global HOLD
    if HOLD is None:
        HOLD = bpy.data.materials.new('hold'); HOLD.use_nodes = True; nt = HOLD.node_tree; nt.nodes.clear()
        nt.links.new(nt.nodes.new('ShaderNodeHoldout').outputs[0], nt.nodes.new('ShaderNodeOutputMaterial').inputs['Surface'])
    return HOLD


for i, (name, f) in enumerate(sorted(cat['frames'].items())):
    if only and name not in only: continue
    if f['base'] not in MODELS: print('NO MODEL', name); sys.exit(1)
    sc = kit.reset_scene(seed=200 + i); HOLD = None
    sun = sc.objects['sun'].data; sun.shadow_maximum_resolution = 0.002; sun.shadow_filter_radius = 0; sun.angle = 0; sun.use_shadow_jitter = False; sc.eevee.shadow_ray_count = 1  # interior pieces are small: finer, crisper shadows
    MODELS[f['base']](f['variant']); objs = kit.flush(name)
    glows = {m for (col, g), m in kit.MATS.items() if g}
    fp = FROZEN.get((f['id'], f['part']), f['fp'])
    # ground-level extent of the model vs the footprint it stands on (both in world units, relative to the home)
    xs, ys, top = [], [], 0
    for o in objs:
        for c in o.bound_box:
            v = o.matrix_world @ kit.Vector(c); xs.append(v.y * 10); ys.append(v.x * 10); top = max(top, v.z / kit.ZS)
    if fp and (min(xs) > fp[0] + 3 or max(xs) < fp[2] - 3 or min(ys) > fp[1] + 3 or max(ys) < fp[3] - 3):
        print('WARN', name, 'model', [round(min(xs)), round(min(ys)), round(max(xs)), round(max(ys))], 'footprint', fp)
    sx, sy, sz = kit.sun_dir(); L = top / -sz
    gx0, gx1 = min(xs) / 10 + min(0, sx * L) - .5, max(xs) / 10 + max(0, sx * L) + .5
    gy0, gy1 = min(ys) / 10 + min(0, sy * L) - .5, max(ys) / 10 + max(0, sy * L) + .5
    kit.box(gx0, gy0, -0.1, gx1 - gx0, gy1 - gy0, 0.1, '#ffffff'); ground = kit.flush('ground')
    bw, bh, ox, oy = kit.frame(kit.bounds(), 2)
    for g in ground: g.hide_render = True
    kit.render(os.path.join(out, name + '.png'))
    for g in ground: g.hide_render = False
    kit.render(os.path.join(out, name + '.ground.png'))
    sun.use_shadow = False
    kit.render(os.path.join(out, name + '.noshadow.png'))
    if glows:  # emissive parts only: everything else holds out (occludes, renders transparent)
        for g in ground: g.hide_render = True
        for o in objs:
            if o.data.materials[0] not in glows: o.data.materials[0] = holdout()
        kit.render(os.path.join(out, name + '.glow.png'))
    json.dump({'anchor': [ox, oy], 'footprint': fp, 'glow': bool(glows)}, open(os.path.join(out, name + '.json'), 'w', newline='\n'))
    print('OFFICE', name, bw, bh, ox, oy)
print('DONE')
