# Throwaway spike v3: cozy rustic isometric town square. EEVEE with a warm sun and a cool sky (hue-shifted shadows),
# plank/stone/shingle detail, lush foliage. Orthographic 2:1 camera matching the app's projection. Original art.
# Run: blender -b -P blender_cozy.py -- <out.png>
import bpy, bmesh, math, sys, random
out = sys.argv[sys.argv.index('--') + 1]
rnd = random.Random(11)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
for eng in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
    try: sc.render.engine = eng; break
    except TypeError: pass
try: sc.eevee.taa_render_samples = 1
except Exception: pass
sc.render.filter_size = 0.0
sc.render.film_transparent = True
sc.view_settings.view_transform = 'Standard'
world = bpy.data.worlds.new('w'); sc.world = world; world.use_nodes = True
bg = world.node_tree.nodes['Background']; bg.inputs[0].default_value = (0.42, 0.52, 0.72, 1); bg.inputs[1].default_value = 0.75
sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 3.4; sun.color = (1.0, 0.86, 0.66); sun.angle = math.radians(2)
so = bpy.data.objects.new('sun', sun); sc.collection.objects.link(so); so.rotation_euler = (math.radians(48), math.radians(-18), math.radians(-35))

ZS = 1 / math.sin(math.radians(60))
MATS = {}
def hx(h): return tuple(int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))
def srgb2lin(c): return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
def mat(col, glow=0.0):
    k = (col, glow)
    if k not in MATS:
        m = bpy.data.materials.new('m'); m.use_nodes = True; p = m.node_tree.nodes['Principled BSDF']
        rgb = tuple(srgb2lin(c) for c in hx(col))
        p.inputs['Base Color'].default_value = (*rgb, 1); p.inputs['Roughness'].default_value = 1.0
        for nm in ('Specular IOR Level', 'Specular'):
            if nm in p.inputs: p.inputs[nm].default_value = 0.0
        if glow:
            p.inputs['Emission Color'].default_value = (*rgb, 1); p.inputs['Emission Strength'].default_value = glow
        MATS[k] = m
    return MATS[k]
def box(x, y, z, w, d, h, col, glow=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x + w / 2, y + d / 2, (z + h / 2) * ZS))
    o = bpy.context.object; o.scale = (w, d, h * ZS); o.data.materials.append(mat(col, glow)); return o
def cyl(x, y, z, r, h, col, v=12, glow=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=v, radius=r, depth=h * ZS, location=(x, y, (z + h / 2) * ZS))
    o = bpy.context.object; o.data.materials.append(mat(col, glow)); return o
def cone(x, y, z, r, h, col, v=8):
    bpy.ops.mesh.primitive_cone_add(vertices=v, radius1=r, depth=h * ZS, location=(x, y, (z + h / 2) * ZS))
    o = bpy.context.object; o.data.materials.append(mat(col)); return o
def blob(x, y, z, r, col):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=r, location=(x, y, z * ZS))
    o = bpy.context.object; o.scale = (1, 1, ZS * 0.85); o.data.materials.append(mat(col)); return o
def quad(pts, col):
    me = bpy.data.meshes.new('q'); o = bpy.data.objects.new('q', me); bpy.context.collection.objects.link(o)
    bm = bmesh.new(); v = [bm.verts.new((p[0], p[1], p[2] * ZS)) for p in pts]; bm.faces.new(v); bm.to_mesh(me); bm.free(); me.materials.append(mat(col)); return o
