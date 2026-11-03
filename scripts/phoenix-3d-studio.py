#!/usr/bin/env python3
"""Render a validated PHOENIX scene with Blender, not a fake high-quality preview.

Usage: blender --background --python scripts/phoenix-3d-studio.py -- --input scene.scene3d.json --output render_dir
No external scripts/assets/URLs are executed or fetched. Detailed mesh input improves fidelity.
"""
import argparse
import json
import math
import sys
from pathlib import Path

# Blender's bundled Python provides bpy and mathutils; it is not a pip dependency.
import bpy
from mathutils import Euler, Matrix, Vector

CONVERSION = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
MAX_NODES = 150
MAX_VALUES = 180_000


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description="PHOENIX 3D Studio offline Blender renderer")
    parser.add_argument("--input", type=Path,
                        help="Optional portable PHOENIX JSON; use local --asset-glb for asset-only scenes")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--resolution", type=int, default=1280)
    parser.add_argument("--samples", type=int, default=64)
    parser.add_argument("--animation-preview", action="store_true",
                        help="Render bounded MP4 preview if the scene includes animation")
    parser.add_argument("--asset-glb", action="append", type=Path, default=[],
                        help="Optional locally supplied detailed model (repeatable)")
    return parser.parse_args(argv)


def valid_vec(value, lower=-300, upper=300):
    return (isinstance(value, list) and len(value) == 3
            and all(type(v) in (float, int) and math.isfinite(v)
                    and lower <= v <= upper for v in value))


def load_scene(filename, allow_empty=False):
    if filename.stat().st_size > 14_000_000:
        raise ValueError("Scene exceeds 14 MB studio input budget")
    scene = json.loads(filename.read_text(encoding="utf-8"))
    nodes = scene.get("nodes")
    if not isinstance(nodes, list) or len(nodes) > MAX_NODES or (not nodes and not allow_empty):
        raise ValueError("Scene needs between 1 and 150 nodes")
    total = 0
    for node in nodes:
        if not isinstance(node, dict) or node.get("type") not in ("box", "sphere", "cylinder", "cone", "torus", "mesh"):
            raise ValueError("Unsupported node type")
        if not valid_vec(node.get("position")) or not valid_vec(node.get("size"), .001, 300):
            raise ValueError("Invalid position/size")
        if "rotation" in node and not valid_vec(node["rotation"], -360, 360):
            raise ValueError("Invalid rotation")
        if node["type"] == "mesh":
            vertices = node.get("vertices")
            if not isinstance(vertices, list) or not 9 <= len(vertices) <= MAX_VALUES or len(vertices) % 9:
                raise ValueError("Invalid triangle mesh")
            if not all(type(v) in (float, int) and math.isfinite(v) and abs(v) <= 10_000 for v in vertices):
                raise ValueError("Mesh includes non-finite or excessive coordinates")
            total += len(vertices)
        if not isinstance(node.get("color"), str) or len(node["color"]) != 7:
            raise ValueError("Invalid hex color")
        try:
            int(node["color"][1:], 16)
        except ValueError as exc:
            raise ValueError("Invalid hex color") from exc
    if total > MAX_VALUES:
        raise ValueError("Scene exceeds vertex budget")
    return scene


def color(hex_color):
    components = [int(hex_color[i:i + 2], 16) / 255.0 for i in (1, 3, 5)]
    return (*components, 1.0)


def material(node):
    options = node.get("material") or {}
    rgba = color(options.get("baseColor", node["color"]))
    mat = bpy.data.materials.new(name="PHOENIX / " + str(node.get("name", node["type"]))[:40])
    mat.diffuse_color = rgba
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    if shader:
        shader.inputs["Base Color"].default_value = rgba
        shader.inputs["Metallic"].default_value = max(0, min(1, float(options.get("metallic", 0))))
        shader.inputs["Roughness"].default_value = max(.02, min(1, float(options.get("roughness", .5))))
        if "Alpha" in shader.inputs:
            shader.inputs["Alpha"].default_value = max(0, min(1, float(options.get("opacity", 1))))
        transmission = shader.inputs.get("Transmission Weight")
        if transmission is not None:
            transmission.default_value = max(0, min(1, float(options.get("transmission", 0))))
        coat = shader.inputs.get("Coat Weight")
        if coat is not None:
            coat.default_value = max(0, min(1, float(options.get("clearcoat", 0))))
    return mat


