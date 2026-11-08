# Post-process the raw Blender renders into the shipped town and office art. Original art, Apache-2.0.
#   python art/post.py <raw dir> <out dir> [<office out dir>]   palettes, atlases, terrain chunks; office atlas from <raw>/office
# Two palettes of at most 64 colours: art/palette.json (town atlas + terrain) and art/palette-office.json (interiors).
# The town palette is cut once and then kept: delete art/palette.json to re-cut it after changing the town art.
#   python art/post.py --preview <out dir> <png>                 compose terrain + every sprite at its town.json spot, 2x
#   python art/post.py --office-preview <office out> <png>       compose the default office's sprites (art/.raw/catalog.json), 2x
import sys, os, json, glob
from collections import Counter
from PIL import Image, ImageEnhance, ImageFilter, ImageChops

HERE = os.path.dirname(os.path.abspath(__file__))
OUTLINE, SHADOW = (0x2b, 0x1b, 0x16), (0x1a, 0x22, 0x40)
NCOL, PAD, CHUNK, MAXA, CAP = 63, 2, 512, 2048, 400  # 63 median-cut colours + the outline = 64


def look(im, keep_alpha=False):
    """Binarise alpha (unless keep_alpha: glass stays translucent), then the target's warm grade: brighten 1.12, saturate 1.15."""
    a = im.getchannel('A') if keep_alpha else im.getchannel('A').point(lambda v: 255 if v > 100 else 0)
    rgb = ImageEnhance.Color(ImageEnhance.Brightness(im.convert('RGB')).enhance(1.12)).enhance(1.15)
    if keep_alpha: rgb.paste(im.convert('RGB'), mask=a.point(lambda v: 255 if 0 < v < 255 else 0))  # glass keeps its own tint
    rgb.putalpha(a); return rgb


def outline(im):
    a = im.getchannel('A').point(lambda v: 255 if v else 0); ring = ImageChops.subtract(a.filter(ImageFilter.MaxFilter(3)), a)
    base = Image.new('RGBA', im.size, OUTLINE + (0,)); base.putalpha(ring); base.alpha_composite(im); return base


def shadow(col, ground, noshadow):
    """alpha = clamp(1 - ground/noshadow, 0, 0.6) where the sprite is transparent, in #1a2240."""
    g, n, ca, na = ground.convert('L'), noshadow.convert('L'), col.getchannel('A'), noshadow.getchannel('A')
    gd, nd, cd, nad = g.get_flattened_data(), n.get_flattened_data(), ca.get_flattened_data(), na.get_flattened_data()
    a = [0 if c > 100 or m == 0 or nv == 0 else max(0, min(153, round(255 * (1 - gv / nv)))) for gv, nv, c, m in zip(gd, nd, cd, nad)]
    a = [v if v >= 13 else 0 for v in a]  # drop render noise
    s = Image.new('RGBA', col.size, SHADOW + (0,)); m = Image.new('L', col.size); m.putdata(a); s.putalpha(m); return s


def palette_image(cols):
    flat = [c for rgb in cols for c in rgb]; flat += flat[:3] * (256 - len(cols))  # pad with a real colour, never black
    p = Image.new('P', (1, 1)); p.putpalette(flat); return p


def to_palette(im, pal, ncols):
    """RGBA -> P using the shared palette; index ncols is transparent."""
    q = im.convert('RGB').quantize(palette=pal, dither=Image.Dither.NONE)
    q.paste(ncols, mask=im.getchannel('A').point(lambda v: 255 if v == 0 else 0))
    q.putpalette(pal.getpalette()[:3 * ncols] + [0, 0, 0]); q.info['transparency'] = ncols
    return q


def save_p(im, path): im.save(path, optimize=True, transparency=im.info['transparency'])