def roof(x, y, z, w, d, h, cols, over=0.5, rows=7, trim='#e8d7b0'):
    # gable, ridge along x, shingle rows alternating tones with a small step so rows read
    for side in (0, 1):
        for i in range(rows):
            t0, t1 = i / rows, (i + 1) / rows + 0.02
            def yy(t): return (y - over) + (d / 2 + over) * t if side == 0 else (y + d + over) - (d / 2 + over) * t
            za, zb = z + h * t0, z + h * t1
            c = cols[(i + side) % len(cols)]
            o = box(x - over, min(yy(t0), yy(t1)), za, w + 2 * over, abs(yy(t1) - yy(t0)), (zb - za) + 0.18, c)
    box(x - over, y + d / 2 - 0.2, z + h, w + 2 * over, 0.4, 0.25, '#5a3a2a')
    for xx in (x, x + w - 0.1):  # gable ends: plaster with timber
        me = bpy.data.meshes.new('g'); o = bpy.data.objects.new('g', me); bpy.context.collection.objects.link(o)
        bm = bmesh.new(); v = [bm.verts.new((xx + dx, yy_, zz * ZS)) for dx in (0, 0.1) for (yy_, zz) in ((y, z), (y + d, z), (y + d / 2, z + h))]
        bm.faces.new([v[0], v[1], v[2]]); bm.faces.new([v[5], v[4], v[3]]); bm.faces.new([v[0], v[3], v[4], v[1]]); bm.faces.new([v[1], v[4], v[5], v[2]]); bm.faces.new([v[2], v[5], v[3], v[0]])
        bm.to_mesh(me); bm.free(); me.materials.append(mat(trim))
def planks(x, y, z, w, d, h, cols, along='x', step=0.45):
    n = int((w if along == 'x' else d) / step)
    for i in range(n):
        if along == 'x': box(x + i * step, y, z, step, d, h, cols[i % len(cols)])
        else: box(x, y + i * step, z, w, step, h, cols[i % len(cols)])
def stones_base(x, y, w, d, h=0.8):
    box(x - 0.1, y - 0.1, 0, w + 0.2, d + 0.2, h, '#8d8a86')
    for _ in range(int((w + d) * 1.2)):
        if rnd.random() < .5: box(x + rnd.uniform(0, w - 0.8), y + d + 0.05, rnd.uniform(0, h - 0.35), rnd.uniform(0.5, 0.9), 0.06, 0.32, rnd.choice(['#a39f99', '#7b7874', '#b3aea6']))
        else: box(x + w + 0.05, y + rnd.uniform(0, d - 0.8), rnd.uniform(0, h - 0.35), 0.06, rnd.uniform(0.5, 0.9), 0.32, rnd.choice(['#a39f99', '#7b7874', '#b3aea6']))
def window(x, y, z, w, h, face='y', glow=True):
    if face == 'y':
        box(x - 0.15, y, z - 0.15, w + 0.3, 0.14, h + 0.3, '#4a2f20'); box(x, y + 0.06, z, w, 0.12, h, '#ffd98a' if glow else '#7fb6d6', 1.6 if glow else 0)
        box(x + w / 2 - 0.06, y + 0.1, z, 0.12, 0.12, h, '#4a2f20'); box(x, y + 0.1, z + h / 2 - 0.06, w, 0.12, 0.12, '#4a2f20')
        box(x - 0.2, y + 0.1, z - 0.35, w + 0.4, 0.4, 0.2, '#6b4530')
    else:
        box(x, y - 0.15, z - 0.15, 0.14, w + 0.3, h + 0.3, '#4a2f20'); box(x + 0.06, y, z, 0.12, w, h, '#ffd98a' if glow else '#7fb6d6', 1.6 if glow else 0)
        box(x + 0.1, y + w / 2 - 0.06, z, 0.12, 0.12, h, '#4a2f20'); box(x + 0.1, y, z + h / 2 - 0.06, 0.12, w, 0.12, '#4a2f20')
        box(x + 0.1, y - 0.2, z - 0.35, 0.4, w + 0.4, 0.2, '#6b4530')
def flowerbox(x, y, w, face='y'):
    for i in range(int(w / 0.35)):
        c = rnd.choice(['#e8566b', '#ffcf4d', '#ffffff', '#c86bd6'])
        if face == 'y': box(x + i * 0.35, y + 0.2, 0, 0.3, 0.3, 0.3, c)
        else: box(x + 0.2, y + i * 0.35, 0, 0.3, 0.3, 0.3, c)
