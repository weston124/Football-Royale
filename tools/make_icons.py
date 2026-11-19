"""Draws the Football Royale app icons (original art: a football wearing a gold crown).

Run:  python3 tools/make_icons.py
Writes client/icons/*.png and client/favicon.ico
"""
import math
import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'client', 'icons')
NAVY, NAVY2 = (13, 24, 48), (36, 22, 92)
GOLD, GOLD_DARK = (255, 204, 51), (184, 138, 16)
ORANGE = (255, 90, 42)
BROWN, BROWN_DARK = (139, 69, 32), (92, 44, 18)
WHITE = (255, 255, 255)
S = 1024  # draw big, scale down for smooth edges


def background(d, full):
    # diagonal navy-to-purple gradient (full bleed so it works as a maskable icon)
    img = Image.new('RGB', (S, S))
    px = img.load()
    for y in range(S):
        for x in range(S):
            t = (x + y) / (2 * S)
            px[x, y] = tuple(int(NAVY[i] * (1 - t) + NAVY2[i] * t) for i in range(3))
    # soft spotlight
    glow = Image.new('L', (S, S), 0)
    ImageDraw.Draw(glow).ellipse((S * .18, S * .2, S * .82, S * .86), fill=110)
    glow = glow.filter(ImageFilter.GaussianBlur(S * .08))
    img = Image.composite(Image.new('RGB', (S, S), (90, 60, 190)), img, glow)
    return img


def football(img, cx, cy, w, h, angle):
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    box = (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)
    # pointed ball: intersection of two big circles (a lens shape)
    r = (w * w / 4 + h * h / 4) / h
    lens = Image.new('L', (S, S), 0)
    a = Image.new('L', (S, S), 0); ImageDraw.Draw(a).ellipse((cx - r, cy - h / 2, cx + r, cy - h / 2 + 2 * r), fill=255)
    b = Image.new('L', (S, S), 0); ImageDraw.Draw(b).ellipse((cx - r, cy + h / 2 - 2 * r, cx + r, cy + h / 2), fill=255)
    from PIL import ImageChops
    lens = ImageChops.multiply(a, b)
    body = Image.new('RGBA', (S, S), BROWN + (255,))
    # shading: darker toward the bottom
    shade = Image.new('L', (S, S), 0)
    ImageDraw.Draw(shade).ellipse((cx - w * .55, cy - h * .05, cx + w * .55, cy + h * .9), fill=150)
    shade = shade.filter(ImageFilter.GaussianBlur(S * .04))
    body = Image.composite(Image.new('RGBA', (S, S), BROWN_DARK + (255,)), body, shade)
    hi = Image.new('L', (S, S), 0)
    ImageDraw.Draw(hi).ellipse((cx - w * .3, cy - h * .42, cx + w * .1, cy - h * .18), fill=90)
    hi = hi.filter(ImageFilter.GaussianBlur(S * .03))
    body = Image.composite(Image.new('RGBA', (S, S), (200, 120, 70, 255)), body, hi)
    layer.paste(body, (0, 0), lens)
    d = ImageDraw.Draw(layer)
    # white end stripes
    for side in (-1, 1):
        x = cx + side * w * .30
        d.line((x, cy - h * .36, x, cy + h * .36), fill=WHITE, width=int(S * .028))
    # laces
    d.line((cx - w * .17, cy, cx + w * .17, cy), fill=WHITE, width=int(S * .02))
    for i in range(-2, 3):
        x = cx + i * w * .07
        d.line((x, cy - h * .11, x, cy + h * .11), fill=WHITE, width=int(S * .02))
    # re-clip stripes/laces to the ball
    clipped = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    clipped.paste(layer, (0, 0), lens)
    clipped = clipped.rotate(angle, resample=Image.BICUBIC, center=(cx, cy))
    # drop shadow
    sh = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    sh.paste((0, 0, 0, 130), (0, 0), clipped.split()[3])
    sh = sh.filter(ImageFilter.GaussianBlur(S * .02))
    img.paste(sh, (int(S * .012), int(S * .025)), sh)
    img.paste(clipped, (0, 0), clipped)


def crown(img, cx, base_y, w, h):
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x0, x1 = cx - w / 2, cx + w / 2
    top = base_y - h
    pts = [(x0, base_y), (x0 - w * .04, top + h * .2), (x0 + w * .25, top + h * .55), (cx, top),
           (x1 - w * .25, top + h * .55), (x1 + w * .04, top + h * .2), (x1, base_y)]
    d.polygon(pts, fill=GOLD, outline=GOLD_DARK)
    d.rectangle((x0, base_y - h * .05, x1, base_y + h * .22), fill=GOLD)
    d.rectangle((x0, base_y + h * .14, x1, base_y + h * .22), fill=GOLD_DARK)
    for (px, py) in [(x0 - w * .04, top + h * .2), (cx, top), (x1 + w * .04, top + h * .2)]:
        rr = w * .065
        d.ellipse((px - rr, py - rr, px + rr, py + rr), fill=GOLD, outline=GOLD_DARK, width=int(S * .006))
    # jewels
    d.ellipse((cx - w * .07, base_y - h * .02, cx + w * .07, base_y + h * .16), fill=ORANGE)
    for side in (-1, 1):
        jx = cx + side * w * .3
        d.ellipse((jx - w * .045, base_y + h * .02, jx + w * .045, base_y + h * .14), fill=(79, 209, 107))
    sh = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    sh.paste((0, 0, 0, 120), (0, 0), layer.split()[3])
    sh = sh.filter(ImageFilter.GaussianBlur(S * .015))
    img.paste(sh, (int(S * .01), int(S * .02)), sh)
    img.paste(layer, (0, 0), layer)


def draw(full_bleed=True, scale=1.0):
    img = background(None, full_bleed).convert('RGBA')
    # maskable icons keep the art inside the middle 80% "safe zone"
    k = scale
    cx, cy = S / 2, S * (.5 + .08 * k)
    football(img, cx, cy, S * .78 * k, S * .48 * k, 25)
    crown(img, S / 2 - S * .02 * k, cy - S * .2 * k, S * .36 * k, S * .2 * k)
    return img


def main():
    os.makedirs(OUT, exist_ok=True)
    big = draw(scale=1.0)
    maskable = draw(scale=0.78)
    for size in (512, 192, 180, 32, 16):
        name = {180: 'apple-touch-icon.png'}.get(size, f'icon-{size}.png')
        big.resize((size, size), Image.LANCZOS).convert('RGB').save(os.path.join(OUT, name), optimize=True)
    for size in (512, 192):
        maskable.resize((size, size), Image.LANCZOS).convert('RGB').save(os.path.join(OUT, f'maskable-{size}.png'), optimize=True)
    big.convert('RGB').resize((64, 64), Image.LANCZOS).save(os.path.join(ROOT, 'client', 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    print('icons written to', OUT)


if __name__ == '__main__':
    main()
