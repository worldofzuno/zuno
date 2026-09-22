#!/usr/bin/env python3
"""Self-test for tools/cutout.py, run as: python3 tools/test_cutout.py

There is no second photograph to test against, so the test builds one: the
existing front cut-out composited onto a synthetic sweep that has both a
vertical gradient and a horizontal vignette. Recovering the original from that
exercises every part of the pipeline, and the answer is known exactly.

The sweep is deliberately awkward. A flat grey would pass with a naive
backdrop model; the gradient plus vignette is what forces the per-row fit.

The regression this exists for: a fixed silhouette threshold let a strong
contact shadow into the silhouette, where it survived the erosion and then
supplied its backdrop-bright colour to the whole contour. On screen that was a
white crescent under the bag. HALO_MAX guards it.
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from cutout import bbox, cut_out, reframe  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "site" / "img" / "castano-bag.png"

ALPHA_MEAN_MAX = 0.02     # measured 0.003
CORE_RGB_MAX = 6.0        # measured 2.67; the floor is resampling and webp noise
HALO_MAX = 0              # measured 0; was 749 before the threshold was made adaptive
FRAME_TOLERANCE = 2       # px


def build_scene(tmp):
    """The known subject, on a backdrop that punishes a lazy model."""
    cut = Image.open(TEMPLATE).convert("RGBA")
    W, H = 1200, 1300
    y = np.linspace(0, 1, H)[:, None]
    x = np.linspace(0, 1, W)[None, :]
    L = 212 + 34 * y ** 1.6 + 6 * np.sin(x * np.pi)
    bg = np.dstack([L, L * 1.002, L * 0.996]).clip(0, 255).astype(np.uint8)

    scene = Image.fromarray(bg, "RGB").convert("RGBA")
    scaled = cut.resize((int(cut.width * 1.15), int(cut.height * 1.15)), Image.LANCZOS)
    scene.alpha_composite(scaled, dest=((W - scaled.width) // 2 + 30, H - scaled.height - 60))
    path = tmp / "scene.webp"
    scene.convert("RGB").save(path, quality=95)
    return path


def main():
    if not TEMPLATE.exists():
        sys.exit(f"missing {TEMPLATE}")
    tmp = Path(__file__).parent / "__test__"
    tmp.mkdir(exist_ok=True)

    scene = build_scene(tmp)
    got = reframe(cut_out(scene), TEMPLATE)

    ref = np.asarray(Image.open(TEMPLATE).convert("RGBA")).astype(np.float32)
    rec = np.asarray(got).astype(np.float32)
    ra, ca = ref[..., 3] / 255, rec[..., 3] / 255

    alpha_dev = float(np.abs(ra - ca).mean())
    solid = (ra > 0.9) & (ca > 0.9)
    rgb_dev = float(np.abs(ref[..., :3] - rec[..., :3])[solid].mean())

    # A halo is contour colour the subject could not have supplied.
    core_mask = ca > 0.98
    ceiling = float(np.percentile(rec[..., :3][core_mask].mean(1), 99)) + 20
    edge = (ca > 0.05) & (ca < 0.95)
    halo = int((edge & (rec[..., :3].mean(2) > ceiling)).sum())

    t = bbox(Image.open(TEMPLATE).convert("RGBA"))
    g = bbox(got)
    frame_off = max(abs(a - b) for a, b in zip(t, g))

    checks = [
        ("alpha deviation", alpha_dev, ALPHA_MEAN_MAX),
        ("core rgb deviation", rgb_dev, CORE_RGB_MAX),
        ("halo pixels", halo, HALO_MAX),
        ("frame offset px", frame_off, FRAME_TOLERANCE),
    ]
    print()
    bad = 0
    for name, value, limit in checks:
        ok = value <= limit
        bad += not ok
        print(f"  {'ok  ' if ok else 'FAIL'}  {name:<20} {value:>8.4f}  (limit {limit})")

    for f in tmp.iterdir():
        f.unlink()
    tmp.rmdir()

    if bad:
        sys.exit(f"\n{bad} check(s) failed")
    print("\nall checks passed")


if __name__ == "__main__":
    main()
