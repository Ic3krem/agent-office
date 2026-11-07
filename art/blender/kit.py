# Shared Blender helpers for the town art (lifted from art/spike_town_cozy.py). Original art, Apache-2.0.
# Coordinates are the town's world frame in Blender units (1 unit = 1 cell = 10 world units): x east, y south, z up.
# The app projects P = [0.7071*(x-y), 0.3536*(x+y) - z] (screen right = +x-y), which is the mirror of a right-handed
# Blender scene seen by the (60, 0, 135) camera, so every helper swaps x and y on the way into Blender.
# Geometry is batched into one bmesh per material (thousands of boxes stay fast); call flush() before rendering.
import bpy, bmesh, math, random
from mathutils import Matrix, Euler, Vector

ZS = 1 / math.sin(math.radians(60))
CAM_ROT = (math.radians(60), 0, math.radians(135))
SUN_ROT = (math.radians(48), math.radians(-18), math.radians(-35))
MATS, BMS = {}, {}
rnd = random.Random(11)


def reset_scene(seed=11):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear(); BMS.clear(); rnd.seed(seed)
    sc = bpy.context.scene
    for eng in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
        try: sc.render.engine = eng; break
        except TypeError: pass
    try: sc.eevee.taa_render_samples = 1
    except Exception: pass
    sc.render.filter_size = 0.0
    sc.render.film_transparent = True
    sc.view_settings.view_transform = 'Standard'
    sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'
    world = bpy.data.worlds.new('w'); sc.world = world; world.use_nodes = True
    bg = world.node_tree.nodes['Background']; bg.inputs[0].default_value = (0.42, 0.52, 0.72, 1); bg.inputs[1].default_value = 0.75
    sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 3.4; sun.color = (1.0, 0.86, 0.66); sun.angle = math.radians(2)
    so = bpy.data.objects.new('sun', sun); sc.collection.objects.link(so); so.rotation_euler = SUN_ROT
    return sc


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


def _bm(col, glow=0.0):
    k = (col, glow)
    if k not in BMS: mat(col, glow); BMS[k] = bmesh.new()
    return BMS[k]


def _at(x, y, z): return Matrix.Translation((y, x, z * ZS))  # world frame -> Blender (x/y swapped)


def flush(name='m'):
    objs = []
    for k, bm in BMS.items():
        me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); me.materials.append(MATS[k])
        o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o); objs.append(o)
    BMS.clear()
    return objs


def box(x, y, z, w, d, h, col, glow=0.0):
    """Axis-aligned box: corner (x, y, z), size w (x) by d (y) by h (z)."""
    bmesh.ops.create_cube(_bm(col, glow), size=1, matrix=_at(x + w / 2, y + d / 2, z + h / 2) @ Matrix.Diagonal((d, w, h * ZS, 1)))


def cyl(x, y, z, r, h, col, v=12, glow=0.0):
    bmesh.ops.create_cone(_bm(col, glow), cap_ends=True, cap_tris=False, segments=v, radius1=r, radius2=r, depth=h * ZS, matrix=_at(x, y, z + h / 2))


def cone(x, y, z, r, h, col, v=8):
    bmesh.ops.create_cone(_bm(col), cap_ends=True, cap_tris=False, segments=v, radius1=r, radius2=0, depth=h * ZS, matrix=_at(x, y, z + h / 2))


def blob(x, y, z, r, col):
    bmesh.ops.create_icosphere(_bm(col), subdivisions=1, radius=r, matrix=_at(x, y, z) @ Matrix.Diagonal((1, 1, ZS * 0.85, 1)))


def prism(pts, x0, x1, col, axis='x'):
    """Extrude the polygon pts [(y, z)...] along x from x0 to x1 (gable ends, awnings).
    axis='y': pts are [(x, z)...] and x0/x1 run along y (gables and awnings facing east)."""
    bm = _bm(col)
    P = (lambda u, zz, a: (u, a, zz * ZS)) if axis == 'x' else (lambda u, zz, a: (a, u, zz * ZS))
    a = [bm.verts.new(P(u, zz, x0)) for u, zz in pts]; b = [bm.verts.new(P(u, zz, x1)) for u, zz in pts]
    fs = [bm.faces.new(a), bm.faces.new(b[::-1])]
    n = len(pts)
    for i in range(n): fs.append(bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i])))
    bmesh.ops.recalc_face_normals(bm, faces=fs)


def roof(x, y, z, w, d, h, cols, over=0.5, rows=7, trim='#e8d7b0', ridge='#5a3a2a'):
    # gable, ridge along x; shingle rows alternate tones with a small step so the rows read
    for side in (0, 1):
        for i in range(rows):
            t0, t1 = i / rows, (i + 1) / rows + 0.02
            def yy(t): return (y - over) + (d / 2 + over) * t if side == 0 else (y + d + over) - (d / 2 + over) * t
            za, zb = z + h * t0, z + h * t1
            box(x - over, min(yy(t0), yy(t1)), za, w + 2 * over, abs(yy(t1) - yy(t0)), (zb - za) + 0.18, cols[(i + side) % len(cols)])
    box(x - over, y + d / 2 - 0.2, z + h, w + 2 * over, 0.4, 0.25, ridge)
    for xx in (x, x + w - 0.1):  # gable ends
        prism([(y, z), (y + d, z), (y + d / 2, z + h)], xx, xx + 0.1, trim)