def make_node(node):
    kind = node["type"]
    if kind == "box":
        bpy.ops.mesh.primitive_cube_add(size=1)
    elif kind == "sphere":
        bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=.5)
    elif kind == "cylinder":
        bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=.5, depth=1)
    elif kind == "cone":
        bpy.ops.mesh.primitive_cone_add(vertices=48, radius1=.5, radius2=0, depth=1)
    elif kind == "torus":
        bpy.ops.mesh.primitive_torus_add(major_segments=64, minor_segments=16,
                                          location=(0, 0, 0), major_radius=.41, minor_radius=.09)
    else:
        coordinates = node["vertices"]
        verts = [coordinates[i:i + 3] for i in range(0, len(coordinates), 3)]
        mesh = bpy.data.meshes.new("PHOENIX triangle mesh")
        mesh.from_pydata(verts, [], [(i, i + 1, i + 2) for i in range(0, len(verts), 3)])
        mesh.update()
        obj = bpy.data.objects.new(node.get("name", "PHOENIX mesh"), mesh)
        bpy.context.collection.objects.link(obj)
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
    obj = bpy.context.view_layer.objects.active
    obj.name = str(node.get("name", kind))[:63]
    obj.data.materials.append(material(node))
    # Blender's cylinder and torus start Z-up. PHOENIX's primitives use Y-up.
    local = (Matrix.Rotation(math.pi / 2, 4, "X")
             if kind in ("cylinder", "cone", "torus") else Matrix.Identity(4))
    transform = Matrix.Translation(Vector(node["position"])) @ (
        Euler(tuple(math.radians(v) for v in node.get("rotation", [0, 0, 0])), "XYZ").to_matrix().to_4x4()
    ) @ Matrix.Diagonal((*node["size"], 1.0)) @ local
    obj.matrix_world = CONVERSION @ transform
    for face in obj.data.polygons:
        face.use_smooth = kind in ("sphere", "cylinder", "cone", "torus")
    return obj


def point_camera(camera, target):
    direction = Vector(target) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def lights_and_camera(objects):
    from mathutils import Vector
    bpy.context.view_layer.update()
    corners = [obj.matrix_world @ Vector(corner)
               for obj in objects
               for corner in obj.bound_box]
    lo = Vector(tuple(min(p[i] for p in corners) for i in range(3)))
    hi = Vector(tuple(max(p[i] for p in corners) for i in range(3)))
    center = (lo + hi) / 2
    radius = max((hi - lo).length / 2, 1.0)
    bpy.ops.object.camera_add(location=center + Vector((radius * 1.8, -radius * 2.5, radius * 1.4)))
    camera = bpy.context.object
    point_camera(camera, center)
    camera.data.type = "PERSP"
    camera.data.lens = 42
    bpy.context.scene.camera = camera
    for name, offset, energy, size in (
        ("Key", (1.5, -2.5, 3), 950, 5),
        ("Fill", (-2.5, 1.2, 2), 500, 6),
        ("Rim", (0, 2.4, 3), 800, 4),
    ):
        bpy.ops.object.light_add(type="AREA", location=center + Vector(offset) * radius)
        light = bpy.context.object
        light.name = "PHOENIX " + name
        light.data.energy = energy * radius
        light.data.shape = "DISK"
        light.data.size = size * radius
        point_camera(light, center)


