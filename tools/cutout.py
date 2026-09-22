#!/usr/bin/env python3
"""Cut a product shot out of a light seamless backdrop.

Written for the ZUNO bag photographs: a near-black pouch on a grey sweep with
a soft contact shadow. The parameters below are the ones that produced
site/img/castano-bag.webp and castano-bag-back.webp, and they are recorded
here rather than in a commit message so the next photograph is one command
rather than an afternoon.

    python3 tools/cutout.py shot.webp site/img/castano-bag-back \\
        --match site/img/castano-bag.png

--match reframes the result onto the same canvas as an existing cut-out, with
the bag at the same height and standing on the same line, so a product-image
switcher can swap between them without the bag moving.

Three things here are not obvious and are the difference between this working
and not:

1. The backdrop is modelled per row, linear in x, from the margins either side
   of the bag. A single 2-D surface fit reads the wall-to-floor crease as
   product and eats the bottom of the bag.

2. The silhouette is filled and forced opaque. Specular highlights along the
   top fold are brighter than the modelled backdrop, so a plain luminance
   threshold punches holes straight through the bag.

3. Contour colour is the nearest unambiguously-dark subject pixel extended
   outward, NOT the un-mixing formula F = (I - (1-a)B) / a. That formula is
   correct in theory and unusable in practice: at small alpha it divides by
   almost nothing and throws bright pixels into the edge, which reads as a
   halo. Note that "may donate colour outward" and "keeps its own colour" are
   deliberately different masks — see cut_out(). Merging them erases the gold
   foil on the label.
"""

import argparse
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

# Alpha ramp. LO sits just above the background residual (measured p99 ~14),
# HI below the darkness of the bag itself (~190), so the bag saturates well
# before it and only the true edge and the shadow land in between.
ALPHA_LO, ALPHA_HI = 15.0, 110.0
# The silhouette threshold is a FRACTION of how dark the subject actually is,
# not a fixed number. A fixed one was tuned against a single photograph's
# shadow and let a stronger shadow into the silhouette, where it survived the
# erosion and then supplied its bright colour to the whole contour.
SILHOUETTE_FRAC = 0.45
CORE_FRAC = 0.60           # only this dark may DONATE colour outward; see cut_out()
SHADOW_CAP = 0.45          # nothing outside the bag may become near-solid
SPECK_MIN_PX = 2000        # smaller disconnected blobs are dirt, not shadow
SHADOW_RGB = (1.0, 1.0, 1.2)


def backdrop_model(I, x0, x1):
    """Per-row background estimate, linear in x between the two margins."""
    H, W, _ = I.shape
    B = np.zeros_like(I)
    t = np.linspace(0, 1, W)[:, None]
    for y in range(H):
        left, right = I[y, :x0], I[y, x1:]
        if len(left) < 8 or len(right) < 8:
            pool = np.concatenate([left, right]) if len(left) + len(right) else I[y]
            B[y] = np.median(pool, axis=0)
            continue
        lv = np.median(left[-60:], axis=0)    # measure close to the edge
        rv = np.median(right[:60], axis=0)
        B[y] = lv[None, :] * (1 - t) + rv[None, :] * t
    return B


def largest_component(mask):
    lab, n = ndimage.label(mask)
    if not n:
        return mask
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    return lab == (int(np.argmax(sizes)) + 1)


