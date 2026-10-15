import bpy, sys, math, mathutils
src, out, png = sys.argv[-3:]
for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.import_scene.gltf(filepath=src)
car = [o for o in bpy.context.scene.objects if o.type=='MESH'][0]
# real-world scale: ~4.75 m long; floor at z=0; centered
bb0=[car.matrix_world @ mathutils.Vector(c) for c in car.bound_box]; L0=max(max(v[1] for v in bb0)-min(v[1] for v in bb0), max(v[0] for v in bb0)-min(v[0] for v in bb0)); s = 4.35 / L0
car.scale = (s, s, s); bpy.context.view_layer.objects.active = car; car.select_set(True)
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
m = car.modifiers.new('dec', 'DECIMATE'); m.ratio = 0.16
bpy.ops.object.modifier_apply(modifier='dec')
bb=[car.matrix_world @ mathutils.Vector(c) for c in car.bound_box]
mn=[min(v[i] for v in bb) for i in range(3)]; mx=[max(v[i] for v in bb) for i in range(3)]
car.location = (-(mn[0]+mx[0])/2, -(mn[1]+mx[1])/2, -mn[2])
bpy.ops.object.transform_apply(location=True)
print('FACES', len(car.data.polygons), 'dims', [round(mx[i]-mn[i],3) for i in range(3)])
for img in bpy.data.images:
    if img.size[0] > 1024: img.scale(1024, 1024)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7, export_image_format='WEBP', export_image_quality=80)
