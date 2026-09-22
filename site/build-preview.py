#!/usr/bin/env python3
"""Flatten site/index.html into one self-contained HTML file.

Netlify serves the site as a folder of files, which is right for the web but
useless for sharing a link to a preview or for surviving a wiped container.
This inlines every font, image and library so the result opens from anywhere
with nothing beside it.

    python3 site/build-preview.py [output.html]

Default output is preview/zuno-brand-site-inline.html.
"""
import base64
import mimetypes
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).parent
ROOT = HERE.parent
OUT = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "preview" / "zuno-brand-site-inline.html"

html = (HERE / "index.html").read_text()


def data_uri(rel: str) -> str:
    path = HERE / rel
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    if path.suffix == ".woff2":
        mime = "font/woff2"
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()


# 1. Fonts, referenced from @font-face src.
for rel in sorted(set(re.findall(r"url\('([^']+)'\)", html))):
    html = html.replace(f"url('{rel}')", f"url('{data_uri(rel)}')")

# 2. Images.
for rel in sorted(set(re.findall(r'src="(img/[^"]+)"', html))):
    html = html.replace(f'src="{rel}"', f'src="{data_uri(rel)}"')

# 3. Icons. The preload hints and the manifest point at files that will not
#    exist next to a standalone page, so drop them rather than 404.
html = re.sub(r'\s*<link rel="preload"[^>]*>', "", html)
html = re.sub(r'\s*<link rel="manifest"[^>]*>', "", html)
for tag in re.findall(r'<link rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]+)"', html):
    if not tag.startswith("data:"):
        html = html.replace(f'href="{tag}"', f'href="{data_uri(tag)}"')

# 4. The cells shader. The loader in index.html checks for window.VANTA
#    first, so inlining it ahead of it is all that is needed.
libs = "\n".join(
    f"<script>{(HERE / 'js' / name).read_text()}</script>"
    for name in ("cells.js",)
)
marker = "<script>\n/* ---------------- CELLS background ----------------"
if marker not in html:
    sys.exit("could not find the Vanta loader block to inline ahead of")
html = html.replace(marker, libs + "\n" + marker, 1)

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(html)
print(f"wrote {OUT} ({len(html.encode()) / 1024:.0f} KB)")

left = re.findall(r'(?:src|href)="(?!data:|#|https?:|mailto:)([^"]+)"', html)
print("remaining external references:", sorted(set(left)) or "none")