def load(raw, skip=()):
    """Every <name>.json render set in raw: name -> [colour, shadow, anchor, footprint, glow alpha or None]."""
    sprites = {}
    for n in sorted(os.path.basename(p)[:-5] for p in glob.glob(os.path.join(raw, '*.json')) if os.path.basename(p) not in skip):
        meta = json.load(open(os.path.join(raw, n + '.json')))
        col = look(Image.open(os.path.join(raw, n + '.png')).convert('RGBA'), meta.get('alpha'))
        sh = shadow(col, Image.open(os.path.join(raw, n + '.ground.png')).convert('RGBA'), Image.open(os.path.join(raw, n + '.noshadow.png')).convert('RGBA'))
        gp = os.path.join(raw, n + '.glow.png')
        glow = Image.open(gp).convert('RGBA') if os.path.exists(gp) else None
        sprites[n] = [col, sh, meta['anchor'], meta['footprint'], glow]
    return sprites


def pack(frames):
    """Shelf packer, tallest first, 2 px padding: (W, H, {name: (x, y)})."""
    order = sorted(frames, key=lambda n: (-frames[n][0].height, n))
    for W in (512, 1024, 2048):
        x = y = shelf = 0; rects = {}
        for n in order:
            w, h = frames[n][0].size
            if x + w + PAD > W: x, y, shelf = 0, y + shelf + PAD, 0
            rects[n] = (x + PAD, y + PAD); x += w + PAD; shelf = max(shelf, h)
        H = y + shelf + 2 * PAD
        if H <= W: break
    if W > MAXA or H > MAXA: print('atlas too big', W, H); sys.exit(1)
    return W, H, rects


def cut(sprites, pal, ncols):
    """Map each sprite to the palette, add the outline, crop colour+shadow(+glow) to their union."""
    frames = {}
    for n, (col, sh, (ax, ay), fp, glow) in sprites.items():
        q = to_palette(col, pal, ncols).convert('RGBA'); q.putalpha(col.getchannel('A')); col = outline(q)  # keeps translucent alpha
        u = ImageChops.lighter(col.getchannel('A'), sh.getchannel('A')).getbbox()
        frames[n] = (col.crop(u), sh.crop(u), ax - u[0], ay - u[1], fp, glow.crop(u) if glow else None)
    return frames


def sheets(frames, W, H, rects, footprint=False):
    """Colour, shadow and glow (lit parts, same rects) sheets plus the frame table; a frame with lit parts gets glow: True."""
    atlas, atlas_sh, atlas_gl, meta = Image.new('RGBA', (W, H), (0, 0, 0, 0)), Image.new('RGBA', (W, H), SHADOW + (0,)), Image.new('RGBA', (W, H), (0, 0, 0, 0)), {}
    for n in sorted(frames):
        c, s, ax, ay, fp, gl = frames[n]; x, y = rects[n]
        atlas.paste(c, (x, y)); atlas_sh.paste(s, (x, y))
        if gl: atlas_gl.paste(look(gl), (x, y), gl.getchannel('A').point(lambda v: 255 if v > 100 else 0))
        meta[n] = {'x': x, 'y': y, 'w': c.width, 'h': c.height, 'ax': ax, 'ay': ay}
        if footprint: meta[n]['footprint'] = fp
        if gl: meta[n]['glow'] = True
    return atlas, atlas_sh, atlas_gl, meta


def palette(images, path, keep=False):
    """Median cut (k-means refined) over the opaque pixels of images, plus the outline, written to path; each colour's weight
    is capped so big flat areas (grass, floors) don't starve small accents. keep: reuse path if it exists."""
    if keep and os.path.exists(path):
        cols = [tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) for h in json.load(open(path))['colors']]
    else:
        cnt = Counter(p for im in images for p, a in zip(im.convert('RGB').get_flattened_data(), im.getchannel('A').get_flattened_data()) if a)
        allpx = [c for c, k in cnt.items() for _ in range(min(k, CAP))]
        sample = Image.new('RGB', (len(allpx), 1)); sample.putdata(allpx)
        pq = sample.quantize(colors=NCOL, method=Image.Quantize.MEDIANCUT, kmeans=4, dither=Image.Dither.NONE)
        cols = sorted(set(tuple(pq.getpalette()[i * 3:i * 3 + 3]) for _, i in pq.getcolors())) + [OUTLINE]
        json.dump({'colors': ['#%02x%02x%02x' % c for c in cols], 'outline': '#%02x%02x%02x' % OUTLINE}, open(path, 'w', newline='\n'), indent=1)
    if len(cols) > 64: print(path, 'has', len(cols), 'colours (> 64)'); sys.exit(1)
    return palette_image(cols), len(cols)