def tree(x, y, s=1.0, tones=('#3e7d34', '#4e9a3c', '#62b04a', '#2f6a2c')):
    cyl(x, y, 0, 0.35 * s, 2.4 * s, '#6b4226', 6)
    for (dx, dy, dz, r) in [(0, 0, 3.2, 1.9), (-1.0, 0.5, 2.6, 1.3), (1.0, -0.4, 2.8, 1.3), (0.2, 0.3, 4.4, 1.3), (0.6, 0.9, 3.4, 1.1), (-0.5, -0.8, 3.6, 1.0)]:
        blob(x + dx * s, y + dy * s, dz * s, r * s, rnd.choice(tones))
    for _ in range(4): blob(x + rnd.uniform(-1.3, 1.3) * s, y + rnd.uniform(-1.3, 1.3) * s, rnd.uniform(3.0, 4.6) * s, 0.35 * s, '#7cc455')
def pine(x, y, s=1.0):
    cyl(x, y, 0, 0.25 * s, 1.2 * s, '#5a3a22', 6)
    for i, (r, h) in enumerate([(1.6, 2.2), (1.25, 2.0), (0.9, 1.8)]): cone(x, y, (1.0 + i * 1.3) * s, r * s, h * s, ['#2f5e3a', '#36704a', '#3f7f52'][i], 8)
def bush(x, y, s=1.0, berries=False):
    for (dx, dy, r) in [(0, 0, .8), (.6, .2, .6), (-.5, .3, .6)]: blob(x + dx * s, y + dy * s, .6 * s, r * s, rnd.choice(['#4b9a3e', '#3f8a37', '#5aa847']))
    if berries:
        for _ in range(5): blob(x + rnd.uniform(-.7, .7) * s, y + rnd.uniform(-.4, .6) * s, rnd.uniform(.6, 1.1) * s, .12, '#e04a5a')
def barrel(x, y): cyl(x, y, 0, 0.45, 1.0, '#8a5a32', 10); cyl(x, y, 0.15, 0.47, 0.12, '#4a4a52', 10); cyl(x, y, 0.75, 0.47, 0.12, '#4a4a52', 10)
def crate(x, y, h=0.8): box(x, y, 0, 0.9, 0.9, h, '#b07a45'); box(x + 0.05, y + 0.9, 0.1, 0.8, 0.04, h - 0.2, '#8a5a32')
def lamp(x, y):
    cyl(x, y, 0, 0.3, 0.3, '#2e2a30', 8); cyl(x, y, 0, 0.1, 4.0, '#2e2a30', 6); box(x - 0.35, y - 0.35, 4.0, 0.7, 0.7, 0.7, '#ffcf6b', 3.0); box(x - 0.45, y - 0.45, 4.7, 0.9, 0.9, 0.2, '#2e2a30')
def fence_run(x0, y0, x1, y1):
    n = max(1, int(math.hypot(x1 - x0, y1 - y0) / 1.2))
    for i in range(n + 1):
        t = i / n; box(x0 + (x1 - x0) * t - 0.13, y0 + (y1 - y0) * t - 0.13, 0, 0.26, 0.26, 1.3, '#7a4a2a')
    if x0 == x1: box(x0 - 0.06, min(y0, y1), 0.8, 0.12, abs(y1 - y0), 0.18, '#a8693a'); box(x0 - 0.06, min(y0, y1), 0.35, 0.12, abs(y1 - y0), 0.15, '#a8693a')
    else: box(min(x0, x1), y0 - 0.06, 0.8, abs(x1 - x0), 0.12, 0.18, '#a8693a'); box(min(x0, x1), y0 - 0.06, 0.35, abs(x1 - x0), 0.12, 0.15, '#a8693a')

