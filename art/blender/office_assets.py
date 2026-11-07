# Office interior sprites: modern-cozy work furniture (light oak, warm white, sage/terracotta/mustard accents), a fun and cozy
# playroom, the rustic karinderya, and the garden, park, garage and glass partitions. Original art, Apache-2.0.
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


OFF = [0, 0]  # world offset added to every primitive (a part modelled by a helper built around its own origin)
def B(x, y, z, w, d, h, col, glow=0.0): kit.box((x + OFF[0]) / 10, (y + OFF[1]) / 10, z / 10, w / 10, d / 10, h / 10, col, glow)
def C(x, y, z, r, h, col, v=14, glow=0.0): kit.cyl((x + OFF[0]) / 10, (y + OFF[1]) / 10, z / 10, r / 10, h / 10, col, v, glow)
def blob(x, y, z, r, col): kit.blob((x + OFF[0]) / 10, (y + OFF[1]) / 10, z / 10, r / 10, col)
def ball(x, y, z, r, col, squash=1.0, seg=12):
    """Smooth sphere (blob() is a faceted icosphere): balls, beanbags. squash flattens it vertically."""
    kit.bmesh.ops.create_uvsphere(kit._bm(col), u_segments=seg, v_segments=max(6, seg * 2 // 3), radius=r / 10,
                                  matrix=kit._at((x + OFF[0]) / 10, (y + OFF[1]) / 10, z / 10) @ kit.Matrix.Diagonal((1, 1, kit.ZS * squash, 1)))
def archy(cx, cz, r, y0, y1, col, n=10):
    """Half-disc in the x-z plane (centre cx, cz; radius r), from y0 to y1: arched tops and oven mouths."""
    pts = [((cx + OFF[0] + r * math.cos(math.pi * i / n)) / 10, (cz + r * math.sin(math.pi * i / n)) / 10) for i in range(n + 1)]
    kit.prism(pts, (y0 + OFF[1]) / 10, (y1 + OFF[1]) / 10, col, axis='y')
def at(x, y, f, *a):
    OFF[0], OFF[1] = x, y
    try: f(*a)
    finally: OFF[0] = OFF[1] = 0


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



# ---------------- batch B: playroom (fun and cozy) ----------------
WALNUT, WALNUT_D, PLUM, PLUM_D, ROSE, ROSE_D = '#8a5a36', '#6b4226', '#3a2c66', '#2a1f4a', '#e08a94', '#c4707e'
CHERRY, CHERRY_L, CHROME, AMBER = '#8b3a1e', '#a8562a', '#c9ccd2', '#ffb547'
TOYS = ['#ff6b8a', '#ffd23f', '#3dd6ff', '#7cf29a', '#c9b0f0', '#ff9a4a']


def arcade(col):
    """Cabinet 34 x 28 x 82; the front (y 28) marquee and screen are live, drawn over the frame."""
    B(3, 0, 0, 28, 27, 82, PLUM_D)
    for x in (0, 31): B(x, 0, 0, 3, 28, 82, WALNUT); B(x - .2, 27.4, 0, 3.4, .8, 82, WALNUT_D)  # wood side panels, front edge
    B(31 + 3, 4, 46, .3, 20, 4, col); B(34, 6, 40, .3, 16, 3, col)  # side art stripes
    B(-.5, -.5, 80, 35, 29, 3, WALNUT_D)  # top cap
    B(3, 28, 70, 28, .6, 12, PLUM); B(3, 28, 45, 28, .6, 24, '#0d1a10')  # marquee and screen bezels (art drawn live)
    B(3, 22, 40, 28, 7, 4, '#3a2a6a'); B(3, 28.8, 29, 28, .4, 11, '#3a2a6a')  # control deck and panel
    for (u, c) in ((10, '#ff4d6d'), (18, '#ffd23f'), (25, '#3dd6ff')): C(u, 25, 44, 1.8, 1.2, c, 8)
    C(7, 25, 44, .7, 4, CHAR, 6); blob(7, 25, 48.5, 1.4, '#ff4d6d')  # joystick
    B(13, 28, 10, 8, .5, 12, STEEL); B(15, 28.5, 18, 1, .3, 2, INK); B(18, 28.5, 18, 1, .3, 2, INK)  # coin door
    B(2, 27, 0, 30, 1.5, 4, WALNUT_D)  # kick plate


def jukebox(_):
    """Body 38 x 22 x 52 with an arched top; the front panel, equaliser bars and notes are live."""
    B(0, 0, 0, 38, 22, 52, CHERRY); B(-.5, -.5, 0, 39, 23, 3, WALNUT_D)
    archy(19, 52, 19, 0, 22, CHERRY_L); archy(19, 52, 15, 21.8, 22.4, '#3b1a0a'); archy(19, 52, 12, 22.2, 22.6, AMBER, 8)
    for x in (0, 35): B(x, 21.6, 3, 3, 1, 49, CHROME)  # chrome front edges
    for x in (1, 35.6): B(x, 22.6, 10, 1.4, .6, 38, AMBER, glow=1.6)  # bubble tubes
    B(4, 22, 8, 30, .5, 38, '#3b1a0a'); B(8, 22.5, 13, 22, .3, 3, '#ffd36b')  # inset, strip (the lit panel is live)
    for z in (4, 6): B(8, 22.2, z, 22, .4, .8, CHROME)  # speaker grille


def sofa3(_):
    """Three-seat sofa 176 wide (arms -4..180), back along y 0..10, facing +y."""
    for x in (0, 168): B(x, 36, 0, 3, 3, 3, WALNUT_D); B(x, 2, 0, 3, 3, 3, WALNUT_D)
    B(0, 0, 3, 176, 10, 41, ROSE_D); B(-4, 0, 3, 10, 42, 23, ROSE_D); B(170, 0, 3, 10, 42, 23, ROSE_D)
    B(-4.5, -.5, 26, 11, 43, 3, ROSE); B(169.5, -.5, 26, 11, 43, 3, ROSE)  # rolled arm tops
    B(6, 8, 3, 164, 34, 13, ROSE_D)
    for i in range(3):
        B(8 + i * 55, 10, 16, 53, 31, 8, ROSE); B(8 + i * 55, 6, 24, 53, 6, 18, '#d47d89')
    B(14, 12, 24, 14, 5, 13, MUST); B(152, 12, 24, 14, 5, 13, SAGE)  # throw cushions


def snack_table(_):
    for (x, y) in [(4, 4), (56, 4), (4, 28), (56, 28)]: B(x, y, 0, 3, 3, 14, WALNUT_D)
    B(0, 0, 14, 62, 34, 4, OAK); B(.5, 33.6, 14.4, 61, .4, 1, OAK_L)
    C(16, 14, 18, 8, 3, CREAM, 14)
    for (c, d) in (('#ffd23f', 0), ('#ff7aa8', 4), ('#7cf29a', 8)): ball(13 + d, 13 + d / 2, 22, 2.2, c, 1, 8)
    B(38, 12, 18, 18, 14, 3, '#d35a4a'); B(39, 13, 21, 16, 12, 1.4, '#f3d9a0')  # pizza box
    C(68, 28, 18, 3, 6, '#3dd6ff', 10)  # soda can


def beanbag(v):
    col = '#' + v; dark = {'3dd6e8': '#2aa5b8', 'ffb547': '#d98f2a'}.get(v, col)
    C(0, 0, 0, 21, 5, dark, 18); ball(0, 0, 6, 22, col, .55, 16); ball(-3, -3, 13, 11, col, .6, 12)  # slumped bag with a dent where you sit


def ball_pit(_):
    import random
    q = random.Random(9)
    C(0, 0, 0, 47, 9, '#2a5a8a', 24); C(0, 0, 9, 43, 1, '#1f4a78', 24)
    for k in range(32): a = k * 2 * math.pi / 32; C(45 * math.cos(a), 45 * math.sin(a), 8, 3.6, 4, '#3a7ab8', 8)  # padded rim
    for i in range(110):
        a, r = q.random() * 2 * math.pi, math.sqrt(q.random()) * 38
        ball(r * math.cos(a), r * math.sin(a), 10 + q.random() * 2.5, 4, TOYS[i % 6], 1, 8)


def hoop(_):
    C(0, 0, 0, 8, 3, '#3a3a44', 14); C(0, 0, 3, 2, 76, '#8a909c', 8)
    B(-4, -14, 76, 3, 28, 30, '#f3ede2'); B(-4.4, -14.4, 75.6, 3.8, 28.8, 1, STEEL); B(-4.4, -14.4, 105.4, 3.8, 28.8, 1, STEEL)
    for (y, z, w, h) in ((-6, 97, 12, 1.4), (-6, 88, 12, 1.4), (-6, 88, 1.4, 10.4), (4.6, 88, 1.4, 10.4)): B(-1, y, z, .4, w, h, '#d35a4a')
    B(-1, -1, 82, 4, 2, 1, '#ff7a2a')  # rim bracket
    for k in range(16): a = k * 2 * math.pi / 16; C(10 + 8 * math.cos(a), 8 * math.sin(a), 81.5, .8, 1, '#ff7a2a', 6)
    for k in range(8): a = k * 2 * math.pi / 8; B(10 + 6 * math.cos(a), 6 * math.sin(a), 71, .5, .5, 10, '#e9e4dc')  # net
    ball(28, 12, 5, 5, '#ff8a2a', 1, 10)  # ball on the floor


def dartboard(_):
    B(0, 0, 0, 3, 3, 52, WALNUT_D); B(-7, -4, 0, 17, 11, 3, WALNUT_D)
    for (r, c, dx) in ((15.5, WALNUT, 0), (14, '#1b1220', .6), (12, '#d35a4a', .8), (8, '#f3ede2', 1), (4, '#2f9f68', 1.2), (1.6, '#d35a4a', 1.4)):
        for dz in range(-int(r), int(r)):
            z = dz + .5; w = 2 * math.sqrt(max(0, r * r - z * z))
            B(3, -2 - w / 2, 54 + dz, dx + 1, w, 1, c)
    B(4.4, -8, 56, 2, 1.6, 1.6, '#7cc4ff')  # a dart


def toy_bin(_):
    B(0, 0, 0, 30, 24, 20, '#ff8a4a'); B(-.5, -.5, 18, 31, 25, 2.5, '#ffa86a'); B(2, 24, 10, 26, .4, 2, '#ffd9c0')
    ball(10, 10, 24, 5, '#3dd6ff', 1, 10); B(17, 14, 20, 6, 6, 6, '#ffd23f'); ball(22, 6, 23, 4, '#7cf29a', 1, 10)
    B(4, 4, 20, 2, 2, 9, '#c9b0f0')  # a toy sword handle peeking out


def broom_corner(_):
    C(4, 4, 0, 7, 12, '#e8c53a', 14); C(4, 4, 11.6, 6, .6, '#5a7fa8', 14); B(-3, 3, 12, 14, 2, 2, '#9a9aa6')  # mop bucket
    B(14, -.5, 9, 2, 1, 37, '#a0643a'); B(12, -2, 6, 6, 4, 3, '#8a5a36'); B(11, -2, 0, 8, 4, 6, '#d9b45a')  # broom


# ---------------- batch B: the karinderya (rustic-cozy), parts at their place around its anchor ----------------
KWOOD, KPLANK, KTRIM, KDARK = '#8b4a2b', '#6e3a21', '#b0683a', '#5a2e19'
KTILE = ['#ecc49a', '#d9a273']


def k_floor():
    for i in range(22):
        for j in range(18): B(i * 10, j * 10, 0, 10, 10, .3, KTILE[(i + j) & 1])
    B(96, 140, .3, 46, 20, .4, '#a8452f'); B(99, 142, .7, 40, 16, .3, '#c86a45'); B(106, 148, 1, 26, 4, .2, '#e8b07a')


def k_jars(items, z):
    for (c, u) in items:
        if c == '#f3ede2': B(u - 1.4, .6, z, 6.8, 1, 6.8, c)  # a plate on its edge
        else: C(u + 3, 3, z, 3, 7, c, 10); C(u + 3, 3, z + 7, 3.2, 1.5, KDARK, 10)


def k_back():
    B(0, -4, 0, 220, 4, 70, KWOOD); B(-.5, -4.5, 69, 221, 5, 2, KTRIM)
    for u in range(6, 220, 9): B(u, 0, 3, 1, .3, 66, KPLANK)
    B(0, 0, 0, 220, .6, 3, KDARK)
    B(60, 0, 54, 112, 1, 12, '#b3261e'); B(60, 0, 52.5, 112, 1.2, 1.5, '#f1c40f')  # sign board (lettering is live)
    B(64, 0, 34, 104, 6, 2, KDARK); B(184, 0, 42, 30, 6, 2, KDARK); B(184, 0, 24, 30, 6, 2, KDARK)  # shelves
    k_jars([('#f3ede2', 68), ('#f3ede2', 75), ('#7fb8d8', 88), ('#e3b23c', 98), ('#c0392b', 108), ('#f3ede2', 124), ('#9cc06a', 136), ('#f3ede2', 150), ('#f3ede2', 157)], 36)
    k_jars([('#7fb8d8', 188), ('#f3ede2', 200)], 44); k_jars([('#e3b23c', 190), ('#c0392b', 202)], 26)
    B(14, .5, 33, 10, 6, 7, '#7a3b1c'); blob(16, 3, 41, 5, '#3e7d55'); blob(23, 3, 43, 4, '#3e7d55')  # hanging planter
    B(12, 1, 24, 2, 1, 10, '#5aa86e'); B(24, 1, 22, 2, 1, 12, '#5aa86e')


def k_left():
    B(-4, -4, 0, 4, 184, 70, KWOOD); B(-4.5, -4.5, 69, 5, 185, 2, KTRIM)
    for u in range(6, 180, 9): B(0, 180 - u, 3, .3, 1, 66, KPLANK)
    B(0, 0, 0, .6, 180, 3, KDARK)
    B(0, 70, 24, .5, 36, 34, '#4a2614'); B(0, 73, 27, .8, 30, 28, '#ffd58a', glow=1.2); B(0, 89, 42, .9, 14, 13, '#fff1c9', glow=1.4)  # sunny window
    B(0, 87, 27, 1.2, 2, 28, '#4a2614'); B(0, 73, 40, 1.2, 30, 2, '#4a2614'); B(0, 68, 22, 4, 40, 3, KTRIM)  # mullions, sill
    B(0, 36, 37, .5, 12, 15, '#f3ede2'); B(0, 36, 48, .7, 12, 4, '#c0392b')  # calendar
    for k in range(3): B(0, 38, 44 - k * 3, .7, 8, 1, '#99aaaa')


def k_pugon():
    B(4, 4, 0, 24, 30, 46, '#a2492f'); B(3.5, 3.5, 45, 25, 31, 2, '#8a3a25'); B(8, 10, 46, 14, 16, 40, '#9a4430')
    for z in range(6, 46, 6):
        B(4, 34, z, 24, .3, .8, '#6e2a1a'); B(28, 4, z, .3, 30, .8, '#6e2a1a')
        for u in range(4 if (z // 6) % 2 else 0, 24, 8): B(4 + u, 34, z - 6, .8, .3, 6, '#6e2a1a'); B(28, 4 + u, z - 6, .3, .8, 6, '#6e2a1a')
    B(9, 34, 6, 14, .5, 20, '#2a1410'); archy(16, 26, 7, 34, 34.5, '#2a1410')  # oven mouth (the fire is live)
    C(15, 30, 46, 3.6, 4, '#3a3a40', 10); C(15, 30, 49.6, 3, .5, '#5a2a12', 10)  # a kaldero on the hob, by the chimney


def k_counter():
    B(56, 30, 0, 120, 18, 30, '#9c5530'); B(55.5, 29.5, 29, 121, 19, 1.5, '#d9b98a')
    for k in range(4): B(60 + k * 28, 48, 4, 24, .4, 21, '#7a3e20'); B(70 + k * 28, 48.4, 14, 4, .3, 2, KTRIM)
    C(188, 36, 0, 5, 1.5, '#4a4f5c', 10); C(188, 36, 0, 2.5, 36, '#4a4f5c', 8)  # fan stand (the spinning head is live)


def k_fridge():
    B(4, 120, 0, 20, 22, 52, '#ddd6c4'); B(4, 142, 32, 20, .3, 1, '#b9b2a0')
    B(20, 142, 37, 1.5, 1, 7, '#8a8478'); B(20, 142, 16, 1.5, 1, 11, '#8a8478')
    B(8, 142, 44, 4, .5, 4, '#e74c3c'); B(13, 142, 43, 4, .5, 3, '#f1c40f')


def k_table():
    for (x, y) in [(62, 88), (175, 88), (62, 105), (175, 105)]: B(x, y, 0, 3, 3, 15, '#8a4524')
    B(62, 88, 11, 116, 20, 4, '#a85a2e'); B(60, 86, 15, 120, 24, 3, '#c4743d')
    for u in range(70, 180, 10): B(u, 86, 18, .7, 24, .2, '#a85a2e')
    C(120, 98, 18, 6, 7, '#5a5f6a', 12); C(120, 98, 24.6, 5.4, .6, '#f6f1e3', 12)  # rice pot (plates and food are live)


def k_chair(dx):
    x, y = dx, 78
    for (u, v) in [(x - 6, y - 5), (x + 4, y - 5), (x - 6, y + 3), (x + 4, y + 3)]: B(u, v, 1, 2, 2, 8, '#7a3e20')
    B(x - 6, y - 5, 9, 12, 10, 3, KTRIM)
    for u in (x - 6, x + 4): B(u, y - 7, 1, 2, 2, 29, '#7a3e20')
    B(x - 6, y - 7, 22, 12, 2, 8, '#9c5530')
    for u in (x - 3, x + .5): B(u, y - 6.5, 12, 2, 1, 10, '#9c5530')


def k_bangko():
    for x in (68, 118, 169): B(x, 116, 0, 3, 7, 9, '#7a3e20')
    B(70, 118, 4, 100, 2, 2, '#7a3e20'); B(66, 115, 9, 108, 9, 3, '#b8703c')


def k_lamp():
    C(204, 164, 0, 4, 2, KDARK, 10); B(203, 163, 2, 2, 2, 42, KDARK)
    C(204, 164, 42, 7, 10, '#f3e3c3', 12, glow=1.0); C(204, 164, 52, 3, 1, '#fff4dc', 10)


def k_cat():
    B(187, 148, 0, 7, 5, 6, '#4a4550'); B(188, 149, 6, 5, 4, 5, '#4a4550')
    B(188, 149.5, 11, 1.5, 1.5, 2, '#4a4550'); B(191.5, 149.5, 11, 1.5, 1.5, 2, '#4a4550')
    B(189.5, 153, 6.5, 2, .4, 1.6, '#f3ede2'); B(188.6, 153, 8.8, 1, .3, 1, '#ffd23f'); B(191.4, 153, 8.8, 1, .3, 1, '#ffd23f')


# ---------------- batch C: garden, utility, glass and doors ----------------
BARK, IRON, GLASS, FROST = '#6b4a2e', '#3a3a40', '#bfe0f0', '#eef6fa'
FRAME_L, FRAME_D = '#c9ced6', '#9aa1ad'
STONE = ['#a39f99', '#8d8a86', '#b3aea6', '#99938a']


def glass(x, y, z, w, d, h, col=GLASS, alpha=.16):
    """Translucent pane: a blended material keyed (col, -alpha) in kit.MATS, so it batches like any box and never glows.
    Back faces are culled so the alpha does not compound (the procedural glass was about .16 clear, .14 on the band)."""
    k = (col, -alpha)
    if k not in kit.MATS:
        m = kit.mat(col).copy(); m.node_tree.nodes['Principled BSDF'].inputs['Alpha'].default_value = alpha
        m.surface_render_method = 'BLENDED'; m.use_backface_culling = True; m.use_transparency_overlap = False; kit.MATS[k] = m
    B(x, y, z, w, d, h, col, glow=-alpha)


def g_bench(_):
    """Garden bench 56 wide, seat facing +y: cast legs, oak slats."""
    for x in (-28, 23): B(x, -7, 0, 5, 14, 3, IRON); B(x + 1, -6, 3, 3, 12, 9, IRON); B(x + 1, -9, 12, 3, 3, 19, IRON)
    for k in range(4): B(-28, -8 + k * 4, 12, 56, 3.4, 3, OAK if k % 2 else '#c99d6a')
    for k in range(3): B(-28, -9.5, 17 + k * 5, 56, 2.6, 3.6, OAK)


def bench_side(_):
    """The pond bench seen from its side: seat facing +x, back along x = -10."""
    for y in (-28, 24): B(-7, y, 0, 14, 5, 3, IRON); B(-6, y + 1, 3, 12, 3, 9, IRON); B(-10, y + 1, 12, 3, 3, 19, IRON)
    for k in range(4): B(-8 + k * 4, -28, 12, 3.4, 57, 3, OAK if k % 2 else '#c99d6a')
    for k in range(3): B(-10.5, -28, 17 + k * 5, 2.6, 57, 3.6, OAK)


def tree(s):
    import random
    q = random.Random(int(s * 100)); k = 0.7071
    C(0, 0, 0, 6 * s, 50 * s, BARK, 10); C(0, 0, 0, 8 * s, 3 * s, '#5a3d25', 10)
    for (dx, dy, r, col) in [(-22, -2, 22, LEAVES[0]), (24, 0, 20, LEAVES[0]), (0, -14, 28, LEAVES[1]), (-12, -34, 20, LEAVES[2]),
                             (14, -32, 17, LEAVES[2]), (0, -52, 14, LEAVES[3])]:
        ball(dx * s * k, -dx * s * k, 50 * s - dy * s, r * s, col, .9, 12)
        for _ in range(3):  # small lumps break up the silhouette
            a = q.random() * 6.283; u, v = math.cos(a) * r * .8, math.sin(a) * r * .55
            ball((dx + u) * s * k, -(dx + u) * s * k, 50 * s - (dy + v) * s, r * .45 * s, q.choice(LEAVES[1:]), .9, 8)


def bird_feeder(_):
    C(0, 0, 0, 4, 2, IRON, 10); C(0, 0, 0, 1.8, 52, '#5a3d25', 8)
    B(-10, -10, 50, 20, 20, 2, OAK_D)  # seed tray
    B(-7, -7, 52, 14, 14, 10, '#d9a46a'); B(-4, 7, 54, 8, .4, 5, '#2a1a10')  # house, opening
    kit.prism([(-11 / 10, 62 / 10), (11 / 10, 62 / 10), (0, 72 / 10)], -11 / 10, 11 / 10, TERRA)  # gable roof, ridge along y
    for (u, c) in ((-6, '#e8c86a'), (5, '#b98a57')): C(u, 8, 52, 1.6, 1.2, c, 6)  # seed


def hedge(_):
    B(0, 0, 0, 34, 7, 14, '#2f6a34')
    for i in range(4): ball(4 + i * 9, 3.5, 13, 6, ('#3f8a44', '#4f9a4c')[i % 2], .8, 10)
    for i in range(3): ball(8.5 + i * 9, 4, 18, 4, '#5aa858', .8, 8)


def fence(_):
    for y in (0, 19): B(0, y, 0, 3, 3, 16, WHITE); B(-.3, y - .3, 16, 3.6, 3.6, 1, WHITE_S)
    for z in (4, 10): B(.5, 0, z, 2, 22, 2, WHITE_S)
    for y in (5, 9.5, 14): B(.8, y, 1, 1.6, 2.4, 13, WHITE)


def gate(_):
    for y in (0, 30): B(0, y, 0, 7, 4, 26, OAK_D); B(-.5, y - .5, 26, 8, 5, 2, OAK); C(3.5, y + 2, 28, 1.6, 3, MUST, 8, glow=1.2)


def lamp_post(_):
    C(0, 0, 0, 4, 3, IRON, 10); C(0, 0, 3, 1.6, 62, IRON, 8)
    B(-3.5, -3.5, 63, 7, 7, 1.5, IRON); B(-3, -3, 64.5, 6, 6, 8, '#ffe8a8', glow=2.0)
    for (u, v) in ((-3.5, -3.5), (2.5, -3.5), (-3.5, 2.5), (2.5, 2.5)): B(u, v, 64.5, 1, 1, 8, IRON)
    B(-4, -4, 72.5, 8, 8, 1.5, IRON); C(0, 0, 74, 2, 2, IRON, 8)


def pond(r0):
    """Floor pond: a stone ring (world radius r0) round a deep-to-shallow blue basin; ripples, koi and pads are live."""
    import random
    q = random.Random(r0); n = int(r0 * .9)
    C(0, 0, 0, r0 - 2, .3, '#7a705f', 32)
    for k in range(n):
        a = k * 2 * math.pi / n; r = r0 - 3 + q.random() * 1.5
        ball(r * math.cos(a), r * math.sin(a), 0, 3.4 + q.random() * 1.2, q.choice(STONE), .5, 8)
    rw = r0 - 9
    for (f, c, dx) in ((1, '#2f7aa8', 0), (.82, '#3d8cbc', -4), (.62, '#4c9fcd', -8), (.4, '#5fb4dc', -14)):
        C(dx * rw / 49, 0, .3 + (1 - f), rw * f, .3, c, 28)  # the shallow centre drifts toward the light (screen up-left)


def picnic_table(_):
    for x in (-30, 24):  # A-frame legs with a cross beam carrying the benches
        B(x, -10, 0, 6, 4, 14, OAK_D); B(x, 12, 0, 6, 4, 14, OAK_D); B(x, -22, 7, 6, 54, 3, OAK_D)
    for y in (-22, 22): B(-36, y, 10, 72, 10, 3, OAK)
    for k in range(4): B(-34, -12 + k * 8, 14, 68, 7.6, 4, ('#c99d6a', OAK)[k % 2])
    C(-10, 0, 18, 3.2, 5, MUST, 10); B(12, 4, 18, 14, 10, 3, '#d35a4a'); B(13, 5, 21, 12, 8, 1, '#f3d9a0')  # mug, a lunch box


def mail_bench(_):
    for (x, y) in [(4, 3), (62, 3), (4, 17), (62, 17)]: B(x, y, 0, 5, 5, 20, OAK_D)
    B(6, 4, 6, 60, 18, 2, OAK_D)  # low shelf
    B(14, 5, 8, 14, 10, 7, '#c9a477'); B(32, 6, 8, 10, 8, 5, '#d9b88a')  # parcels
    B(0, 0, 20, 72, 26, 4, OAK); B(.5, 25.6, 20.4, 71, .4, 1, OAK_L)
    B(18, 8, 24, 22, 3, 14, INK); B(26, 9, 24, 6, 2, 2, CHAR); B(22, 9, 38, 14, 1.5, 2, CHAR)  # monitor (its screen is live)
    B(40, 8, 24, 14, 10, 1.5, WHITE); B(44, 10, 25.5, 14, 10, 1.5, CREAM)  # letters
    B(60, 14, 24, 8, 6, 5, SAGE)  # stamp tin


def mailbox(_):
    C(12, 9, 0, 2.2, 34, OAK_D, 8)
    B(2, 0, 34, 22, 18, 12, '#3a7ad0'); B(1.5, -.5, 46, 23, 19, 2, '#5a9af0')
    B(5, 18, 37, 16, .4, 7, '#10305a')  # slot
    B(23.6, 5, 38, 1, 2, 2, STEEL)  # flag pivot (the flag is live)


def garage(_):
    """Scheduler garage 190 x 100 x 96, a half-open roller door on the +y front; the status screen and sign are live."""
    WALL, ROOF = '#a7a59f', '#4a4f5a'
    B(0, 0, 0, 190, 60, 96, WALL)  # the body behind the bay; the bay (x 16..120, y 60..100) is open to the front
    B(0, 60, 0, 16, 40, 96, WALL); B(120, 60, 0, 70, 40, 96, WALL); B(16, 60, 70, 104, 40, 26, WALL)
    for z in (8, 23, 38, 53, 68, 83): B(0, 99.8, z, 190, .4, .8, '#9a9893')  # panel seams
    B(16, 60, 0, 104, 40, .4, '#5a5a62')  # bay floor
    B(16, 60, 0, 104, 2, 70, '#3a3d4e')  # bay back wall
    B(24, 64, 8, 88, 12, 30, '#3a3d4e'); B(28, 76, 18, 20, .4, 14, '#20222c'); B(52, 76, 18, 20, .4, 14, '#20222c')  # workbench, drawers
    B(84, 74, 16, 20, 2, 14, '#5fd38d', glow=1.0); B(86, 76, 18, 16, .3, 10, '#0d2a1c')  # charger
    B(24, 64, 38, 88, 14, 2, '#8d6840')  # bench top
    B(60, 62, 46, 16, 2, 2, '#ffe8a8', glow=1.6)  # strip light
    for i in range(4): B(16, 96 + i * .5, 70 - 6 * (i + 1), 104, 2, 5.4, ('#c9ccd4', '#b4b8c2')[i % 2])  # roller door, half up
    B(12, 99, 0, 4, 2, 74, '#7a4a22'); B(120, 99, 0, 4, 2, 74, '#7a4a22'); B(12, 99, 70, 112, 2, 4, '#7a4a22')  # door frame
    B(-4, -4, 96, 198, 108, 6, ROOF); B(-4, -4, 102, 198, 3, 3, '#5a606c'); B(-4, 101, 102, 198, 3, 3, '#5a606c')
    for x in (30, 150): B(x, 30, 102, 14, 12, 6, '#8a909c')  # roof units


def glass_x(L):
    """Partition pane on the plane x = 0 from y 0 to L: clear glass, a frosted band, light frame rails, a mullion at y 0."""
    L = float(L)
    glass(-.5, 0, 5, 1, L, 41); glass(-.6, 0, 46, 1.2, L, 10, FROST, .28); glass(-.5, 0, 56, 1, L, 39)
    B(-1, 0, 0, 2, L, 5, FRAME_D); B(-1, 0, 95, 2, L, 5, FRAME_L); B(-1, -1.5, 0, 2, 3, 100, FRAME_L)


def glass_y(L, x0=0.0, ends=(0, 60, 120)):
    """The same pane on the plane y = 0 from x x0 to x0 + L, with mullions at x0 + each of ends below L."""
    L = float(L)
    glass(x0, -.5, 5, L, 1, 41); glass(x0, -.6, 46, L, 1.2, 10, FROST, .28); glass(x0, -.5, 56, L, 1, 39)
    B(x0, -1, 0, L, 2, 5, FRAME_D); B(x0, -1, 95, L, 2, 5, FRAME_L)
    for u in ends:
        if u <= L: B(x0 + u - 1.5, -1, 0, 3, 2, 100, FRAME_L)


def door(_):
    """Door frame at y 0 from x -25 to 25 and the open glass leaf on x = 25 (the sign over it is live)."""
    for x in (-28, 22): B(x, -1, 0, 6, 2, 100, FRAME_D)
    B(-28, -1, 100, 56, 2, 8, FRAME_L)
    glass(24.2, 3, 2, 1.6, 28, 84); B(24, 2, 0, 2, 31, 2, FRAME_D); B(24, 2, 86, 2, 31, 2, FRAME_L); B(24, 30, 2, 2, 3, 84, FRAME_L)
    B(24.5, 26, 40, 3, 1.5, 12, STEEL)  # handle
    B(-22, -2, 0, 44, 8, .5, '#8f3b2e'); B(-22, 2, .5, 44, 1.6, .1, MUST)  # doormat


KAR = {0: k_floor, 1: k_back, 2: k_left, 3: k_pugon, 4: k_counter, 5: k_fridge, 6: k_table,
       7: lambda: k_chair(80), 8: lambda: k_chair(120), 9: lambda: k_chair(160), 10: k_bangko, 11: k_lamp,
       12: lambda: at(12, 166, plant, .9), 13: k_cat}

MODELS = {
    'dept-desk.0': desk, 'dept-desk.1': lambda v: swivel('#d4cec2', '#c9c2b4', 22),
    'tiro-desk': tiro_desk, 'inbox': inbox, 'tiro-chair': tiro_chair,
    'guest-chair': lambda v: swivel(SAGE, SAGE_D, 18), 'hot-chair': lambda v: swivel(MUST, '#c48f30', 16),
    'hot-desk': hot_desk, 'side-table': side_table, 'filing-cabinet': filing_cabinet, 'server-rack': server_rack,
    'bookshelf': bookshelf, 'printer': printer, 'recycling-bin': recycling_bin, 'water-cooler': water_cooler,
    'coffee-counter': coffee_counter, 'trophy-shelf': trophy_shelf, 'tires': tires,
    'plant': lambda v: plant(float(v or 1)), 'server-plant': lambda v: plant(1.1 + int(v) * .07, WHITE, SAGE),
    'arcade': lambda v: arcade('#ff6a6a'), 'arcade-race': lambda v: arcade('#3dd6ff'), 'jukebox': jukebox, 'sofa3': sofa3,
    'snack-table': snack_table, 'beanbag': beanbag, 'ball-pit': ball_pit, 'hoop': hoop, 'dartboard': dartboard, 'toy-bin': toy_bin,
    'broom-corner': broom_corner,
    'bench': g_bench, 'bench-side': bench_side, 'tree': lambda v: tree(float(v or 1)), 'bird-feeder': bird_feeder, 'hedge': hedge,
    'fence': fence, 'gate': gate, 'lamp-post': lamp_post, 'pond': lambda v: pond(58), 'pond-east': lambda v: pond(66),
    'picnic-table': picnic_table, 'mail-bench': mail_bench, 'mailbox': mailbox, 'garage': garage,
    'glass-x': glass_x, 'glass-y': glass_y, 'office-door.0': lambda v: glass_y(25, 25, (0,)), 'office-door.1': door, **{'karinderya.%d' % k: (lambda f: lambda v: f())(f) for k, f in KAR.items()},
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
    sc.render.dither_intensity = 0  # 8-bit output dither is the +-1 noise that speckled flat faces after the palette snap
    MODELS[f['base']](f['variant']); objs = kit.flush(name)
    glows = {m for (col, g), m in kit.MATS.items() if g > 0}
    clear = {m for (col, g), m in kit.MATS.items() if g < 0}  # glass: casts no shadow, keeps its alpha through post
    for o in objs:
        if o.data.materials[0] in clear: o.visible_shadow = False
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
    json.dump({'anchor': [ox, oy], 'footprint': fp, 'glow': bool(glows), 'alpha': bool(clear)}, open(os.path.join(out, name + '.json'), 'w', newline='\n'))
    print('OFFICE', name, bw, bh, ox, oy)
print('DONE')