def build(raw, out, office_out=None):
    sprites = load(raw, ('terrain.json', 'catalog.json'))
    terrain = look(Image.open(os.path.join(raw, 'terrain.png')).convert('RGBA'))
    tmeta = json.load(open(os.path.join(raw, 'terrain.json')))
    pal, ncols = palette([s[0] for s in sprites.values()] + [terrain], os.path.join(HERE, 'palette.json'), keep=True)

    frames = cut(sprites, pal, ncols)
    W, H, rects = pack(frames)
    atlas, atlas_sh, atlas_gl, meta = sheets(frames, W, H, rects, footprint=True)
    os.makedirs(os.path.join(out, 'terrain'), exist_ok=True)
    save_p(to_palette(atlas, pal, ncols), os.path.join(out, 'atlas.png'))
    atlas_sh.save(os.path.join(out, 'atlas-shadow.png'), optimize=True)
    atlas_gl.save(os.path.join(out, 'atlas-glow.png'), optimize=True)
    json.dump({'frames': meta, 'size': [W, H]}, open(os.path.join(out, 'atlas.json'), 'w', newline='\n'), indent=1)

    # terrain: palette + outline round the whole block (not per chunk), cut into 512 px chunks
    t = outline(to_palette(terrain, pal, ncols).convert('RGBA'))
    tp = to_palette(t, pal, ncols); TW, TH = tp.size
    cols_n, rows_n = -(-TW // CHUNK), -(-TH // CHUNK)
    for f in glob.glob(os.path.join(out, 'terrain', '*.png')): os.remove(f)
    for r in range(rows_n):
        for c in range(cols_n):
            ch = tp.crop((c * CHUNK, r * CHUNK, min(TW, (c + 1) * CHUNK), min(TH, (r + 1) * CHUNK))); ch.info['transparency'] = ncols
            save_p(ch, os.path.join(out, 'terrain', f'r{r}c{c}.png'))
    json.dump({'originPx': tmeta['originPx'], 'levelsHash': tmeta.get('levelsHash', ''), 'levelH': tmeta.get('levelH', 0), 'chunk': CHUNK, 'cols': cols_n, 'rows': rows_n, 'size': [TW, TH]}, open(os.path.join(out, 'terrain.json'), 'w', newline='\n'), indent=1)
    print(f'palette {ncols} colours; atlas {W}x{H}; terrain {TW}x{TH} in {cols_n}x{rows_n} chunks')
    if office_out: build_office(load(os.path.join(raw, 'office')), office_out)


def build_office(sprites, out):
    """public/art/office: atlas.png (RGBA in art/palette-office.json colours; glass keeps its translucent alpha),
    atlas-shadow.png, atlas-glow.png (lit parts, same rects), atlas.json."""
    pal, ncols = palette([s[0] for s in sprites.values()], os.path.join(HERE, 'palette-office.json'))
    frames = cut(sprites, pal, ncols)
    W, H, rects = pack(frames)
    atlas, atlas_sh, atlas_gl, meta = sheets(frames, W, H, rects)
    os.makedirs(out, exist_ok=True)
    q = to_palette(atlas, pal, ncols).convert('RGBA'); q.putalpha(atlas.getchannel('A'))  # snap the outline blend back onto the palette
    q.save(os.path.join(out, 'atlas.png'), optimize=True)
    atlas_sh.save(os.path.join(out, 'atlas-shadow.png'), optimize=True)
    atlas_gl.save(os.path.join(out, 'atlas-glow.png'), optimize=True)
    json.dump({'frames': meta, 'size': [W, H]}, open(os.path.join(out, 'atlas.json'), 'w', newline='\n'), indent=1)
    print(f'office atlas {W}x{H}, {len(frames)} frames')


def preview(out, png):
    town = json.load(open(os.path.join(HERE, '..', 'public', 'town', 'town.json'), encoding='utf8'))
    tj, aj = json.load(open(os.path.join(out, 'terrain.json'))), json.load(open(os.path.join(out, 'atlas.json')))
    canvas = Image.new('RGBA', tuple(tj['size']), (160, 196, 214, 255))
    for r in range(tj['rows']):
        for c in range(tj['cols']):
            canvas.alpha_composite(Image.open(os.path.join(out, 'terrain', f'r{r}c{c}.png')).convert('RGBA'), (c * tj['chunk'], r * tj['chunk']))
    atlas, atlas_sh = Image.open(os.path.join(out, 'atlas.png')).convert('RGBA'), Image.open(os.path.join(out, 'atlas-shadow.png')).convert('RGBA')
    ox, oy = tj['originPx']
    items = [(l['building']['type'], l['building']['x'], l['building']['y']) for l in town['lots']] + [(d['type'], d['x'], d['y']) for d in town['decor']] + [(p['type'], p['x'], p['y']) for sp in town.get('spots', []) for p in sp['props']]
    items.sort(key=lambda i: i[1] + i[2])
    for src in (atlas_sh, atlas):  # all shadows first, then sprites back to front
        for (n, x, y) in items:
            f = aj['frames'][n]; spr = src.crop((f['x'], f['y'], f['x'] + f['w'], f['y'] + f['h']))
            px, py = round(ox + 0.70710678 * (x - y)) - f['ax'], round(oy + 0.35355339 * (x + y)) - f['ay']
            canvas.alpha_composite(spr, (px, py)) if px >= 0 and py >= 0 else canvas.paste(spr, (px, py), spr)
    canvas.resize((canvas.width * 2, canvas.height * 2), Image.NEAREST).save(png)
    print('preview', png)


def office_preview(out, png):
    """Default office floor (wall line, zones as flat tones) with every batch sprite at its home, depth-sorted, 2x."""
    cat = json.load(open(os.path.join(HERE, '.raw', 'catalog.json'), encoding='utf8'))
    aj = json.load(open(os.path.join(out, 'atlas.json')))
    atlas, atlas_sh = Image.open(os.path.join(out, 'atlas.png')).convert('RGBA'), Image.open(os.path.join(out, 'atlas-shadow.png')).convert('RGBA')
    from PIL import ImageDraw
    P = lambda x, y, z=0: (575 + 0.70710678 * (x - y), 175 + 0.35355339 * (x + y) - z)
    canvas = Image.new('RGBA', (1480, 920), (30, 26, 34, 255)); d = ImageDraw.Draw(canvas)
    for (x0, y0, x1, y1, c) in [(0, 0, 470, 230, '#c9a57a'), (470, 0, 1240, 230, '#7da05e'), (0, 230, 1000, 550, '#d8ccb8'), (1000, 230, 1240, 780, '#7da05e'),
                                (0, 550, 470, 780, '#e6dfd2'), (470, 550, 1000, 780, '#cdb8a0'), (1000, 550, 1240, 780, '#a7a9ad')]:
        d.polygon([P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)], fill=c)
    d.polygon([P(0, 0), P(1240, 0), P(1240, 0, 150), P(0, 0, 150)], fill='#e9e1d2'); d.polygon([P(0, 0), P(0, 780), P(0, 780, 150), P(0, 0, 150)], fill='#ddd3c1')
    items = [(q['d'], q['frame'], *q['home']) for q in cat['placed'] if q['frame']]
    items.sort()
    for src in (atlas_sh, atlas):
        for (_, n, x, y) in items:
            fr = aj['frames'].get(n)
            if not fr: continue
            spr = src.crop((fr['x'], fr['y'], fr['x'] + fr['w'], fr['y'] + fr['h']))
            px, py = P(x, y); canvas.alpha_composite(spr, (round(px) - fr['ax'], round(py) - fr['ay']))
    canvas.resize((canvas.width * 2, canvas.height * 2), Image.NEAREST).save(png)
    print('office preview', png, len(items), 'pieces')


if __name__ == '__main__':
    if sys.argv[1] == '--preview': preview(sys.argv[2], sys.argv[3])
    elif sys.argv[1] == '--office-preview': office_preview(sys.argv[2], sys.argv[3])
    else: build(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