# ---------- diorama block ----------
W, D = 64, 50
box(0, 0, -7, W, D, 2.4, '#6e4a33'); box(0, 0, -4.6, W, D, 2.6, '#8c5e3c'); box(0, 0, -2.0, W, D, 1.6, '#a46f45')
for _ in range(70):  # stones in the soil
    if rnd.random() < .5: box(rnd.uniform(0, W - 1.5), D, rnd.uniform(-6.5, -1), rnd.uniform(.8, 1.6), 0.1, rnd.uniform(.4, .8), rnd.choice(['#9a948c', '#7f7a74']))
    else: box(W, rnd.uniform(0, D - 1.5), rnd.uniform(-6.5, -1), 0.1, rnd.uniform(.8, 1.6), rnd.uniform(.4, .8), rnd.choice(['#9a948c', '#7f7a74']))
box(0, 0, -0.4, W, D, 0.4, '#5c9e3c')
box(-0.3, D - 0.2, -0.9, W + 0.3, 0.5, 0.9, '#4f8f35'); box(W - 0.2, -0.3, -0.9, 0.5, D + 0.3, 0.9, '#4f8f35')  # grass lip
for _ in range(420):
    x, y = rnd.uniform(0, W - 1), rnd.uniform(0, D - 1)
    box(x, y, 0, rnd.uniform(.5, 1.2), rnd.uniform(.5, 1.2), 0.03, rnd.choice(['#66aa44', '#549637', '#71b84b', '#4c8a33']))
# stream along the front with a wooden bridge
for i in range(64):
    x = i; y = 42 + math.sin(i / 6) * 1.6
    box(x, y, 0.0, 1.05, 3.4, 0.08, '#3f8fc4'); box(x, y - 0.3, 0.0, 1.05, 0.35, 0.22, rnd.choice(['#8f8a83', '#a39f99'])); box(x, y + 3.35, 0.0, 1.05, 0.35, 0.22, rnd.choice(['#8f8a83', '#a39f99']))
    if i % 3 == 0: box(x + .2, y + 1.0 + (i % 2), 0.08, .6, .12, .02, '#bfe6ff')
bx = 30
box(bx, 38.8, 0.3, 4, 8.6, 0.3, '#a8693a')
for j in range(12): box(bx, 39.5 + j * 0.62, 0.4, 4, 0.5, 0.06, '#b8794a' if j % 2 else '#a8693a')
for xx in (bx, bx + 3.8): box(xx, 39.5, 0.4, 0.2, 7.4, 0.9, '#7a4a2a')

# ---------- plaza: irregular stone pavers, dirt paths ----------
PX0, PY0, PW, PD = 21, 16, 22, 17
box(PX0 - .3, PY0 - .3, 0, PW + .6, PD + .6, 0.06, '#7d7468')
y = PY0
while y < PY0 + PD - 0.3:
    hgt = rnd.choice([0.9, 1.1, 1.3]); x = PX0 + rnd.uniform(0, .6)
    while x < PX0 + PW - 0.3:
        wd = rnd.choice([0.9, 1.2, 1.5, 1.8]); wd = min(wd, PX0 + PW - x)
        box(x + 0.06, y + 0.06, 0.06, wd - 0.12, min(hgt, PY0 + PD - y) - 0.12, 0.08, rnd.choice(['#cbbfa8', '#bfb39b', '#d6cab4', '#b3a68e', '#c4b79c']))
        x += wd
    y += hgt
for (x0, y0, w, d) in [(30, 3, 4, 13), (3, 23, 18, 3.2), (43, 23, 18, 3.2), (30, 33, 4, 7)]:
    box(x0, y0, 0, w, d, 0.07, '#c49a62')
    for _ in range(int(w * d / 2)): box(rnd.uniform(x0, x0 + w - .4), rnd.uniform(y0, y0 + d - .4), 0.07, .35, .35, .03, rnd.choice(['#a98250', '#d8b07a']))
