"""Dựng toàn bộ asset Hừng Đông bằng bpy và xuất GLB.

Chạy:
  blender --background --python tools/blender/build_assets.py -- <thư mục GLB> <thư mục preview>

Quy ước: đơn vị mét, gốc tại chân/đáy, mặt trước hướng -Y (sang glTF là +Z).
"""
import math
import os
import random
import sys

import bpy
from mathutils import Vector, noise

argv = sys.argv[sys.argv.index('--') + 1:]
OUT = argv[0]
PREV = argv[1] if len(argv) > 1 else None
os.makedirs(OUT, exist_ok=True)
if PREV:
    os.makedirs(PREV, exist_ok=True)

# ---------------------------------------------------------------- vật liệu
MATS = {}


def hx(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple((x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def mat(name, color, rough=0.5, metal=0.0, emit=None, strength=0.0, alpha=1.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*hx(color), 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = (*hx(emit), 1)
        b.inputs['Emission Strength'].default_value = strength
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            m.blend_method = 'BLEND'
    MATS[name] = m
    return m


SUIT = lambda: mat('suit_white', '#ecebe6', 0.42, 0.0)
SUIT_SHADE = lambda: mat('suit_grey', '#b9bcc0', 0.5, 0.1)
JOINT = lambda: mat('joint_dark', '#2e3238', 0.55, 0.6)
GOLD = lambda: mat('visor_gold', '#e8b24a', 0.12, 0.75, '#7a4a00', 0.6)
ORANGE = lambda: mat('accent_orange', '#f2711c', 0.45, 0.0)
METAL = lambda: mat('metal', '#9aa3ad', 0.35, 0.85)
DARK = lambda: mat('graphite', '#555b64', 0.5, 0.35)
TEAL = lambda: mat('glow_teal', '#4ee6c0', 0.3, 0.0, '#4ee6c0', 6.0)
AMBER = lambda: mat('glow_amber', '#ffb454', 0.3, 0.0, '#ffb454', 5.0)
RED = lambda: mat('glow_red', '#ff4a3d', 0.3, 0.0, '#ff4a3d', 5.0)
GREEN = lambda: mat('glow_green', '#4cff8a', 0.3, 0.0, '#4cff8a', 4.0)

# ---------------------------------------------------------------- hình khối
P = []  # các object của asset đang dựng


def _active():
    return bpy.context.active_object


def finish(o, material, bevel=0.0, smooth=35, name=None):
    if name:
        o.name = name
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        m = o.modifiers.new('bev', 'BEVEL')
        m.width = bevel
        m.segments = 3
        m.limit_method = 'ANGLE'
        m.angle_limit = math.radians(30)
        bpy.ops.object.modifier_apply(modifier=m.name)
    if smooth:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth))
    o.data.materials.clear()
    o.data.materials.append(material)
    P.append(o)
    return o


def box(size, loc, material, bevel=0.02, rot=(0, 0, 0), name=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = _active()
    o.scale = size
    return finish(o, material, bevel, name=name)


def cyl(r, h, loc, material, rot=(0, 0, 0), verts=32, bevel=0.0, name=None, smooth=35):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h, location=loc, rotation=rot)
    return finish(_active(), material, bevel, name=name, smooth=smooth)


def cone(r1, r2, h, loc, material, rot=(0, 0, 0), verts=32, name=None):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=h, location=loc, rotation=rot)
    return finish(_active(), material, name=name)


def sph(r, loc, material, scale=(1, 1, 1), seg=32, name=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=max(8, seg // 2), radius=r, location=loc)
    o = _active()
    o.scale = scale
    return finish(o, material, 0, name=name, smooth=80)


def torus(R, r, loc, material, rot=(0, 0, 0), name=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=48, minor_segments=12,
                                     location=loc, rotation=rot)
    return finish(_active(), material, 0, name=name, smooth=80)


def strut(p1, p2, r, material, verts=12, name=None):
    p1, p2 = Vector(p1), Vector(p2)
    d = p2 - p1
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=d.length, location=(p1 + p2) / 2)
    o = _active()
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    return finish(o, material, 0, name=name)


def group(name, point, objs):
    """Gom các phần thành một khớp (Empty) để Three.js xoay quanh `point`."""
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.location = point
    bpy.context.view_layer.update()
    for o in objs:
        o.parent = e
        o.matrix_parent_inverse = e.matrix_world.inverted()
    P.append(e)
    return e


def pivot(o, point):
    """Đặt gốc của object tại `point` (không xoay) để quay quanh khớp."""
    off = Vector(point) - o.location
    o.data.transform(__import__('mathutils').Matrix.Translation(-off))
    o.location = point


# ---------------------------------------------------------------- xuất / preview
def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for me in list(bpy.data.meshes):
        if me.users == 0:
            bpy.data.meshes.remove(me)
    P.clear()


def setup_render():
    sc = bpy.context.scene
    for eng in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE', 'CYCLES'):
        try:
            sc.render.engine = eng
            break
        except Exception:
            continue
    if sc.render.engine == 'CYCLES':
        sc.cycles.samples = 24
        sc.cycles.device = 'CPU'
    sc.render.resolution_x = 560
    sc.render.resolution_y = 560
    w = bpy.data.worlds.new('w')
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.32, 0.35, 0.42, 1)
    bg.inputs[1].default_value = 1.0
    sc.world = w


def preview(name, cam, target):
    if not PREV:
        return
    sc = bpy.context.scene
    bpy.ops.object.light_add(type='SUN', location=(-6, -6, 10))
    sun = _active()
    sun.data.energy = 3.2
    sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
    bpy.ops.object.light_add(type='AREA', location=(5, -5, 3))
    fill = _active()
    fill.data.energy = 250
    fill.data.size = 4
    fill.rotation_euler = (math.radians(70), 0, math.radians(40))
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, -0.001))
    ground = _active()
    ground.data.materials.append(mat('prev_ground', '#8c8a85', 1.0))
    bpy.ops.object.camera_add(location=cam)
    c = _active()
    c.rotation_euler = (Vector(target) - Vector(cam)).to_track_quat('-Z', 'Y').to_euler()
    c.data.lens = 40
    sc.camera = c
    sc.render.filepath = os.path.join(PREV, name + '.png')
    bpy.ops.render.render(write_still=True)
    for o in (sun, fill, ground, c):
        bpy.data.objects.remove(o, do_unlink=True)


