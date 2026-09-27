#!/usr/bin/env python3
"""Draw the Castano label artwork as flat textures for the 3D viewer.

Flat means flat: no studio lighting, no perspective, no shadow. The photographs
carry all three baked in, which is why they must not be projected onto the mesh
— the bag would arrive in the scene already lit, and then get lit again.

Everything is drawn from the brand's own material: Felix Titling out of
site/fonts, and the ZUNO wordmark and Z mark out of site/img. The typeface was
confirmed against a photograph of the printed label at matched cap height
before this script was written.

Each label is emitted twice:
  <name>.png     base colour
  <name>-orm.png G = roughness, B = metalness, the packing three.js reads when
                 the same texture is given to roughnessMap and metalnessMap.
                 Gold ink is metal; the green stock is not. Without this the
                 foil reads as yellow paint.

The dimensions in millimetres live in the viewer, not here; this only draws
pixels. Aspect ratios are matched to the photographs.
"""

import pathlib
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "viewer" / "assets"
FONT_WOFF2 = ROOT / "site" / "fonts" / "felix-titling.woff2"

# Sampled from the photographs, then pulled back towards albedo: a photograph
# records colour times light, and these are multiplied by light again in the
# scene. Tune here if the render reads too dark or too warm.
GREEN_TOP = (18, 50, 26)
GREEN_BOTTOM = (13, 38, 20)
GOLD = (214, 178, 106)          # foil tint; the environment supplies the shine
GOLD_ROUGH = 0.26
STOCK_ROUGH = 0.58

FRONT_W, FRONT_H = 1024, 1118   # 0.916, measured off the white-background shot
BACK_W, BACK_H = 1024, 1238     # 0.827, measured off the back shot
ZIP_W, ZIP_H = 2048, 256


def ttf():
    """Felix Titling ships as woff2; PIL needs a plain TTF."""
    dst = pathlib.Path("/tmp/felix-titling.ttf")
    if not dst.exists():
        f = TTFont(FONT_WOFF2)
        f.flavor = None
        f.save(dst)
    return str(dst)


FONT = None


def face(px):
    return ImageFont.truetype(FONT, px)


def tracked(draw, xy, text, font, fill, tracking=0.0, anchor="l"):
    """PIL has no letter-spacing, and this typeface needs a lot of it."""
    widths = [draw.textlength(ch, font=font) for ch in text]
    total = sum(widths) + tracking * max(len(text) - 1, 0)
    x, y = xy
    if anchor == "c":
        x -= total / 2
    elif anchor == "r":
        x -= total
    for ch, w in zip(text, widths):
        draw.text((x, y), ch, font=font, fill=fill)
        x += w + tracking
    return total


def gradient(w, h, top, bottom):
    t = np.linspace(0, 1, h)[:, None, None]
    a = np.array(top, float)[None, None, :]
    b = np.array(bottom, float)[None, None, :]
    return Image.fromarray((a + (b - a) * t).repeat(w, 1).astype(np.uint8), "RGB")


def mark(path, width):
    """A brand mark, recoloured to the label's gold and scaled to a width."""
    im = Image.open(ROOT / "site" / "img" / path).convert("RGBA")
    h = round(im.height * width / im.width)
    im = im.resize((width, h), Image.LANCZOS)
    solid = Image.new("RGBA", im.size, GOLD + (255,))
    solid.putalpha(im.getchannel("A"))
    return solid


