# PHOENIX 3D Studio: real production versus interactive previews

PHOENIX has two distinct execution paths. The built-in `phoenix_3d` tool creates
portable, interactive previews. Its geometry is **not** independently sculpted,
rigged, retopologized or checked for fidelity to a reference image.

For high-quality output, connect the official Blender Lab MCP integration
described in [README.md](README.md), or render an already-built PHOENIX
scene through the **offline, deterministic Blender Studio script**.

## Offline Blender pipeline

Requirements: Blender with its Python API, Cycles and glTF exporter. The
command below renders real scene geometry, writes a .blend project, a GLB model
and a PNG. It does **not** interpret a text prompt into new organic geometry;
the input must already contain mesh geometry, material definitions and/or
animated parts. Existing detailed assets are preferable for characters.

```bash
blender --background --python scripts/phoenix-3d-studio.py -- \
  --input my-scene.scene3d.json --output ./3d-output \
  --resolution 1280 --samples 64
```

Outputs:

- `3d-output/scene.blend`: editable Blender scene.
- `3d-output/scene.glb`: actual reusable mesh geometry, with the first
  supported animation clip when provided.
- `3d-output/render.png`: Cycles render, not a raster illustration
  standing in for a 3D model.

You may add one or more existing detailed GLB assets with `--asset-glb`:

```bash
blender --background --python scripts/phoenix-3d-studio.py -- \
  --input scene.scene3d.json --output ./3d-output \
  --asset-glb ./assets/character-rigged.glb
```

GLB assets are **local files** (no remote fetch). Imported detailed meshes,
materials and existing armatures can supplement the generated environment,
but their fidelity still depends on the original source quality.

The input is PHOENIX's exported `.scene3d.json`. The script limits the
number of objects, mesh coordinate values, and output resolution; it loads
no external scripts or remote URLs.

## Production workflow for the user's example categories

- **Animated characters or animals:** detailed base mesh, sculpting,
  retopology, armature/weights, hair, clothing, facial shapes and deformation
  tests. Use Blender Lab MCP to perform authoring steps; the offline renderer
  alone cannot synthesize anatomy or a rig.
- **Robots and vehicles:** articulated parts, hinges/joints, wheel alignment,
  proportions, movement constraints and well-defined materials.
- **Architecture and environments:** floor plans, scale, openings,
  architecture assets, interior and exterior props, landscaping and lighting.
- **Exact reconstruction:** source geometry or sufficient orthographic views,
  dimensions and tolerances. Never label one-photo inference as exact CAD/BIM.

For unattended production, the connected Blender MCP endpoint is optional
and explicitly enabled. Blender Lab can execute model-supplied Python;
run only in a dedicated trusted Blender workspace, not against sensitive
files. PHOENIX should describe a result as **preview** until it has actual
render/export output and relevant visual or dimensional quality assurance.

## Smoke test

The focused GitHub Actions 3D workflow checks TypeScript scene admission,
routing and the Python script's syntax. It does **not** run Blender's renderer:
a real Blender installation and visual review are required before calling
the exported scene production-ready.


## Universal composition: any imagined subject, not fixed categories

For scenes consisting of arbitrary objects, send a `compositionContract` in the
`phoenix_3d` tool call. Every mandatory element gets an `objectId`, whether
it is a fantasy creature, invented machine, science-fiction craft, building,
plant, wheel, garment or decorative prop. This is a **structural gate**, not
visual similarity verification.

```json
{
  "objects": [
    {"id": "creature", "minParts": 4, "animated": true},
    {"id": "vehicle", "minParts": 3},
    {"id": "terrain", "minParts": 1}
  ],
  "relations": [
    {"from": "creature", "to": "vehicle", "relation": "on", "tolerance": 0.3},
    {"from": "vehicle", "to": "terrain", "relation": "near"}
  ]
}
```

Supported relations include `above`, `below`, `on`, `inside`, `near`,
`attached`, `left-of`, `right-of`, `in-front-of` and `behind`.
The gate rejects missing parts, missing animation, insufficient explicitly
requested mesh triangles, and obviously inconsistent approximate bounding-box
relationships. Rotated geometry and real contact physics still require rendered
visual QA. A scene that passes this structural gate is **not automatically
photorealistic, physically plausible, or an exact reconstruction**.

### Detailed asset-only Studio rendering

When a high-poly character, rigged creature, vehicle or other real 3D asset
already exists, render it directly, without inserting a decorative cube:

```bash
blender --background --python scripts/phoenix-3d-studio.py -- \
  --asset-glb ./assets/character.glb --output ./3d-output \
  --resolution 1280 --samples 64 --animation-preview
```

The `--animation-preview` switch is optional and creates
`animation.mp4` if animation data is supplied; otherwise omit it for a still
render. This does not automatically synthesize a rig, text-to-3D mesh or exact
reconstruction. Professional generation still requires actual model-authoring
tools, art assets and validation.
