"""Build an editable Blender project from the exported GLB.

Usage (Blender):   blender -b -P tools/blender/make_blend.py -- models/ferrari-f-future.glb models/ferrari-f-future.blend
Usage (bpy module): python tools/blender/make_blend.py models/ferrari-f-future.glb models/ferrari-f-future.blend

Creates collections per sub-assembly, a studio (cyclorama floor, softbox area
lights, neutral world), a camera matching the reference hero view, Cycles
settings, and keeps the glTF animations (doors, bonnet, engine cover, wing) as
Actions on the pivot empties.
"""
import sys, os, math
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
glb = os.path.abspath(argv[0] if argv else 'models/ferrari-f-future.glb')
out = os.path.abspath(argv[1] if len(argv) > 1 else 'models/ferrari-f-future.blend')

bpy.ops.wm.read_factory_settings(use_empty=True)
try:
    bpy.ops.preferences.addon_enable(module='io_scene_gltf2')
except Exception:
    pass
bpy.ops.import_scene.gltf(filepath=glb, merge_vertices=False, import_shading='NORMALS')

scene = bpy.context.scene
root = bpy.data.objects.get('F-Future')

# --- collections per top-level assembly -------------------------------------------
def move_tree(obj, coll):
    for c in obj.users_collection:
        c.objects.unlink(obj)
    coll.objects.link(obj)
    for ch in obj.children:
        move_tree(ch, coll)

car_coll = bpy.data.collections.new('F-Future')
scene.collection.children.link(car_coll)
if root:
    for c in list(root.users_collection):
        c.objects.unlink(root)
    car_coll.objects.link(root)
    for child in list(root.children):
        sub = bpy.data.collections.new(child.name)
        car_coll.children.link(sub)
        move_tree(child, sub)

# --- studio -------------------------------------------------------------------------
studio = bpy.data.collections.new('Studio')
scene.collection.children.link(studio)

bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
floor = bpy.context.active_object
floor.name = 'Studio_Floor'
fm = bpy.data.materials.new('Studio_Floor')
fm.use_nodes = True
bsdf = fm.node_tree.nodes.get('Principled BSDF')
bsdf.inputs['Base Color'].default_value = (0.42, 0.44, 0.47, 1)
bsdf.inputs['Roughness'].default_value = 0.55
floor.data.materials.append(fm)
for c in list(floor.users_collection):
    c.objects.unlink(floor)
studio.objects.link(floor)

def area(name, loc, rot, size, energy, color=(1, 1, 1)):
    d = bpy.data.lights.new(name, 'AREA')
    d.shape = 'RECTANGLE'
    d.size, d.size_y = size
    d.energy = energy
    d.color = color
    o = bpy.data.objects.new(name, d)
    o.location = loc
    o.rotation_euler = rot
    studio.objects.link(o)
    return o

area('Softbox_Top', (0, 0, 7.5), (0, 0, 0), (9, 3.2), 1400)
area('Strip_Left', (0, 4.2, 4.2), (math.radians(-45), 0, 0), (10, 0.45), 500)
area('Strip_Right', (0, -4.2, 4.2), (math.radians(45), 0, 0), (10, 0.45), 500)
area('Front_Panel', (8, 0, 2.5), (0, math.radians(70), 0), (4, 2.2), 350, (0.96, 0.97, 1))
area('Rear_Panel', (-8, 0, 2.5), (0, math.radians(-70), 0), (4, 2.2), 350, (0.96, 0.97, 1))

world = bpy.data.worlds.new('Studio_World')
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get('Background')
bg.inputs['Color'].default_value = (0.55, 0.57, 0.6, 1)
bg.inputs['Strength'].default_value = 0.35

# camera matching the reference hero (front-left three-quarter); glTF +Z -> Blender -Y
cam_data = bpy.data.cameras.new('Hero_Camera')
cam_data.lens = 50
cam = bpy.data.objects.new('Hero_Camera', cam_data)
cam.location = (4.75, 3.55, 1.75)
studio.objects.link(cam)
target = Vector((0.35, 0.0, 0.45))
direction = target - cam.location
cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam

scene.render.engine = 'CYCLES'
scene.cycles.samples = 256
try:
    scene.cycles.use_denoising = True
except Exception:
    pass
scene.render.resolution_x = 2560
scene.render.resolution_y = 1440
scene.view_settings.view_transform = 'AgX' if 'AgX' in [i.identifier for i in scene.view_settings.bl_rna.properties['view_transform'].enum_items] else 'Filmic'
scene.frame_start, scene.frame_end = 1, 60

bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
print('saved', out, round(os.path.getsize(out) / 1e6, 1), 'MB')
print('objects', len(bpy.data.objects), 'materials', len(bpy.data.materials), 'actions', len(bpy.data.actions))