def planks(x, y, z, w, d, h, cols, along='x', step=0.45):
    n = int((w if along == 'x' else d) / step)
    for i in range(n):
        if along == 'x': box(x + i * step, y, z, min(step, w - i * step), d, h, cols[i % len(cols)])
        else: box(x, y + i * step, z, w, min(step, d - i * step), h, cols[i % len(cols)])


STONES = ['#a39f99', '#7b7874', '#b3aea6']


def stones_base(x, y, w, d, h=0.8):
    box(x - 0.1, y - 0.1, 0, w + 0.2, d + 0.2, h, '#8d8a86')
    for _ in range(int((w + d) * 1.2)):
        if rnd.random() < .5: box(x + rnd.uniform(0, w - 0.8), y + d + 0.05, rnd.uniform(0, h - 0.35), rnd.uniform(0.5, 0.9), 0.06, 0.32, rnd.choice(STONES))
        else: box(x + w + 0.05, y + rnd.uniform(0, d - 0.8), rnd.uniform(0, h - 0.35), 0.06, rnd.uniform(0.5, 0.9), 0.32, rnd.choice(STONES))


def window(x, y, z, w, h, face='y', glow=True):
    """Window on a +y (face 'y') or +x (face 'x') wall; x/y is the wall line, w runs along the wall."""
    pane = ('#ffd98a', 1.6) if glow else ('#7fb6d6', 0)
    if face == 'y':
        box(x - 0.15, y, z - 0.15, w + 0.3, 0.14, h + 0.3, '#4a2f20'); box(x, y + 0.06, z, w, 0.12, h, *pane)
        box(x + w / 2 - 0.06, y + 0.1, z, 0.12, 0.12, h, '#4a2f20'); box(x, y + 0.1, z + h / 2 - 0.06, w, 0.12, 0.12, '#4a2f20')
        box(x - 0.2, y + 0.1, z - 0.35, w + 0.4, 0.4, 0.2, '#6b4530')
    else:
        box(x, y - 0.15, z - 0.15, 0.14, w + 0.3, h + 0.3, '#4a2f20'); box(x + 0.06, y, z, 0.12, w, h, *pane)
        box(x + 0.1, y + w / 2 - 0.06, z, 0.12, 0.12, h, '#4a2f20'); box(x + 0.1, y, z + h / 2 - 0.06, 0.12, w, 0.12, '#4a2f20')
        box(x + 0.1, y - 0.2, z - 0.35, 0.4, w + 0.4, 0.2, '#6b4530')


# ---- projection, camera, render ----
def screen(x, y, z):
    """Pixel offset of a world-frame point (Blender units, unscaled height) from world (0,0,0): the app's P at 10 px/unit."""
    return (10 * 0.70710678 * (x - y), 10 * (0.35355339 * (x + y) - z))


def bounds():
    """Screen-pixel bounds [x0, y0, x1, y1] of every mesh in the scene, relative to world (0,0,0)."""
    xs, ys = [], []
    for o in bpy.context.scene.objects:
        if o.type != 'MESH' or o.hide_render: continue
        for c in o.bound_box:
            v = o.matrix_world @ Vector(c); sx, sy = screen(v.y, v.x, v.z / ZS); xs.append(sx); ys.append(sy)
    return [min(xs), min(ys), max(xs), max(ys)]


def iso_camera(cx, cy, cz, w_px, h_px):
    """Orthographic (60, 0, 135) camera aimed at world-frame point (cx, cy, cz), 10 px per unit."""
    sc = bpy.context.scene
    cam = bpy.data.cameras.new('c'); cam.type = 'ORTHO'; cam.ortho_scale = max(w_px, h_px) / 10; cam.clip_start = 0.1; cam.clip_end = 2000
    co = bpy.data.objects.new('c', cam); sc.collection.objects.link(co); sc.camera = co
    co.rotation_euler = CAM_ROT
    back = Euler(CAM_ROT).to_matrix() @ Vector((0, 0, 1))
    co.location = Vector((cy, cx, cz * ZS)) + back * 500
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = w_px, h_px, 100
    return co


def frame(b, pad=4):
    """Camera for screen bounds b; returns (w, h, ox, oy) where (ox, oy) is the integer pixel of world (0,0,0)."""
    a, c = round((b[0] + b[2]) / 2), round((b[1] + b[3]) / 2)  # integer screen point to aim at
    w = 2 * math.ceil((b[2] - b[0]) / 2 + pad); h = 2 * math.ceil((b[3] - b[1]) / 2 + pad)
    # solve screen(x, y, 0) == (a, c)
    s, t = a / 7.0710678, c / 3.5355339
    iso_camera((s + t) / 2, (t - s) / 2, 0, w, h)
    return w, h, w // 2 - a, h // 2 - c


def sun_dir():
    """Direction the sunlight travels, in the world frame (unscaled heights)."""
    v = Euler(SUN_ROT).to_matrix() @ Vector((0, 0, -1))
    return (v.y, v.x, v.z / ZS)


def holdout():
    m = bpy.data.materials.new('hold'); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    nt.links.new(nt.nodes.new('ShaderNodeHoldout').outputs[0], nt.nodes.new('ShaderNodeOutputMaterial').inputs['Surface'])
    return m


def glow_pass(objs, path):
    """<name>.glow.png: emissive parts only, every other object holds out (occludes, renders transparent). -> anything glows"""
    glows = {m for (col, g), m in MATS.items() if g > 0}
    if not glows: return False
    hold = holdout()
    for o in objs:
        if o.data.materials[0] not in glows: o.data.materials[0] = hold
    render(path)
    return True


def render(path):
    sc = bpy.context.scene; sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
