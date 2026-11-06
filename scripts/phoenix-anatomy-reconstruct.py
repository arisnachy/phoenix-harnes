#!/usr/bin/env python3
"""Research-only patient-specific CT/MR mask -> 3D GLB pipeline.

Input: local DICOM directory or NIfTI, NEVER an ECG/radiograph alone.
Uses TotalSegmentator task supported by the installed version; applies the
NIfTI affine to mesh coordinates. All generated masks REQUIRE expert review.
No clinical claim, no patient record write, and no remote upload by PHOENIX.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

SUPPORTED = {"ct": "total", "mr": "total_mr"}


def parser():
    p = argparse.ArgumentParser(description="PHOENIX anatomical twin prototype (research only)")
    p.add_argument("--input", required=True, help="Local volumetric DICOM folder or NIfTI input")
    p.add_argument("--output", required=True, help="Private output directory, separate from input")
    p.add_argument("--modality", choices=tuple(SUPPORTED), required=True)
    p.add_argument("--structures", nargs="*", help="Optional TotalSegmentator ROI class names")
    p.add_argument("--device", choices=("cpu", "gpu", "mps"), default="cpu")
    p.add_argument("--fast", action="store_true", help="Lower-resolution research segmentation")
    p.add_argument("--max-meshes", type=int, default=200, help="Upper limit for GLB meshes")
    p.add_argument("--research-only", action="store_true", required=True,
                   help="Explicit acknowledgement: experimental, not for diagnosis")
    return p


def nifti_mask_to_mesh(mask_path):
    import nibabel as nib
    import numpy as np
    import trimesh
    from skimage.measure import marching_cubes

    img = nib.load(str(mask_path))
    if len(img.shape) != 3:
        raise ValueError("3D mask required")
    if not np.isfinite(img.affine).all() or abs(float(np.linalg.det(img.affine[:3, :3]))) < 1e-9:
        raise ValueError("Invalid voxel-to-world geometry")
    voxels = np.asarray(img.dataobj) > 0
    count = int(np.count_nonzero(voxels))
    if count < 64:
        raise ValueError("Too few segmented voxels; no reliable surface")
    verts, faces, _, _ = marching_cubes(voxels.astype(np.uint8), level=0.5,
                                         allow_degenerate=False)
    world = nib.affines.apply_affine(img.affine, verts).astype("float32")
    if not np.isfinite(world).all() or len(faces) < 8:
        raise ValueError("Invalid or degenerate surface")
    mesh = trimesh.Trimesh(vertices=world, faces=faces, process=False)
    mesh.fix_normals()
    return mesh, count


def reconstruct(args):
    import trimesh

    source = Path(args.input).expanduser().resolve(strict=True)
    target = Path(args.output).expanduser().resolve()
    if not source.is_dir() and not (source.name.endswith(".nii.gz") or source.suffix == ".nii"):
        raise ValueError("Input must be a DICOM directory or 3D NIfTI file")
    if source == target or source in target.parents or target in source.parents:
        raise ValueError("Input and output must be separate directories")
    if args.max_meshes < 1 or args.max_meshes > 500:
        raise ValueError("--max-meshes must be 1 to 500")
    if args.structures is not None and len(args.structures) == 0:
        raise ValueError("--structures requires at least one class")
    # PHI-adjacent geometry must never land in a world-readable output folder.
    os.umask(0o077)
    target.mkdir(mode=0o700, parents=True, exist_ok=True)
    masks = target / "masks"
    masks.mkdir(mode=0o700, exist_ok=True)

    # TotalSegmentator defaults to anonymous usage telemetry; suppress it for
    # locally processed medical studies before invoking its Python API.
    # Model weights may still be fetched from the upstream model registry.
    store = target / "totalseg-config"
    store.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.environ["TOTALSEG_HOME_DIR"] = str(store)
    from totalsegmentator.config import setup_totalseg, set_config_key
    setup_totalseg()
    set_config_key("send_usage_stats", False)
    from totalsegmentator.python_api import totalsegmentator

    totalsegmentator(
        input=source, output=masks, task=SUPPORTED[args.modality],
        roi_subset=args.structures or None, fast=args.fast, device=args.device,
        quiet=True, output_type="nifti",
    )
    candidates = sorted(masks.glob("*.nii.gz"))
    if not candidates:
        raise RuntimeError("No segmentation masks created")
    if len(candidates) > args.max_meshes:
        raise RuntimeError("Too many structures; select ROI or increase --max-meshes explicitly")

    scene = trimesh.Scene()
    quality = []
    for mask in candidates:
        name = mask.name.removesuffix(".nii.gz")
        try:
            mesh, voxel_count = nifti_mask_to_mesh(mask)
            scene.add_geometry(mesh, geom_name=name, node_name=name)
            quality.append({"structure": name, "voxels": voxel_count, "triangles": len(mesh.faces),
                            "state": "unreviewed"})
        except ValueError as error:
            quality.append({"structure": name, "state": "rejected", "reason": str(error)})

    if not scene.geometry:
        raise RuntimeError("No valid meshes; check study resolution and segmentation")
    out = target / "anatomy.glb"
    staging = target / "anatomy.glb.partial"
    staging.write_bytes(scene.export(file_type="glb"))
    staging.replace(out)
    report = {
        "schema": 1, "generatedAt": datetime.now(timezone.utc).isoformat(),
        "model": "TotalSegmentator", "task": SUPPORTED[args.modality],
        "sourceType": "local volumetric imaging", "modality": args.modality,
        "coordinateSystem": "NIfTI affine world (RAS+, millimetres)",
        "geometrySource": "patient-study-derived segmentation; NOT confirmed anatomy",
        "clinicalStatus": "UNVALIDATED_RESEARCH_OUTPUT",
        "needsExpertReview": True,
        "modelWeightsMayDownload": True,
        "structures": quality,
        "limitations": [
            "Validate with source DICOM/NIfTI slices before clinical interpretation.",
            "No lesion, tumor, infarct, stenosis or nerve damage is diagnosed by this export.",
            "Some tasks/models require separate licensing; verify permitted usage.",
            "Images, masks, meshes and metadata must remain in approved clinical storage.",
        ],
    }
    summary = target / "anatomy-manifest.json"
    tmp = target / "anatomy-manifest.json.partial"
    tmp.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf8")
    tmp.replace(summary)
    print(json.dumps({"status": "research-mesh-generated", "meshCount": len(scene.geometry),
                      "glb": str(out), "manifest": str(summary),
                      "clinicallyValidated": False}, ensure_ascii=False))


def main():
    args = parser().parse_args()
    try:
        reconstruct(args)
    except Exception as error:
        # Avoid echoing potentially identifying DICOM filenames / paths.
        print(json.dumps({"status": "failed", "errorType": type(error).__name__,
                          "message": "Reconstruction failed; inspect input and local dependencies."}),
              file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