# well-fountain: stone ring, water, wooden roof
for a in range(12):
    ang = a / 12 * 2 * math.pi; box(32 + math.cos(ang) * 2.6 - .5, 24.5 + math.sin(ang) * 2.6 - .5, 0, 1.0, 1.0, 1.0, rnd.choice(['#a39f99', '#8f8b85', '#b3aea6']))
cyl(32, 24.5, 0, 2.2, 0.8, '#4f9fd1', 16)
for (dx, dy) in [(-1.9, 0), (1.9, 0)]: box(32 + dx - .15, 24.5 - .15, 0, .3, .3, 4.0, '#6b4226')
roof(29.6, 22.6, 4.0, 4.8, 3.8, 1.4, ['#8a3b2a', '#9c4632'], over=0.3, rows=3)
for a in range(16):
    ang = a / 16 * 2 * math.pi; box(32 + math.cos(ang) * 3.6, 24.5 + math.sin(ang) * 3.6, 0, .3, .3, .35, rnd.choice(['#e8566b', '#ffcf4d', '#ffffff', '#c86bd6']))
for (x, y) in [(23.5, 30.5), (37.5, 30.5)]:
    box(x, y, 0.5, 3, 0.9, 0.15, '#a8693a'); box(x, y + 0.75, 0.65, 3, 0.15, 0.8, '#a8693a'); box(x + .1, y, 0, .2, .9, .5, '#4a3a32'); box(x + 2.7, y, 0, .2, .9, .5, '#4a3a32')
for (x, y) in [(21.5, 16.5), (42.5, 16.5), (21.5, 32.5), (42.5, 32.5)]: lamp(x, y)

# ---------- office: modern but warm (stone base, timber cladding, big glowing windows, slate roof, roof garden) ----------
OX, OY, OW, OD = 22, 2, 18, 10
stones_base(OX, OY, OW, OD)
planks(OX, OY, 0.8, OW, OD, 7.2, ['#c58b56', '#b77d4a', '#d0965f'], 'x', 0.5)
for i in range(4): window(OX + 1.0 + i * 4.3, OY + OD + 0.02, 1.6, 3.0, 2.4)
for i in range(4): window(OX + 1.0 + i * 4.3, OY + OD + 0.02, 4.9, 3.0, 2.0)
for i in range(2): window(OX + OW + 0.02, OY + 1.2 + i * 4.6, 1.6, 3.2, 2.4, 'x'); window(OX + OW + 0.02, OY + 1.2 + i * 4.6, 4.9, 3.2, 2.0, 'x')
box(OX + 7.5, OY + OD + 0.02, 0.8, 3, 0.2, 3.0, '#5a341c'); box(OX + 8.9, OY + OD + .2, 2.0, .2, .1, .2, '#ffcf6b', 2)  # door
box(OX + 6.5, OY + OD, 3.9, 5, 1.8, 0.25, '#4a5a6a')
box(OX + 5.5, OY + OD + 0.1, 8.2, 7, 0.15, 1.1, '#6b4530'); box(OX + 5.8, OY + OD + 0.22, 8.4, 6.4, 0.08, 0.7, '#f3e3c3')  # sign board
roof(OX, OY, 8.0, OW, OD, 3.4, ['#4a5a72', '#56688a'], over=0.6, rows=7)
for x in (OX + 0.5, OX + OW - 2.5): box(x, OY + OD + 0.4, 0, 2, 1, 0.8, '#7a4a2a'); bush(x + 1, OY + OD + 0.9, .7)
flowerbox(OX + 11.5, OY + OD + 0.3, 6)

