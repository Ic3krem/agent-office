# Post-process the raw Blender renders into the shipped town art. Original art, Apache-2.0.
#   python art/post.py <raw dir> <out dir>          palette, atlases, terrain chunks
#   python art/post.py --preview <out dir> <png>    compose terrain + every sprite at its town.json spot, 2x
import sys, os, json, glob
from collections import Counter
from PIL import Image, ImageEnhance, ImageFilter, ImageChops

HERE = os.path.dirname(os.path.abspath(__file__))
OUTLINE, SHADOW = (0x2b, 0x1b, 0x16), (0x1a, 0x22, 0x40)
NCOL, PAD, CHUNK, MAXA, CAP = 63, 2, 512, 2048, 400  # 63 median-cut colours + the outline = 64


def look(im):
    """Binarise alpha, then the target's warm grade: brighten 1.12, saturate 1.15."""
    a = im.getchannel('A').point(lambda v: 255 if v > 100 else 0)
    rgb = ImageEnhance.Color(ImageEnhance.Brightness(im.convert('RGB')).enhance(1.12)).enhance(1.15)
    rgb.putalpha(a); return rgb


def outline(im):
    a = im.getchannel('A'); ring = ImageChops.subtract(a.filter(ImageFilter.MaxFilter(3)), a)
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


