#!/usr/bin/env python3
"""Build the Castano pouch in Blender and path-trace it.

    python3 tools/render-bag.py --view threequarter --samples 96

This is the offline counterpart to viewer/castano-3d.html. Same measurements,
same flat label artwork; what it adds is the three things a real-time viewer
cannot do, and which were what made the viewer read as a smudge:

  hard folds     the gusset, the base and the seal are shaded as creases
                 instead of being averaged smooth across the bend
  occlusion      Cycles resolves it for free, so seams and the gap under the
                 label go dark by themselves rather than needing a baked map
  real light     a measured studio environment instead of four flat panels

Renders on the CPU. Minutes per frame, not seconds.
"""

import argparse
import math
import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "viewer" / "assets"
OUT = ROOT / "render"
HDRI = ROOT / "render" / "env" / "studio.hdr"

MM = 0.001
BAG = dict(
    width=135 * MM, height=245 * MM, depth=90 * MM,
    bottom_fold=45 * MM, top_seal=40 * MM,
    belly=0.038, corner_dip=6 * MM, fold_lean=4 * MM, crease=0.88,
)
LABEL = dict(
    front_w=76 * MM, front_h=82 * MM, front_v=0.42,
    back_w=82 * MM, back_h=99 * MM, back_v=0.40,
    zip_w=124 * MM, zip_h=16 * MM, zip_v=0.822,
    lift=0.4 * MM,
)
# Where the surface bends hard enough to be a fold rather than a curve.
SHARP_ANGLE = 34.0

VIEWS = {                       # azimuth, elevation, degrees
    "front": (0, 2), "threequarter": (34, 6), "side": (90, 2),
    "back": (180, 4), "hero": (26, 12),
}


# --------------------------------------------------------------------------
# the same surface as the viewer, so the two cannot drift apart
# --------------------------------------------------------------------------
def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def half_width(v):
    return BAG["width"] * 0.5 * (1 - 0.035 * smoothstep(0.86, 1, v))


def half_depth(v):
    t = min(1.0, max(0.0, (v - 0.58) / 0.39))
    collapse = (1 - t) ** 1.5 * 0.94 + 0.06
    bulge = 1 + BAG["belly"] * math.sin(math.pi * min(1.0, max(0.0, (v - 0.04) / 0.62)))
    return BAG["depth"] * 0.5 * collapse * bulge


def surface(u, v):
    phi = u * math.tau
    c, s = math.cos(phi), math.sin(phi)
    fold_v = BAG["bottom_fold"] / BAG["height"]
    rectness = 1 - smoothstep(0, fold_v * 1.7, v)

    n = 0.48
    xr = math.copysign(abs(c) ** n, c)
    zr = math.copysign(abs(s) ** n, s)
    g = BAG["crease"]
    xl, zl = c, s * abs(s) ** g

    x = (xl + (xr - xl) * rectness) * half_width(v)
    z = (zl + (zr - zl) * rectness) * half_depth(v)
    edge = abs(c) ** 14
    y = v * BAG["height"] - edge * BAG["corner_dip"] * smoothstep(0.86, 1, v)
    lean = BAG["fold_lean"] * smoothstep(0.62, 0.95, v)
    return x, y, z + lean


def arc_table(v, steps=720):
    us, ls, total = [0.0], [0.0], 0.0
    px, _, pz = surface(0, v)
    for i in range(1, steps + 1):
        u = i / steps
        x, _, z = surface(u, v)
        total += math.hypot(x - px, z - pz)
        us.append(u); ls.append(total)
        px, pz = x, z
    return us, ls, total


def u_at_arc(tab, length):
    us, ls, total = tab
    L = length % total
    i = 1
    while i < len(ls) and ls[i] < L:
        i += 1
    a, b = ls[i - 1], ls[i]
    t = (L - a) / (b - a) if b > a else 0
    return us[i - 1] + (us[i] - us[i - 1]) * t


# --------------------------------------------------------------------------
def build(nu, nv):
    """Body plus base cap, as one mesh."""
    verts, faces = [], []
    for j in range(nv + 1):
        v = j / nv
        for i in range(nu):
            verts.append(surface(i / nu, v))
    for j in range(nv):
        for i in range(nu):
            a = j * nu + i
            b = j * nu + (i + 1) % nu
            faces.append((a, b, b + nu, a + nu))
    centre = len(verts)
    verts.append((0.0, 0.0, 0.0))
    for i in range(nu):
        faces.append((centre, (i + 1) % nu, i))
    return verts, faces