def export(name, cam=None, target=(0, 0, 0.8)):
    if cam:
        preview(name, cam, target)
    bpy.ops.object.select_all(action='DESELECT')
    for o in P:
        o.select_set(True)
    path = os.path.join(OUT, name + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True,
                              export_apply=True, export_yup=True)
    print('XUẤT', name, len(P), 'object', os.path.getsize(path) // 1024, 'KB')
    clear_scene()


# ================================================================ ASSET
def build_astronaut():
    s, g, j, d, o = SUIT(), SUIT_SHADE(), JOINT(), DARK(), ORANGE()
    for sx in (-1, 1):
        i0 = len(P)
        box((0.15, 0.3, 0.13), (sx * 0.11, -0.04, 0.065), d, 0.04)  # ủng
        cyl(0.085, 0.1, (sx * 0.11, 0, 0.17), j)  # cổ chân
        cyl(0.092, 0.34, (sx * 0.11, 0, 0.39), s, bevel=0)  # cẳng chân
        torus(0.092, 0.02, (sx * 0.11, 0, 0.56), j)  # đầu gối
        cyl(0.105, 0.34, (sx * 0.11, 0, 0.73), s)  # đùi
        cyl(0.108, 0.05, (sx * 0.11, 0, 0.36), o)  # vạch cam
        group('legL' if sx < 0 else 'legR', (sx * 0.11, 0, 0.88), P[i0:])
    box((0.4, 0.25, 0.2), (0, 0, 0.93), g, 0.07)  # hông
    box((0.46, 0.3, 0.5), (0, 0, 1.22), s, 0.1, name='torso')  # thân
    box((0.22, 0.05, 0.16), (0, -0.165, 1.27), d, 0.02)  # bảng điều khiển ngực
    for i, mt in enumerate((RED(), GREEN(), AMBER())):
        box((0.035, 0.02, 0.035), (-0.06 + i * 0.06, -0.195, 1.3), mt, 0.004)
    box((0.12, 0.02, 0.05), (0, -0.19, 1.22), TEAL(), 0.004)
    cyl(0.055, 0.015, (-0.14, -0.16, 1.4), o, rot=(math.radians(90), 0, 0))  # mảng nhiệm vụ
    # ba lô PLSS
    box((0.42, 0.22, 0.54), (0, 0.255, 1.24), s, 0.07, name='pack')
    box((0.3, 0.06, 0.2), (0, 0.38, 1.3), g, 0.02)
    for sx in (-1, 1):
        cyl(0.055, 0.42, (sx * 0.19, 0.34, 1.0), METAL())
        box((0.02, 0.1, 0.4), (sx * 0.05, 0.38, 1.25), d, 0.005)
    cyl(0.012, 0.28, (0.14, 0.3, 1.64), METAL())
    sph(0.025, (0.14, 0.3, 1.79), RED(), seg=12)
    strut((0.1, -0.1, 1.45), (0.2, 0.18, 1.1), 0.014, j)  # ống
    # cổ + mũ
    torus(0.15, 0.03, (0, 0, 1.5), METAL())
    sph(0.235, (0, 0, 1.68), s, name='helmet')
    sph(0.2, (0, -0.075, 1.68), GOLD(), scale=(1.0, 0.72, 0.86), name='visor')
    for sx in (-1, 1):
        cyl(0.07, 0.05, (sx * 0.225, 0, 1.68), j, rot=(0, math.radians(90), 0))
    box((0.1, 0.05, 0.04), (0, -0.2, 1.88), AMBER(), 0.008)
    # tay
    for sx in (-1, 1):
        i0 = len(P)
        sph(0.095, (sx * 0.28, 0, 1.4), g)
        cyl(0.068, 0.3, (sx * 0.31, -0.02, 1.2), s, rot=(math.radians(-8), 0, math.radians(sx * -4)))
        torus(0.066, 0.017, (sx * 0.325, -0.06, 1.03), j, rot=(math.radians(-8), 0, 0))
        cyl(0.06, 0.28, (sx * 0.335, -0.1, 0.88), s, rot=(math.radians(-14), 0, 0))
        cyl(0.064, 0.04, (sx * 0.335, -0.13, 0.76), o if sx > 0 else j, rot=(math.radians(-14), 0, 0))
        sph(0.075, (sx * 0.34, -0.15, 0.71), d, scale=(1, 1, 1.15))  # găng
        group('armL' if sx < 0 else 'armR', (sx * 0.28, 0, 1.38), P[i0:])
    export('astronaut', (1.9, -2.7, 1.5), (0, 0, 0.95))


def build_mica():
    w, g, d, t = SUIT(), SUIT_SHADE(), DARK(), TEAL()
    pearl = mat('mica_pearl', '#f3f6f8', 0.22, 0.15)
    # bánh xích
    for sx in (-1, 1):
        cyl(0.21, 0.15, (sx * 0.34, 0, 0.21), d, rot=(0, math.radians(90), 0), bevel=0.01)
        cyl(0.13, 0.17, (sx * 0.34, 0, 0.21), METAL(), rot=(0, math.radians(90), 0))
        cyl(0.04, 0.19, (sx * 0.34, 0, 0.21), t, rot=(0, math.radians(90), 0))
    box((0.7, 0.55, 0.14), (0, 0, 0.27), d, 0.04)
    cone(0.42, 0.3, 0.14, (0, 0, 0.4), g, verts=48)
    # thân
    cyl(0.3, 0.5, (0, 0, 0.78), pearl, verts=48, name='body')
    sph(0.3, (0, 0, 1.03), pearl, scale=(1, 1, 0.6))
    sph(0.3, (0, 0, 0.53), pearl, scale=(1, 1, 0.5))
    torus(0.302, 0.012, (0, 0, 0.62), d)
    torus(0.302, 0.012, (0, 0, 0.94), d)
    box((0.28, 0.03, 0.2), (0, -0.295, 0.78), d, 0.02)  # khung màn hình ngực
    box((0.24, 0.02, 0.15), (0, -0.312, 0.78), t, 0.01)
    for i, mt in enumerate((RED(), AMBER(), GREEN())):
        sph(0.018, (-0.07 + i * 0.07, -0.3, 0.64), mt, seg=10)
    # cổ + đầu
    cyl(0.1, 0.1, (0, 0, 1.15), d)
    sph(0.27, (0, 0, 1.38), pearl, name='head')
    sph(0.21, (0, -0.1, 1.38), mat('mica_glass', '#0a1015', 0.04, 0.4), scale=(1.0, 0.6, 0.8))
    torus(0.095, 0.013, (0, -0.285, 1.385), METAL(), rot=(math.radians(90), 0, 0))
    sph(0.075, (0, -0.265, 1.385), t, scale=(1, 0.5, 1), seg=24, name='eye')
    for sx in (-1, 1):
        cyl(0.085, 0.06, (sx * 0.265, 0, 1.38), g, rot=(0, math.radians(90), 0))
        cyl(0.05, 0.07, (sx * 0.27, 0, 1.38), t, rot=(0, math.radians(90), 0))
    cyl(0.012, 0.22, (0.1, 0.06, 1.72), METAL())
    sph(0.028, (0.1, 0.06, 1.84), RED(), seg=12)
    # tay (khớp vai là gốc xoay)
    for sx, nm in ((-1, 'armL'), (1, 'armR')):
        sh = (sx * 0.37, 0, 0.9)
        sph(0.095, sh, d)
        arm = cyl(0.052, 0.44, (sx * 0.4, 0, 0.66), g, name=nm)
        pivot(arm, sh)
        arm.name = nm
        P.append(arm) if arm not in P else None
        sph(0.06, (sx * 0.4, 0, 0.44), d)
        for k in (-1, 1):
            box((0.02, 0.04, 0.12), (sx * 0.4 + k * 0.035, -0.01, 0.37), METAL(), 0.005)
    # ngoài ra gắn phần tay mô phỏng
    export('mica', (1.8, -2.6, 1.5), (0, 0, 0.9))


def build_workshop():
    wall, dk, mt = mat('hab_white', '#e2e5e8', 0.45, 0.1), DARK(), METAL()
    blue = mat('hab_blue', '#2f6fb3', 0.4, 0.2)
    box((6.3, 5.3, 0.14), (0, 0, 0.07), mat('concrete', '#55595f', 0.9), 0.03)
    box((5.7, 4.7, 2.6), (0, 0, 1.44), wall, 0.14, name='hab')
    # đường ghép tấm
    for x in (-1.9, -0.65, 0.65, 1.9):
        box((0.025, 0.02, 2.3), (x, -2.36, 1.44), dk, 0.003)
    for z in (0.6, 2.3):
        box((5.4, 0.02, 0.025), (0, -2.36, z), dk, 0.003)
    # mái
    box((5.8, 4.8, 0.12), (0, 0, 2.8), mat('roof', '#8e959d', 0.5, 0.5), 0.04)
    for sx in (-1.2, 1.2):
        box((0.9, 0.7, 0.4), (sx, 1.1, 3.06), dk, 0.06)  # tổ máy lạnh
        cyl(0.3, 0.05, (sx, 1.1, 3.28), mt)
    for sx in (-1.5, 0.2):  # pin mặt trời
        panel = box((2.0, 1.5, 0.05), (sx, -0.7, 3.25), mat('solar', '#17243f', 0.25, 0.7), 0.01, rot=(math.radians(-18), 0, 0))
        for k in range(1, 5):
            box((0.012, 1.5, 0.056), (sx - 1.0 + k * 0.4, -0.7, 3.25), mt, 0.002, rot=(math.radians(-18), 0, 0))
        strut((sx, -0.7, 2.86), (sx, -0.7, 3.2), 0.04, mt)
    cyl(0.05, 1.3, (-2.3, 1.7, 3.4), mt)  # cột ăng-ten
    sph(0.5, (-2.3, 1.7, 4.02), mat('dish', '#d8dde2', 0.3, 0.6), scale=(1, 1, 0.35))
    sph(0.04, (-2.3, 1.7, 4.2), RED(), seg=10)
    # cửa
    box((1.5, 0.12, 2.1), (0, -2.36, 1.2), dk, 0.03)
    box((1.2, 0.1, 1.9), (0, -2.41, 1.15), blue, 0.04)
    box((0.5, 0.04, 0.42), (0, -2.47, 1.6), mat('door_glass', '#bfe8ff', 0.1, 0.2, '#9fd9ff', 1.5), 0.01)
    box((0.12, 0.05, 0.3), (0.45, -2.47, 1.1), mt, 0.01)  # tay nắm
    box((4.6, 0.05, 0.08), (0, -2.4, 2.52), TEAL(), 0.01)  # dải đèn
    # cửa sổ hông
    for sx in (-1, 1):
        box((0.04, 1.1, 0.7), (sx * 2.86, 0, 1.7), mat('win', '#1a2630', 0.1, 0.6, '#58c7ff', 0.6), 0.02)
    # bậc thềm
    box((1.9, 0.6, 0.18), (0, -2.85, 0.19), mt, 0.03)
    box((1.9, 0.5, 0.18), (0, -2.55, 0.37), mt, 0.03)
    # sọc cảnh báo
    for i in range(11):
        box((0.28, 0.02, 0.2), (-2.5 + i * 0.5, -2.37, 0.3), mat('hazard_y' if i % 2 == 0 else 'hazard_k',
                                                              '#f5c518' if i % 2 == 0 else '#1b1b1b', 0.5), 0.005)
    # bình chứa phía sau
    for sx in (-1.3, 1.3):
        cyl(0.4, 1.8, (sx, 2.8, 0.55), mt, rot=(0, math.radians(90), 0), bevel=0.0)
        torus(0.4, 0.03, (sx - 0.5, 2.8, 0.55), dk, rot=(0, math.radians(90), 0))
        torus(0.4, 0.03, (sx + 0.5, 2.8, 0.55), dk, rot=(0, math.radians(90), 0))
    export('workshop', (7.5, -9, 5), (0, 0, 1.4))


def build_lander():
    gold = mat('foil', '#c9a24a', 0.28, 0.95)
    silver = mat('lander_silver', '#c9ced3', 0.35, 0.7)
    cyl(1.9, 1.4, (0, 0, 2.5), gold, verts=8, bevel=0.06, name='stage')
    cyl(1.95, 0.12, (0, 0, 3.22), METAL(), verts=8)
    cyl(1.3, 1.5, (0, 0, 4.0), silver, verts=8, bevel=0.05)
    cyl(1.1, 0.2, (0, 0, 4.85), DARK(), verts=8)
    sph(0.55, (0, 0, 5.05), mat('lander_dish', '#e6e9ec', 0.3, 0.5), scale=(1, 1, 0.4))
    for k in range(4):
        a = math.radians(k * 90 + 45)
        c, s = math.cos(a), math.sin(a)
        strut((c * 1.5, s * 1.5, 2.2), (c * 3.2, s * 3.2, 0.12), 0.09, METAL())
        strut((c * 1.2, s * 1.2, 3.0), (c * 2.5, s * 2.5, 0.9), 0.05, METAL())
        cyl(0.42, 0.08, (c * 3.2, s * 3.2, 0.05), METAL())
        # tấm tản nhiệt
        box((0.9, 0.05, 1.1), (c * 1.95, s * 1.95, 2.5), mat('foil_dark', '#7d6a35', 0.4, 0.9), 0.01,
            rot=(0, 0, a + math.radians(90)))
    # cửa sổ
    for sx in (-1, 1):
        box((0.3, 0.05, 0.4), (sx * 0.45, -1.28, 4.1), mat('lander_win', '#101820', 0.05, 0.5, '#58c7ff', 0.5), 0.01)
    cone(0.55, 0.2, 0.7, (0, 0, 1.45), DARK(), verts=24)
    # thang
    strut((0.8, -1.55, 3.0), (1.1, -3.0, 0.2), 0.03, METAL())
    strut((1.1, -1.55, 3.0), (1.4, -3.0, 0.2), 0.03, METAL())
    for k in range(7):
        t = k / 6
        box((0.4, 0.04, 0.04), (0.95 + 0.3 * t, -1.55 - 1.45 * t, 3.0 - 2.8 * t), METAL(), 0.005)
    export('lander', (9, -9, 5.5), (0, 0, 2.2))


def _crate(kind, color, glow):
    body, lid, trim = DARK(), mat('case_lid', '#5b616a', 0.5, 0.55), mat('case_trim', '#a3acb5', 0.35, 0.8)
    box((0.96, 0.96, 0.6), (0, 0, 0.38), body, 0.05, name='case')
    box((1.0, 1.0, 0.1), (0, 0, 0.72), lid, 0.04)
    for sx in (-1, 1):
        for sy in (-1, 1):
            box((0.12, 0.12, 0.7), (sx * 0.47, sy * 0.47, 0.4), trim, 0.02)
    box((1.01, 1.01, 0.1), (0, 0, 0.5), mat('band_' + kind, color, 0.4, 0.0, glow, 1.2), 0.005)
    for sx in (-1, 1):
        box((0.1, 0.05, 0.12), (sx * 0.22, -0.5, 0.62), trim, 0.01)  # chốt
    cyl(0.025, 0.4, (0, -0.52, 0.34), trim, rot=(0, math.radians(90), 0))  # tay cầm
    box((0.36, 0.015, 0.2), (0, -0.495, 0.25), mat('label', '#f0f2f4', 0.6), 0.004)
    return trim


def build_crate_logger():
    trim = _crate('logger', '#3b82f6', '#3b82f6')
    cyl(0.02, 0.35, (0.25, 0.1, 0.95), trim)
    sph(0.14, (0.25, 0.1, 1.15), METAL(), scale=(1, 1, 0.3))
    box((0.3, 0.2, 0.04), (-0.15, 0.0, 0.78), TEAL(), 0.005)
    export('crate_logger', (2.2, -2.7, 1.7), (0, 0, 0.45))


def build_crate_phantom():
    _crate('phantom', '#f59e0b', '#f59e0b')
    a = AMBER()
    sph(0.06, (0, 0, 0.9), a, seg=12)
    cyl(0.05, 0.2, (0, 0, 0.78), a)
    export('crate_phantom', (2.2, -2.7, 1.7), (0, 0, 0.45))


def build_crate_bonus():
    _crate('bonus', '#34d399', '#34d399')
    g = GREEN()
    box((0.3, 0.08, 0.04), (0, -0.0, 0.775), g, 0.005)
    box((0.08, 0.3, 0.04), (0, -0.0, 0.775), g, 0.005)
    export('crate_bonus', (2.2, -2.7, 1.7), (0, 0, 0.45))


def build_pedestal():
    base = mat('ped_base', '#3d4650', 0.45, 0.55)
    cyl(1.45, 0.12, (0, 0, 0.06), base, bevel=0.02, verts=48)
    cyl(1.25, 0.1, (0, 0, 0.17), DARK(), bevel=0.02, verts=48)
    cyl(1.1, 0.13, (0, 0, 0.285), base, bevel=0.02, verts=48, name='top')
    torus(1.0, 0.035, (0, 0, 0.352), AMBER())
    for k in range(12):
        a = math.radians(k * 30)
        box((0.18, 0.04, 0.012), (math.cos(a) * 1.3, math.sin(a) * 1.3, 0.225), AMBER(), 0.002, rot=(0, 0, a))
    for k in range(4):
        a = math.radians(k * 90 + 45)
        cyl(0.05, 0.28, (math.cos(a) * 1.32, math.sin(a) * 1.32, 0.26), METAL())
        sph(0.06, (math.cos(a) * 1.32, math.sin(a) * 1.32, 0.42), AMBER(), seg=12)
    export('pedestal', (3.2, -4.2, 2.6), (0, 0, 0.2))


def build_console():
    d = DARK()
    cyl(0.38, 0.14, (0, 0, 0.07), d, bevel=0.02)
    box((0.26, 0.22, 0.8), (0, 0.05, 0.5), METAL(), 0.03)
    tilt = (math.radians(-22), 0, 0)
    box((1.3, 0.09, 0.85), (0, 0, 1.2), d, 0.04, rot=tilt)
    box((1.18, 0.02, 0.72), (0, -0.05, 1.2), mat('screen', '#0b1d1a', 0.1, 0.0, '#2dd4a8', 2.2), 0.01, rot=tilt)
    for k in range(5):
        box((0.12, 0.012, 0.02), (-0.35 + k * 0.17, -0.062, 1.32 - 0.02 * (k % 2)), TEAL(), 0.002, rot=tilt)
    for k, mt in enumerate((RED(), AMBER(), GREEN())):
        sph(0.03, (-0.5 + k * 0.09, -0.07, 0.9), mt, seg=10)
    box((0.9, 0.3, 0.06), (0, -0.2, 0.86), d, 0.02, rot=(math.radians(-10), 0, 0))
    export('console', (2.6, -3.4, 1.9), (0, 0, 0.95))


def build_phantom():
    sk = mat('phantom_skin', '#e8c6aa', 0.55, 0.0)
    jt = mat('phantom_joint', '#b08f78', 0.5, 0.2)
    for sx in (-1, 1):
        cyl(0.075, 0.42, (sx * 0.085, 0, 0.21), sk)
        sph(0.08, (sx * 0.085, 0, 0.44), jt)
        cyl(0.09, 0.42, (sx * 0.085, 0, 0.68), sk)
        box((0.12, 0.22, 0.06), (sx * 0.085, -0.04, 0.03), jt, 0.02)
        sph(0.07, (sx * 0.22, 0, 1.4), jt)
        cyl(0.05, 0.32, (sx * 0.24, 0, 1.2), sk)
        sph(0.045, (sx * 0.24, 0, 1.03), jt)
        cyl(0.042, 0.3, (sx * 0.245, 0, 0.88), sk)
        sph(0.05, (sx * 0.245, 0, 0.7), jt)
    box((0.34, 0.2, 0.18), (0, 0, 0.93), jt, 0.05)
    box((0.36, 0.22, 0.52), (0, 0, 1.2), sk, 0.08, name='torso')
    cyl(0.055, 0.1, (0, 0, 1.5), jt)
    sph(0.12, (0, 0, 1.64), sk, scale=(0.9, 1.0, 1.1), name='head')
    export('phantom', (2.0, -3.0, 1.5), (0, 0, 0.9))


def build_rocks():
    for i, (sub, flat, sharp, sq) in enumerate(((3, False, 0.55, 0.75), (2, True, 0.7, 0.7),
                                                 (2, True, 0.6, 0.8), (3, False, 0.45, 0.55))):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=1.0, location=(0, 0, 0))
        o = _active()
        o.name = f'rock{i}'
        off = Vector((i * 7.3, i * 3.1, i * 5.7))
        for v in o.data.vertices:
            n = noise.fractal(v.co * 1.4 + off, 1.0, 2.0, 5, noise_basis='PERLIN_ORIGINAL')
            v.co *= 1.0 + sharp * n
            v.co.z *= sq
            if v.co.z < -0.25:
                v.co.z = -0.25 + (v.co.z + 0.25) * 0.15
        zmin = min(v.co.z for v in o.data.vertices)
        for v in o.data.vertices:
            v.co.z -= zmin + 0.04
        o.data.update()
        col = ('#6e6c68', '#5d5b57', '#77746e', '#68645e')[i]
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.shade_flat() if flat else bpy.ops.object.shade_smooth()
        o.data.materials.append(mat(f'rock_mat{i}', col, 1.0, 0.0))
        P.append(o)
        o.location.x = 0
        export(f'rock{i}', (3.0, -3.4, 1.8), (0, 0, 0.4)) if i == 0 else None
        if i != 0:
            export(f'rock{i}', (3.0, -3.4, 1.8) if i == 1 else None, (0, 0, 0.4))


if __name__ == '__main__':
    clear_scene()
    setup_render()
    build_astronaut()
    build_mica()
    build_workshop()
    build_lander()
    build_crate_logger()
    build_crate_phantom()
    build_crate_bonus()
    build_pedestal()
    build_console()
    build_phantom()
    build_rocks()
    print('HOÀN TẤT')