def emit(name, colour, goldmask):
    """Base colour plus the roughness/metalness packing three.js expects."""
    OUT.mkdir(parents=True, exist_ok=True)
    colour.save(OUT / f"{name}.png", optimize=True)

    # Half resolution and few levels: this map carries a roughness step and a
    # metal flag, not detail, and at full size it cost more than the artwork.
    small = goldmask.convert("L").resize(
        (goldmask.width // 2, goldmask.height // 2), Image.LANCZOS)
    m = np.asarray(small).astype(np.float32) / 255.0
    rough = STOCK_ROUGH + (GOLD_ROUGH - STOCK_ROUGH) * m
    orm = np.zeros(m.shape + (3,), np.uint8)
    orm[..., 0] = 255                                  # no baked occlusion
    orm[..., 1] = np.clip(rough * 255, 0, 255)         # roughness
    orm[..., 2] = np.clip(m * 255, 0, 255)             # metalness
    Image.fromarray(orm, "RGB").quantize(colors=16, dither=Image.NONE).save(
        OUT / f"{name}-orm.png", optimize=True)
    print(f"  {name}.png {colour.size}  +  {name}-orm.png")


def front():
    W, H = FRONT_W, FRONT_H
    col = gradient(W, H, GREEN_TOP, GREEN_BOTTOM)
    gold = Image.new("L", (W, H), 0)
    dc, dg = ImageDraw.Draw(col), ImageDraw.Draw(gold)

    wm = mark("zuno-wordmark.png", round(W * 0.60))
    pos = ((W - wm.width) // 2, round(H * 0.105))
    col.paste(wm, pos, wm)
    gold.paste(wm.getchannel("A"), pos)

    f_cast = face(round(H * 0.046))
    y = round(H * 0.300)
    for d, fill in ((dc, GOLD), (dg, 255)):
        tracked(d, (W / 2, y), "CASTANO", f_cast, fill, tracking=W * 0.028, anchor="c")

    f_body = face(round(H * 0.040))
    lx, rx = round(W * 0.085), round(W * 0.915)
    y = round(H * 0.520)
    step = round(H * 0.052)
    for d, fill in ((dc, GOLD), (dg, 255)):
        tracked(d, (lx, y), "ARABICA 70%", f_body, fill, tracking=1.0)
        tracked(d, (lx, y + step), "ROBUSTA 30%", f_body, fill, tracking=1.0)
        tracked(d, (rx, y), "CAPPUCCINO", f_body, fill, tracking=1.0, anchor="r")
        tracked(d, (rx, y + step), "ESPRESSO", f_body, fill, tracking=1.0, anchor="r")
        y2 = round(H * 0.700)
        tracked(d, (lx, y2), "ROASTED IN BERN", f_body, fill, tracking=1.0)
        tracked(d, (rx, y2), "500 G", f_body, fill, tracking=1.0, anchor="r")

    emit("label-front", col, gold)


def back():
    W, H = BACK_W, BACK_H
    col = gradient(W, H, GREEN_TOP, GREEN_BOTTOM)
    gold = Image.new("L", (W, H), 0)
    dc, dg = ImageDraw.Draw(col), ImageDraw.Draw(gold)

    z = mark("z-mark.png", round(W * 0.30))
    pos = (round(W * 0.075), round(H * 0.395))
    col.paste(z, pos, z)
    gold.paste(z.getchannel("A"), pos)

    f = face(round(H * 0.037))
    rx = round(W * 0.930)
    step = round(H * 0.045)

    blocks = [
        (0.110, ["NUTTY, CHOCOLATY", "AND EFFORTLESSLY", "GOOD"]),
        (0.360, ["STRONG ENOUGH", "TO FUEL YOUR", "DREAMS",
                 "SMOOTH ENOUGH", "TO ENJOY", "EVERY SIP"]),
        (0.780, ["BEANS BY", "ZUNOWORLD.COM"]),
    ]
    for d, fill in ((dc, GOLD), (dg, 255)):
        for top, lines in blocks:
            y = round(H * top)
            for line in lines:
                tracked(d, (rx, y), line, f, fill, tracking=1.0, anchor="r")
                y += step

    emit("label-back", col, gold)


def zipper():
    """The printed tear strip, gold on transparent film."""
    W, H = ZIP_W, ZIP_H
    col = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gold = Image.new("L", (W, H), 0)
    dc, dg = ImageDraw.Draw(col), ImageDraw.Draw(gold)

    # "TAB" in an arrow badge at the left
    ax, ay, aw, ah = 40, 30, 150, 74
    arrow = [(ax, ay), (ax + aw - 34, ay), (ax + aw, ay + ah / 2),
             (ax + aw - 34, ay + ah), (ax, ay + ah)]
    for d, fill in ((dc, GOLD + (255,)), (dg, 255)):
        d.polygon(arrow, outline=fill, width=5)
    f_tab = face(40)
    for d, fill in ((dc, GOLD + (255,)), (dg, 255)):
        tracked(d, (ax + 26, ay + 16), "TAB", f_tab, fill, tracking=1.0)

    f = face(44)
    for d, fill in ((dc, GOLD + (255,)), (dg, 255)):
        w = tracked(d, (ax + aw + 40, ay + 14), "PULL TAB TO OPEN", f, fill, tracking=2.0)
        x = ax + aw + 60 + w
        while x < W - 60:                      # the run of little arrows
            d.polygon([(x, ay + 20), (x + 26, ay + ah / 2), (x, ay + ah - 20)], fill=fill)
            x += 44

    # the zip band: a zigzag with a rounded ZIPPER badge over the middle
    zy = ay + ah + 34
    for d, fill in ((dc, GOLD + (255,)), (dg, 255)):
        pts = []
        x = 40
        while x < W - 40:
            pts += [(x, zy), (x + 11, zy + 22)]
            x += 22
        d.line(pts, fill=fill, width=5)

    bw, bh = 300, 62
    bx, by = (W - bw) // 2, zy - 20
    f_zip = face(42)
    for d, fill in ((dc, GOLD + (255,)), (dg, 255)):
        d.rounded_rectangle([bx, by, bx + bw, by + bh], radius=bh // 2, fill=(0, 0, 0, 255)
                            if d is dc else 0)
    for d, fill in ((dc, GOLD + (255,)), (dg, 255)):
        d.rounded_rectangle([bx, by, bx + bw, by + bh], radius=bh // 2, outline=fill, width=4)
        tracked(d, (W / 2, by + 10), "ZIPPER", f_zip, fill, tracking=3.0, anchor="c")

    OUT.mkdir(parents=True, exist_ok=True)
    col.save(OUT / "zipper.png", optimize=True)
    small = gold.resize((gold.width // 2, gold.height // 2), Image.LANCZOS)
    m = np.asarray(small).astype(np.float32) / 255.0
    orm = np.zeros(m.shape + (3,), np.uint8)
    orm[..., 0] = 255
    orm[..., 1] = np.clip((STOCK_ROUGH + (GOLD_ROUGH - STOCK_ROUGH) * m) * 255, 0, 255)
    orm[..., 2] = np.clip(m * 255, 0, 255)
    Image.fromarray(orm, "RGB").quantize(colors=16, dither=Image.NONE).save(
        OUT / "zipper-orm.png", optimize=True)
    print(f"  zipper.png {col.size}  +  zipper-orm.png")


def main():
    global FONT
    if not FONT_WOFF2.exists():
        sys.exit(f"missing {FONT_WOFF2}")
    FONT = ttf()
    print("drawing labels")
    front()
    back()
    zipper()


if __name__ == "__main__":
    main()
