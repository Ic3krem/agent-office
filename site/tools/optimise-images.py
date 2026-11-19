"""Builds AVIF + WebP + PNG fallback (and 640px variants) of the repo screenshots into site/assets/img.
Run: python site/tools/optimise-images.py   (needs Pillow with AVIF + WebP). Output is committed."""
import glob, os, shutil, sys
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
REPO = os.path.dirname(SITE)
OUT = os.path.join(SITE, 'assets', 'img')
os.makedirs(OUT, exist_ok=True)
srcs = sorted(glob.glob(os.path.join(REPO, 'docs', 'images', '*.png'))) + [os.path.join(REPO, 'docs', 'kiro-moods.png')]

def save(im, base):
    rgb = im.convert('RGBA') if im.mode in ('P', 'LA') else im
    if rgb.mode == 'RGBA' and rgb.getchannel('A').getextrema()[0] == 255:
        rgb = rgb.convert('RGB')
    rgb.save(base + '.avif', quality=52, speed=6)
    rgb.save(base + '.webp', quality=76, method=6)
    png = base + '.png'
    rgb.save(png, optimize=True)
    if os.path.getsize(png) > 120_000:  # palette PNG fallback keeps legacy browsers light
        q = rgb.convert('RGB').quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        q.save(png, optimize=True)

for s in srcs:
    name = os.path.splitext(os.path.basename(s))[0].replace('kiro', 'tiro')
    im = Image.open(s); im.load()
    save(im, os.path.join(OUT, name))
    if im.width > 640:
        h = round(im.height * 640 / im.width)
        save(im.resize((640, h), Image.LANCZOS), os.path.join(OUT, name + '-640'))
    print(name, im.size)
# Tiro's moods as single sprites with a transparent background, cut from the 4 x 2 sheet (250 px cells, label strip dropped).
MOODS = ['idle', 'all-done', 'working', 'building', 'planning', 'approval', 'done', 'paused']
sheet = Image.open(os.path.join(REPO, 'docs', 'kiro-moods.png')).convert('RGBA')
for i, mood in enumerate(MOODS):
    cx, cy = (i % 4) * 250, (i // 4) * 250
    cell = sheet.crop((cx + 20, cy + 5, cx + 230, cy + (200 if i < 4 else 182)))  # the second row's labels sit higher
    key = cell.getpixel((1, 1))
    from PIL import ImageDraw
    for corner in [(0, 0), (cell.width - 1, 0), (0, cell.height - 1), (cell.width - 1, cell.height - 1)]:
        ImageDraw.floodfill(cell, corner, (0, 0, 0, 0), thresh=26)
    cell = cell.crop(cell.getbbox())
    save(cell, os.path.join(OUT, 'tiro-' + mood))
    print('tiro-' + mood, cell.size)

tot = sum(os.path.getsize(f) for f in glob.glob(os.path.join(OUT, '*')))
print('total', round(tot / 1024), 'KB')