# ---------- karinderya (west of the plaza): stone base, plank walls, red shingle roof, awning, outdoor tables ----------
KX, KY, KW, KD = 4, 13, 12, 9
stones_base(KX, KY, KW, KD, 0.7)
planks(KX, KY, 0.7, KW, KD, 3.8, ['#d39a5e', '#c48a52', '#dba468'], 'x', 0.45)
roof(KX, KY, 4.5, KW, KD, 3.4, ['#b8432f', '#c9533a', '#a63a28'], over=0.6, rows=7)
box(KX + KW + 0.02, KY + 1.5, 1.4, 0.14, 6, 2.2, '#3a2416')                                   # serving window (plaza side)
for i in range(11): box(KX + KW, KY + 1.2 + i * 0.6, 3.5, 2.4, 0.6, 0.12, '#e05545' if i % 2 == 0 else '#f6efe3')
box(KX + KW + 0.2, KY + 1.5, 0, 1.2, 6, 1.4, '#8a5a32')
for i, c in enumerate(['#7a3b1c', '#e3b23c', '#9cc06a', '#c98d3a', '#f6f1e3', '#c0392b']): box(KX + KW + 0.3, KY + 1.6 + i * 0.95, 1.4, 1.0, 0.8, 0.14, c)
window(KX + 1.5, KY + KD + 0.02, 1.6, 2.6, 1.8); window(KX + 7.5, KY + KD + 0.02, 1.6, 2.6, 1.8)
box(KX + 4.6, KY + KD + 0.02, 0.7, 2, 0.2, 2.8, '#5a341c')
box(KX + 2.5, KY + KD + 0.12, 5.3, 7, 0.12, 1.2, '#b3261e'); box(KX + 2.5, KY + KD + 0.18, 5.3, 7, 0.08, 0.22, '#f1c40f')
for i in range(9): box(KX + KW + 2.2 + i * .0, KY - 0.2 + i * 1.1, 4.4 - (i % 2) * .15, .22, .22, .22, '#ffd27a', 4)  # string lights
for (tx, ty) in [(18.0, 15.5), (18.0, 20.0)]:  # outdoor tables with umbrellas and plastic stools
    cyl(tx, ty, 0, 0.9, 1.1, '#f6efe3', 10); cyl(tx, ty, 1.1, 0.05, 2.2, '#5a5a62', 6); cone(tx, ty, 3.0, 1.9, 0.8, '#e05545', 8)
    for (dx, dy, c) in [(-1.4, 0, '#d63a3a'), (1.4, 0, '#2f78d6'), (0, 1.4, '#d63a3a')]: box(tx + dx - .35, ty + dy - .35, 0, .7, .7, .7, c)
for (x, y) in [(2.2, 13.5), (2.2, 15)]: barrel(x, y)
crate(2.0, 17); crate(2.0, 18.1, 0.6)
box(KX + 5, KY + KD + 1, 0, 1.2, .1, 1.6, '#2e3a2e'); box(KX + 5.1, KY + KD + 1.05, .3, 1.0, .06, 1.2, '#3c5a3c')  # chalkboard menu

# ---------- game hall (east of the plaza): red barn arcade with white trim ----------
GX, GY, GW, GD = 46, 12, 13, 10
stones_base(GX, GY, GW, GD, 0.7)
planks(GX, GY, 0.7, GW, GD, 4.8, ['#b5402f', '#a63a2b', '#c04a36'], 'y', 0.5)
roof(GX, GY, 5.5, GW, GD, 3.8, ['#5a4a46', '#665450'], over=0.6, rows=7)
box(GX + GW + 0.02, GY + 3, 0.7, 0.14, 4, 3.4, '#f3ede2'); box(GX + GW + 0.05, GY + 3.25, 0.7, 0.14, 3.5, 3.1, '#4a2a22')   # barn door
for (a, b) in [(0, 0), (1, 1)]: pass
box(GX + GW + 0.1, GY + 3.3, 4.4, 0.1, 3.4, 0.9, '#2b1d3a'); box(GX + GW + 0.15, GY + 3.45, 4.55, 0.08, 3.1, 0.6, '#ff5c8a', 3.5)  # neon sign
window(GX + GW + 0.02, GY + 0.8, 1.8, 1.6, 1.8, 'x'); window(GX + GW + 0.02, GY + 7.8, 1.8, 1.6, 1.8, 'x')
window(GX + 2, GY + GD + 0.02, 2.0, 2.4, 1.8); window(GX + 8.5, GY + GD + 0.02, 2.0, 2.4, 1.8)
for (x, y, c) in [(GX + GW + 1.3, GY + 0.6, '#3dd6ff'), (GX + GW + 1.3, GY + 8.2, '#ffd23f')]:
    box(x, y, 0, 1.2, 1.2, 2.5, '#2a2430'); box(x - 0.05, y + 0.15, 1.5, 0.08, 0.9, 0.7, c, 3)