def decal(u_centre, width, v_centre, v_half, n=34):
    tab = arc_table(v_centre)
    centre_arc = tab[1][round(u_centre * 720)]
    verts, faces, uvs = [], [], []
    for j in range(n + 1):
        tv = j / n
        v = v_centre - v_half + 2 * v_half * tv
        for i in range(n + 1):
            tu = i / n
            u = u_at_arc(tab, centre_arc - width / 2 + width * tu) % 1.0
            x, y, z = surface(u, v)
            # outward normal by finite difference across the cross-section
            x1, _, z1 = surface((u + 1e-4) % 1, v)
            dx, dz = x1 - x, z1 - z
            L = math.hypot(dx, dz) or 1
            nx, nz = dz / L, -dx / L
            verts.append((x + nx * LABEL["lift"], y, z + nz * LABEL["lift"]))
            uvs.append((1 - tu, tv))
    for j in range(n):
        for i in range(n):
            a = j * (n + 1) + i
            faces.append((a, a + 1, a + n + 2, a + n + 1))
    return verts, faces, uvs


# --------------------------------------------------------------------------
def scene(args):
    import bpy
    from mathutils import Vector

    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = args.samples
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.02
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 6
    sc.render.resolution_x = args.width
    sc.render.resolution_y = args.height
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "Filmic" if args.filmic else "Standard"
    sc.view_settings.look = "None"

    def mesh_object(name, verts, faces, uvs=None):
        me = bpy.data.meshes.new(name)
        me.from_pydata(verts, [], faces)
        me.update()
        if uvs:
            layer = me.uv_layers.new(name="UVMap")
            for poly in me.polygons:
                for li in poly.loop_indices:
                    layer.data[li].uv = uvs[me.loops[li].vertex_index]
        ob = bpy.data.objects.new(name, me)
        bpy.context.collection.objects.link(ob)
        return ob

    # ---- body ----
    verts, faces = build(args.nu, args.nv)
    body = mesh_object("bag", verts, faces)
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    bpy.ops.object.shade_smooth()
    # The fold is where this matters: without an angle limit the normals are
    # averaged straight across the gusset and a crease reads as a curve.
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(SHARP_ANGLE))
    except Exception:
        me = body.data
        if hasattr(me, "use_auto_smooth"):
            me.use_auto_smooth = True
            me.auto_smooth_angle = math.radians(SHARP_ANGLE)

    film = bpy.data.materials.new("film")
    film.use_nodes = True
    bsdf = film.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.035, 0.035, 0.035, 1)
    bsdf.inputs["Roughness"].default_value = 0.62
    bsdf.inputs["Metallic"].default_value = 0.0
    body.data.materials.append(film)

    # ---- labels ----
    def label(name, png, orm, u_c, w, v_c, h):
        vs, fs, uv = decal(u_c, w, v_c, h / BAG["height"] / 2)
        ob = mesh_object(name, vs, fs, uv)
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.shade_smooth()

        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        nt = mat.node_tree
        p = nt.nodes["Principled BSDF"]
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(str(ASSETS / png))
        nt.links.new(p.inputs["Base Color"], tex.outputs["Color"])
        om = nt.nodes.new("ShaderNodeTexImage")
        om.image = bpy.data.images.load(str(ASSETS / orm))
        om.image.colorspace_settings.name = "Non-Color"
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(sep.inputs["Color"], om.outputs["Color"])
        nt.links.new(p.inputs["Roughness"], sep.outputs["Green"])
        nt.links.new(p.inputs["Metallic"], sep.outputs["Blue"])
        if "Alpha" in [i.name for i in p.inputs] and png == "zipper.png":
            nt.links.new(p.inputs["Alpha"], tex.outputs["Alpha"])
            mat.blend_method = "CLIP"
        ob.data.materials.append(mat)
        return ob

    label("label_front", "label-front.png", "label-front-orm.png",
          0.25, LABEL["front_w"], LABEL["front_v"], LABEL["front_h"])
    label("label_back", "label-back.png", "label-back-orm.png",
          0.75, LABEL["back_w"], LABEL["back_v"], LABEL["back_h"])
    label("zipper", "zipper.png", "zipper-orm.png",
          0.25, LABEL["zip_w"], LABEL["zip_v"], LABEL["zip_h"])

    # ---- a cyclorama, the way a product is actually shot ----
    bpy.ops.mesh.primitive_plane_add(size=4)
    floor = bpy.context.object
    sweep = bpy.data.materials.new("sweep")
    sweep.use_nodes = True
    sb = sweep.node_tree.nodes["Principled BSDF"]
    sb.inputs["Base Color"].default_value = (0.28, 0.29, 0.285, 1)
    sb.inputs["Roughness"].default_value = 0.55
    floor.data.materials.append(sweep)

    bpy.ops.mesh.primitive_plane_add(size=4)
    wall = bpy.context.object
    wall.rotation_euler = (math.radians(90), 0, 0)
    wall.location = (0, 1.1, 2)
    wall.data.materials.append(sweep)

    # ---- light ----
    world = bpy.data.worlds.new("world")
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    if HDRI.exists():
        env = world.node_tree.nodes.new("ShaderNodeTexEnvironment")
        env.image = bpy.data.images.load(str(HDRI))
        world.node_tree.links.new(bg.inputs["Color"], env.outputs["Color"])
        bg.inputs["Strength"].default_value = args.env
    else:
        bg.inputs["Color"].default_value = (0.05, 0.05, 0.05, 1)
        bg.inputs["Strength"].default_value = 1.0

    def area(name, loc, rot, size_x, size_y, power):
        d = bpy.data.lights.new(name, type="AREA")
        d.shape = "RECTANGLE"
        d.size, d.size_y = size_x, size_y
        d.energy = power
        ob = bpy.data.objects.new(name, d)
        ob.location = loc
        ob.rotation_euler = rot
        bpy.context.collection.objects.link(ob)
        return ob

    # narrow and strong draws the edge; broad and soft washes matte film flat
    area("key", (-0.62, -0.42, 0.34), (math.radians(64), 0, math.radians(-52)), 0.16, 0.85, 95)
    area("kick", (0.70, -0.16, 0.26), (math.radians(74), 0, math.radians(66)), 0.10, 0.70, 70)
    area("top", (0, 0.10, 0.85), (0, 0, 0), 1.1, 1.1, 40)

    # ---- camera ----
    az, el = VIEWS[args.view]
    dist = args.dist
    a, e = math.radians(az), math.radians(el)
    cam_d = bpy.data.cameras.new("cam")
    cam_d.lens = args.lens
    cam = bpy.data.objects.new("cam", cam_d)
    target = Vector((0, 0, BAG["height"] * 0.47))
    cam.location = (
        target.x + dist * math.cos(e) * math.sin(a),
        target.y - dist * math.cos(e) * math.cos(a),
        target.z + dist * math.sin(e),
    )
    direction = target - Vector(cam.location)
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(cam)
    sc.camera = cam

    OUT.mkdir(parents=True, exist_ok=True)
    sc.render.filepath = str(OUT / f"castano-{args.view}.png")
    sc.render.image_settings.file_format = "PNG"
    print(f"rendering {args.view} at {args.width}x{args.height}, {args.samples} samples, CPU")
    bpy.ops.render.render(write_still=True)
    print("wrote", sc.render.filepath)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--view", default="threequarter", choices=sorted(VIEWS))
    ap.add_argument("--samples", type=int, default=96)
    ap.add_argument("--width", type=int, default=1000)
    ap.add_argument("--height", type=int, default=1250)
    ap.add_argument("--nu", type=int, default=160)
    ap.add_argument("--nv", type=int, default=190)
    ap.add_argument("--dist", type=float, default=0.62)
    ap.add_argument("--lens", type=float, default=85.0)
    ap.add_argument("--env", type=float, default=0.55)
    ap.add_argument("--filmic", action="store_true")
    args = ap.parse_args()

    if not (ASSETS / "label-front.png").exists():
        subprocess.run([sys.executable, str(ROOT / "tools" / "make-labels.py")], check=True)
    scene(args)


if __name__ == "__main__":
    main()
