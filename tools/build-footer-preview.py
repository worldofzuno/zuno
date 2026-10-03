#!/usr/bin/env python3
"""Flatten the footer preview source into one self-contained file.

Same idea as tools/build-preview.py, kept separate because this builds a
proposal for review rather than the site. preview/ is not the published
folder — site/ is — so nothing here can reach the live domain.

    python3 tools/build-footer-preview.py
"""
import base64
import pathlib
import re

# Lives in tools/, like the other builders: everything in site/ goes live.
ROOT = pathlib.Path(__file__).resolve().parent.parent
S = ROOT / 'site'
SRC = ROOT / 'preview' / 'footer-preview.src.html'
OUT = ROOT / 'preview' / 'footer-preview.html'


def uri(rel, mime):
    return f"data:{mime};base64," + base64.b64encode((S / rel).read_bytes()).decode()


fonts = (
    "@font-face { font-family: 'Archivo'; font-style: normal; font-weight: 400 600;"
    " font-display: swap; src: url('%s') format('woff2'); }\n"
    "@font-face { font-family: 'Felix Titling'; src: url('%s') format('woff2');"
    " font-weight: 400; font-display: swap; }"
) % (uri('fonts/archivo-var.woff2', 'font/woff2'),
     uri('fonts/felix-titling.woff2', 'font/woff2'))

html = (SRC.read_text()
        .replace('/*FONTS*/', fonts)
        .replace('IMG_Z', uri('img/z-mark.png', 'image/png'))
        .replace('/*CELLS*/', (S / 'js' / 'cells.js').read_text()))

OUT.write_text(html)
print(f'wrote {OUT} ({len(html.encode()) / 1024:.0f} KB)')
left = re.findall(r'(?:src|href)="(?!data:|#|/#|https?:)([^"]+)"', html)
print('remaining external references:', sorted(set(left)) or 'none')
