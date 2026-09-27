# Castano 3D viewer

`castano-3d.html` is one self-contained file. Build it, never edit it:

```
python3 tools/build-viewer.py
```

That draws the label textures (`tools/make-labels.py`) and inlines them into
`castano-3d.src.html`. Edit the source and the generator; the output is
disposable.

## Verify the SRI hash before this goes live

three.js is the only outside dependency. It is pinned:

```
https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.min.js
sha384-qOkzR5Ke/XkQxuGVJ9hpFEpDlcoLtWwVYhnJf06cLIZa2vaIptSqaubivErzmD5O
```

That hash was computed from the **npm tarball** of three 0.160.0, because
cdnjs is blocked by the network policy of the machine this was built on. cdnjs
mirrors the npm package, so the bytes should match — but "should" is not
"does", and a mismatch means the browser refuses the script and the viewer
shows its fallback instead of a bag. Check it once from any machine that can
reach the CDN:

```
curl -s https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.min.js \
  | openssl dgst -sha384 -binary | openssl base64 -A
```

If it differs, paste the new value into `THREE_SRI` in the source and rebuild.

0.160.0 is not an arbitrary pin: it is the last release that ships a classic
UMD build. From 0.169 three.js is ES-modules only, and an ES module imported
from inside another module is not covered by an `integrity` attribute.

## Embedding

Give the host element a height and drop the file in an iframe, or lift the
`#zuno3d` block and its script into your page. It fills its container.

Two APIs, for the embedding page:

```js
zunoViewerSetView(azimuthDegrees, polarDegrees, metresFromCentre)
zunoViewerAutoRotate(true | false)
```

**If you embed it on worldofzuno.com, the CSP in `site/_headers` will block
it.** `script-src` is `'self'` plus hashes; a CDN script is neither. Either add
the CDN origin to `script-src` for that path, or self-host three.js — and
self-hosting brings back most of the 627 KB that was deliberately removed from
the site. That is a decision, not a detail.

## The numbers

Everything dimensional is a commented constant at the top of the source:
`BAG` for the pouch, `LABEL` for the artwork placement, `MATERIAL` for the
finish, `CAM` for the framing. They are real millimetres.

`BAG` comes from measurements. `LABEL.frontWidth`, `frontHeight` and
`frontCentreV` were estimated off the photographs rather than measured off the
print, and are the constants most worth correcting if the artwork spec exists.

## What was measured

- SRI is present and enforced: a tampered file makes the viewer show its
  fallback and draw nothing.
- three.js is not requested at all while the viewer is out of view, and once
  when it scrolls in.
- At rest the renderer issues zero draw calls; it only draws when something
  moved.
- `prefers-reduced-motion` turns auto-rotate off.
- On a 390 px viewport with devicePixelRatio 3 the canvas is capped at 2x.
- Mesh is about 43k triangles on a desktop, about 19k on a phone.