box(GX + 3, GY + GD + 1.2, 0, 1.8, 1.2, 0.9, '#a8693a'); cyl(GX + 4, GY + GD + 1.7, 0.9, 0.4, 0.1, '#e8e2d2', 10)

# ---------- friend lots: fenced garden plots with a "for lease" sign ----------
for lx in (5, 25.5, 46):
    ly, lw, ld = 30.5, 13, 8
    if lx == 25.5: ly = 34.5; ld = 4.5
    box(lx, ly, 0, lw, ld, 0.05, '#8a6a46')
    for k in range(int(ld / 1.2)):
        box(lx + .6, ly + .4 + k * 1.2, 0.05, lw - 1.2, 0.5, 0.08, '#6f5236')
    fence_run(lx, ly, lx + lw, ly); fence_run(lx, ly + ld, lx + lw, ly + ld); fence_run(lx, ly, lx, ly + ld); fence_run(lx + lw, ly, lx + lw, ly + ld)
    box(lx + lw / 2, ly + ld / 2, 0, 0.25, 0.25, 2.3, '#7a4a2a'); box(lx + lw / 2 - 1.3, ly + ld / 2 + 0.25, 1.5, 2.8, 0.12, 1.3, '#efe0bd')

# ---------- greenery ----------
for (x, y, s) in [(3, 3, 1.1), (8, 6.5, 0.9), (14, 2.5, 1.0), (45, 3, 1.0), (52, 6, 1.1), (60, 3.5, 0.9), (61, 26, 1.0), (2, 27, 0.9), (20, 37, .8), (44, 37.5, .8)]: tree(x, y, s)
for (x, y, s) in [(18, 5, .9), (57, 9, .8), (61, 31, .9), (1.5, 9, .8)]: pine(x, y, s)
for (x, y, b) in [(19.5, 11, True), (41, 11.5, False), (44, 28, True), (19, 27.5, False), (60, 21, True), (2, 22, False), (27, 14.5, False), (37, 14.5, True)]: bush(x, y, 1, b)
for _ in range(220):
    x, y = rnd.uniform(1, W - 1), rnd.uniform(1, 40)
    if not (PX0 - 1 < x < PX0 + PW + 1 and PY0 - 1 < y < PY0 + PD + 1):
        box(x, y, 0, .22, .22, rnd.choice([.2, .3, .45]), rnd.choice(['#ffd23f', '#ffffff', '#ff7aa8', '#8fc5ff', '#5fb84a', '#4c9a3a', '#4c9a3a']))

# ---------- camera ----------
cam = bpy.data.cameras.new('c'); cam.type = 'ORTHO'; cam.ortho_scale = 92
co = bpy.data.objects.new('c', cam); sc.collection.objects.link(co); sc.camera = co
co.rotation_euler = (math.radians(60), 0, math.radians(135))
cx, cy = W / 2, D / 2; d = 120
co.location = (cx + d * math.sin(math.radians(60)) * math.cos(math.radians(45)), cy + d * math.sin(math.radians(60)) * math.sin(math.radians(45)), d * math.cos(math.radians(60)) - 2)
sc.render.resolution_x, sc.render.resolution_y = 1000, 720
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
print('DONE')
