#!/usr/bin/env python3
"""Assemble the 3D viewer into one self-contained HTML file.

Runs the label generator, then inlines every texture as a data URI so the
result has exactly one outside dependency: three.js from the CDN, pinned by
SRI hash.

    python3 tools/build-viewer.py

Writes viewer/castano-3d.html from viewer/castano-3d.src.html. Edit the
source, never the output.
"""

import base64
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "viewer" / "castano-3d.src.html"
OUT = ROOT / "viewer" / "castano-3d.html"
ASSETS = ROOT / "viewer" / "assets"

SLOTS = {
    "__LABEL_FRONT__": "label-front.png",
    "__LABEL_FRONT_ORM__": "label-front-orm.png",
    "__LABEL_BACK__": "label-back.png",
    "__LABEL_BACK_ORM__": "label-back-orm.png",
    "__ZIPPER__": "zipper.png",
    "__ZIPPER_ORM__": "zipper-orm.png",
}


def data_uri(path):
    return "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode()


def main():
    print("drawing labels")
    subprocess.run([sys.executable, str(ROOT / "tools" / "make-labels.py")], check=True)

    html = SRC.read_text()
    for slot, name in SLOTS.items():
        f = ASSETS / name
        if not f.exists():
            sys.exit(f"missing {f}")
        if slot not in html:
            sys.exit(f"slot {slot} not found in the source — did it get renamed?")
        html = html.replace(slot, data_uri(f))

    left = [s for s in SLOTS if s in html]
    if left:
        sys.exit(f"slots left unfilled: {left}")

    # everything except the pinned three.js must be inline
    ext = [u for u in re.findall(r'(?:src|href)="(?!data:|#)([^"]+)"', html)
           if "cdnjs.cloudflare.com" not in u]
    if ext:
        sys.exit(f"unexpected external reference: {ext}")

    if "integrity=" not in html and "THREE_SRI" not in html:
        sys.exit("the three.js tag lost its SRI hash")

    OUT.write_text(html)
    print(f"wrote {OUT} ({len(html.encode()) / 1024:.0f} KB)")
    print("outside dependencies: three.js 0.160.0 from cdnjs, pinned by SRI")


if __name__ == "__main__":
    main()