def cut_out(path):
    I = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)

    rough = largest_component(ndimage.binary_opening(I.mean(2) < 140, np.ones((5, 5))))
    ys, xs = np.nonzero(rough)
    if not len(xs):
        sys.exit("no dark subject found — is the backdrop light?")
    x0 = max(0, xs.min() - 25)
    x1 = min(I.shape[1], xs.max() + 25)

    B = backdrop_model(I, x0, x1)
    d = (B - I).mean(2)

    subject_d = float(np.median(d[rough]))
    sil_thresh = SILHOUETTE_FRAC * subject_d
    sil = largest_component(
        ndimage.binary_fill_holes(
            ndimage.binary_closing(d > sil_thresh, np.ones((7, 7)))))

    a = np.clip((d - ALPHA_LO) / (ALPHA_HI - ALPHA_LO), 0, 1)
    inner = ndimage.binary_erosion(sil, np.ones((5, 5)))
    a[inner] = 1.0                                     # opaque, highlights and all

    outside = ~ndimage.binary_dilation(sil, np.ones((5, 5)))
    a[outside] = np.clip(a[outside], 0, SHADOW_CAP)

    speck = (a > 0.02) & outside
    lab, n = ndimage.label(ndimage.binary_closing(speck, np.ones((9, 9))))
    if n:
        sizes = ndimage.sum(speck, lab, range(1, n + 1))
        keep = [i + 1 for i, s in enumerate(sizes) if s > SPECK_MIN_PX]
        a[speck & ~np.isin(lab, keep)] = 0.0

    a = ndimage.gaussian_filter(a, 0.6)
    a[inner] = 1.0

    # Two different questions, which must not share one mask:
    #   who keeps their own colour  -> everything inside the silhouette, so
    #     gold foil and specular highlights survive intact;
    #   who may donate colour outward -> only unambiguously dark subject, so a
    #     shadow that crept into the silhouette cannot paint the contour with
    #     its backdrop-bright colour.
    # Collapsing these into one mask erases every bright detail on the label.
    keep = ndimage.binary_erosion(sil, np.ones((9, 9)))
    donor = largest_component(keep & (d > CORE_FRAC * subject_d))
    idx = ndimage.distance_transform_edt(~donor, return_distances=False, return_indices=True)
    rgb = np.where(keep[..., None], I, I[idx[0], idx[1]])
    rgb[outside & (a > 0)] = np.array(SHADOW_RGB, np.float32)

    bg_p99 = float(np.percentile(
        d[~ndimage.binary_dilation(sil, np.ones((31, 31)))], 99))
    # A halo is contour colour brighter than anything a donor could have
    # supplied, which is the signature of backdrop leaking into the edge.
    ceiling = float(np.percentile(I[donor].mean(1), 99)) + 20
    edge = (a > 0.05) & (a < 0.95) & ~keep
    halo = int((edge & (rgb.mean(2) > ceiling)).sum())
    print(f"  subject darkness {subject_d:.1f} (silhouette at {sil_thresh:.0f})"
          f"  |  background residual p99 {bg_p99:.1f}"
          f"  |  contour above core ceiling {halo}/{int(edge.sum())}")
    if bg_p99 > 25:
        print("  WARNING: the backdrop model is not fitting — check the lighting")
    if halo > 50:
        print("  WARNING: backdrop is leaking into the contour, expect a halo")

    return Image.fromarray(
        np.dstack([np.clip(rgb, 0, 255), a * 255]).astype(np.uint8), "RGBA")


def bbox(img, thresh=0.5):
    al = np.asarray(img)[..., 3] / 255.0
    ys, xs = np.nonzero(al > thresh)
    return ys.min(), ys.max(), xs.min(), xs.max()


def reframe(cut, template_path):
    """Put the subject on the template's canvas at the template's scale."""
    tpl = Image.open(template_path).convert("RGBA")
    t_top, t_bot, t_l, t_r = bbox(tpl)
    c_top, c_bot, c_l, c_r = bbox(cut)

    s = (t_bot - t_top + 1) / (c_bot - c_top + 1)
    cut = cut.resize((max(1, round(cut.width * s)), max(1, round(cut.height * s))),
                     Image.LANCZOS)

    n_top, n_bot, n_l, n_r = bbox(cut)
    off_y = int(round(t_bot - n_bot))                       # stand on the same line
    off_x = int(round((t_l + t_r) / 2 - (n_l + n_r) / 2))   # same centre

    canvas = Image.new("RGBA", tpl.size, (0, 0, 0, 0))
    src = cut.crop((max(0, -off_x), max(0, -off_y), cut.width, cut.height))
    canvas.alpha_composite(src, dest=(max(0, off_x), max(0, off_y)))

    a_top, a_bot, a_l, a_r = bbox(canvas)
    print(f"  template bag y {t_top}..{t_bot} x {t_l}..{t_r}")
    print(f"  result   bag y {a_top}..{a_bot} x {a_l}..{a_r}   (scale {s:.4f})")
    return canvas


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source")
    ap.add_argument("out_stem", help="written as <stem>.png and <stem>.webp")
    ap.add_argument("--match", help="existing cut-out to frame against")
    ap.add_argument("--quality", type=int, default=86,
                    help="webp quality (86 measured: mean error 1.2, alpha lossless)")
    args = ap.parse_args()

    print(f"cutting {args.source}")
    img = cut_out(args.source)
    if args.match:
        img = reframe(img, args.match)

    img.save(args.out_stem + ".png", optimize=True)
    img.save(args.out_stem + ".webp", "WEBP", quality=args.quality, method=6)
    print(f"  wrote {args.out_stem}.png and {args.out_stem}.webp")


if __name__ == "__main__":
    main()