def animate(scene, objects):
    clips = scene.get("animations") or []
    if not clips:
        return
    # Explicitly the first clip is rendered; the .blend file preserves its action.
    clip = clips[0]
    fps = 30
    if not isinstance(clip.get("duration"), (int, float)) or not 0 < clip["duration"] <= 120:
        raise ValueError("Invalid animation duration")
    bpy.context.scene.render.fps = fps
    bpy.context.scene.frame_end = math.ceil(clip["duration"] * fps)
    by_name = {}
    for node, obj in zip(scene["nodes"], objects):
        if node.get("name"):
            if node["name"] in by_name:
                by_name[node["name"]] = None
            else:
                by_name[node["name"]] = obj
    for track in clip.get("tracks", []):
        obj = by_name.get(track.get("node"))
        if obj is None:
            raise ValueError("Animation target missing or ambiguous")
        keyname = track.get("property")
        if keyname not in ("position", "rotation", "size"):
            raise ValueError("Unsupported animation channel")
        for key in track.get("keys", []):
            if not 0 <= key["time"] <= clip["duration"] or not valid_vec(key["value"], -360, 360):
                raise ValueError("Invalid animation key")
            frame = 1 + round(key["time"] * fps)
            if keyname == "position":
                obj.location = CONVERSION.to_3x3() @ Vector(key["value"])
                obj.keyframe_insert(data_path="location", frame=frame)
            elif keyname == "rotation":
                obj.rotation_euler = Euler(tuple(math.radians(v) for v in key["value"]), "XYZ")
                obj.keyframe_insert(data_path="rotation_euler", frame=frame)
            else:
                obj.scale = Vector(key["value"])
                obj.keyframe_insert(data_path="scale", frame=frame)
    bpy.context.scene.frame_set(1)


def run():
    args = parse_args()
    if not 256 <= args.resolution <= 4096 or not 8 <= args.samples <= 1024:
        raise ValueError("Resolution or samples out of bounds")
    if args.input is None and not args.asset_glb:
        raise ValueError("Provide a PHOENIX JSON scene or at least one --asset-glb")
    scene = (load_scene(args.input.resolve(), allow_empty=bool(args.asset_glb))
             if args.input is not None else {"nodes": [], "background": "#f5f5f5"})
    target = args.output.resolve()
    target.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    objects = [make_node(node) for node in scene["nodes"]]
    # High-detail source models may include meshes, armatures and existing animation.
    # Import only explicitly supplied local GLB files; never fetch arbitrary URLs.
    for asset_path in args.asset_glb:
        asset = asset_path.resolve()
        if asset.suffix.lower() != ".glb" or not asset.is_file() or asset.stat().st_size > 500_000_000:
            raise ValueError("Only local GLB models of at most 500 MB are permitted")
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(asset))
        objects.extend(obj for obj in bpy.data.objects if obj not in before and obj.type == "MESH")
    if not objects:
        raise ValueError("No renderable mesh geometry was found in the scene or GLB assets")
    lights_and_camera(objects)
    animate(scene, objects)
    ctx = bpy.context.scene
    ctx.render.engine = "CYCLES"
    ctx.cycles.samples = args.samples
    ctx.render.resolution_x = args.resolution
    ctx.render.resolution_y = args.resolution
    ctx.render.resolution_percentage = 100
    ctx.render.image_settings.file_format = "PNG"
    ctx.render.filepath = str(target / "render.png")
    ctx.world.color = color(scene.get("background", "#f5f5f5"))[:3]
    bpy.ops.wm.save_as_mainfile(filepath=str(target / "scene.blend"))
    bpy.ops.wm.gltf_export(filepath=str(target / "scene.glb"), export_format="GLB",
                           export_animations=bool(scene.get("animations") or args.asset_glb))
    bpy.ops.render.render(write_still=True)
    if args.animation_preview:
        # Animation preview is optional: rigged GLB assets can include their own actions.
        has_motion = bool(scene.get("animations") or args.asset_glb)
        if not has_motion:
            raise ValueError("No animated content supplied for --animation-preview")
        ctx.render.resolution_x = min(args.resolution, 960)
        ctx.render.resolution_y = min(args.resolution, 960)
        ctx.render.image_settings.file_format = "FFMPEG"
        ctx.render.ffmpeg.format = "MPEG4"
        ctx.render.ffmpeg.codec = "H264"
        ctx.render.filepath = str(target / "animation.mp4")
        ctx.frame_end = min(ctx.frame_end, 3600)
        bpy.ops.render.render(animation=True)
    print("PHOENIX_3D_STUDIO_OUTPUT=" + str(target))


if __name__ == "__main__":
    run()