def build(raw, out):
    town_assets = sorted(os.path.basename(p)[:-5] for p in glob.glob(os.path.join(raw, '*.json')) if not p.endswith('terrain.json'))
    sprites = {}
    for n in town_assets:
        meta = json.load(open(os.path.join(raw, n + '.json')))
        col = look(Image.open(os.path.join(raw, n + '.png')).convert('RGBA'))
        sh = shadow(col, Image.open(os.path.join(raw, n + '.ground.png')).convert('RGBA'), Image.open(os.path.join(raw, n + '.noshadow.png')).convert('RGBA'))
        sprites[n] = [col, sh, meta['anchor']]
    terrain = look(Image.open(os.path.join(raw, 'terrain.png')).convert('RGBA'))
    tmeta = json.load(open(os.path.join(raw, 'terrain.json')))

    # shared palette: median cut (k-means refined) over the opaque pixels of every colour render and the terrain;
    # each colour's weight is capped so big flat areas (grass) don't starve small accents (pavers, glass, awnings)
    cnt = Counter(p for im in [c for c, _, _ in sprites.values()] + [terrain]
                  for p, a in zip(im.convert('RGB').get_flattened_data(), im.getchannel('A').get_flattened_data()) if a)
    allpx = [c for c, k in cnt.items() for _ in range(min(k, CAP))]
    sample = Image.new('RGB', (len(allpx), 1)); sample.putdata(allpx)
    pq = sample.quantize(colors=NCOL, method=Image.Quantize.MEDIANCUT, kmeans=4, dither=Image.Dither.NONE)
    cols = [tuple(pq.getpalette()[i * 3:i * 3 + 3]) for _, i in pq.getcolors()]
    cols = sorted(set(cols)) + [OUTLINE]
    if len(cols) > 64: print('palette has', len(cols), 'colours (> 64)'); sys.exit(1)
    pal = palette_image(cols)
    json.dump({'colors': ['#%02x%02x%02x' % c for c in cols], 'outline': '#%02x%02x%02x' % OUTLINE}, open(os.path.join(HERE, 'palette.json'), 'w'), indent=1)

    # map sprites to the palette, add the outline, crop colour+shadow to their union
    frames = {}
    for n, (col, sh, (ax, ay)) in sprites.items():
        col = outline(to_palette(col, pal, len(cols)).convert('RGBA'))
        u = ImageChops.lighter(col.getchannel('A'), sh.getchannel('A')).getbbox()
        frames[n] = (col.crop(u), sh.crop(u), ax - u[0], ay - u[1])

    # shelf packer, tallest first, 2 px padding
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
    atlas, atlas_sh, meta = Image.new('RGBA', (W, H), (0, 0, 0, 0)), Image.new('RGBA', (W, H), SHADOW + (0,)), {}
    for n in sorted(frames):
        c, s, ax, ay = frames[n]; x, y = rects[n]
        atlas.paste(c, (x, y)); atlas_sh.paste(s, (x, y))
        meta[n] = {'x': x, 'y': y, 'w': c.width, 'h': c.height, 'ax': ax, 'ay': ay}
    os.makedirs(os.path.join(out, 'terrain'), exist_ok=True)
    save_p(to_palette(atlas, pal, len(cols)), os.path.join(out, 'atlas.png'))
    atlas_sh.save(os.path.join(out, 'atlas-shadow.png'), optimize=True)
    json.dump({'frames': meta, 'size': [W, H]}, open(os.path.join(out, 'atlas.json'), 'w'), indent=1)

    # terrain: palette + outline round the whole block (not per chunk), cut into 512 px chunks
    t = outline(to_palette(terrain, pal, len(cols)).convert('RGBA'))
    tp = to_palette(t, pal, len(cols)); TW, TH = tp.size
    cols_n, rows_n = -(-TW // CHUNK), -(-TH // CHUNK)
    for f in glob.glob(os.path.join(out, 'terrain', '*.png')): os.remove(f)
    for r in range(rows_n):
        for c in range(cols_n):
            ch = tp.crop((c * CHUNK, r * CHUNK, min(TW, (c + 1) * CHUNK), min(TH, (r + 1) * CHUNK))); ch.info['transparency'] = len(cols)
            save_p(ch, os.path.join(out, 'terrain', f'r{r}c{c}.png'))
    json.dump({'originPx': tmeta['originPx'], 'chunk': CHUNK, 'cols': cols_n, 'rows': rows_n, 'size': [TW, TH]}, open(os.path.join(out, 'terrain.json'), 'w'), indent=1)
    print(f'palette {len(cols)} colours; atlas {W}x{H}; terrain {TW}x{TH} in {cols_n}x{rows_n} chunks')


def preview(out, png):
    town = json.load(open(os.path.join(HERE, '..', 'public', 'town', 'town.json'), encoding='utf8'))
    tj, aj = json.load(open(os.path.join(out, 'terrain.json'))), json.load(open(os.path.join(out, 'atlas.json')))
    canvas = Image.new('RGBA', tuple(tj['size']), (160, 196, 214, 255))
    for r in range(tj['rows']):
        for c in range(tj['cols']):
            canvas.alpha_composite(Image.open(os.path.join(out, 'terrain', f'r{r}c{c}.png')).convert('RGBA'), (c * tj['chunk'], r * tj['chunk']))
    atlas, atlas_sh = Image.open(os.path.join(out, 'atlas.png')).convert('RGBA'), Image.open(os.path.join(out, 'atlas-shadow.png')).convert('RGBA')
    ox, oy = tj['originPx']
    items = [(l['building']['type'], l['building']['x'], l['building']['y']) for l in town['lots']] + [(d['type'], d['x'], d['y']) for d in town['decor']]
    items.sort(key=lambda i: i[1] + i[2])
    for src in (atlas_sh, atlas):  # all shadows first, then sprites back to front
        for (n, x, y) in items:
            f = aj['frames'][n]; spr = src.crop((f['x'], f['y'], f['x'] + f['w'], f['y'] + f['h']))
            px, py = round(ox + 0.70710678 * (x - y)) - f['ax'], round(oy + 0.35355339 * (x + y)) - f['ay']
            canvas.alpha_composite(spr, (px, py)) if px >= 0 and py >= 0 else canvas.paste(spr, (px, py), spr)
    canvas.resize((canvas.width * 2, canvas.height * 2), Image.NEAREST).save(png)
    print('preview', png)


if __name__ == '__main__':
    if sys.argv[1] == '--preview': preview(sys.argv[2], sys.argv[3])
    else: build(sys.argv[1], sys.argv[2])
