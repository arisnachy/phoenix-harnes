#!/usr/bin/env python3
"""Research-only patient-specific CT/MR mask -> 3D GLB pipeline.

Input: local DICOM directory or NIfTI, NEVER an ECG/radiograph alone.
Uses TotalSegmentator task supported by the installed version; applies the
NIfTI affine to mesh coordinates. All generated masks REQUIRE expert review.
No clinical claim, no patient record write, and no remote upload by PHOENIX.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from time import perf_counter
from datetime import datetime, timezone
from pathlib import Path

SUPPORTED = {"ct": "total", "mr": "total_mr"}


def parser():
    p = argparse.ArgumentParser(description="PHOENIX anatomical twin prototype (research only)")
    p.add_argument("--input", required=True, help="Local volumetric DICOM folder or NIfTI input")
    p.add_argument("--output", required=True, help="Private output directory, separate from input")
    p.add_argument("--modality", choices=tuple(SUPPORTED), required=True)
    p.add_argument("--task", help="Verified task ID from phoenix-anatomy-models.json")
    p.add_argument("--structures", nargs="*", help="Optional TotalSegmentator ROI class names")
    p.add_argument("--device", choices=("cpu", "gpu", "mps"), default="cpu")
    p.add_argument("--fast", action="store_true", help="Lower-resolution research segmentation")
    p.add_argument("--max-meshes", type=int, default=200, help="Upper limit for GLB meshes")
    p.add_argument("--mask-folder", help="Optional clinician-supplied 3D NIfTI organ masks")
    p.add_argument("--lesion-mask-folder", help="Clinician-supplied NIfTI affected-region masks aligned to anatomy; never automatic diagnosis")
    p.add_argument("--research-only", action="store_true", required=True,
                   help="Explicit acknowledgement: experimental, not for diagnosis")
    return p


def mask_files(folder):
    """Accept only flat, anonymous anatomical mask names. Never follow symbolic links."""
    result = []
    for path in folder.iterdir():
        if path.is_symlink():
            raise ValueError("Symbolic links are forbidden in anatomical masks")
        if path.is_file() and (path.name.endswith(".nii.gz") or path.name.endswith(".nii")):
            stem = path.name[:-7] if path.name.endswith(".nii.gz") else path.stem
            if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", stem):
                raise ValueError("Mask names must be short anonymous anatomical labels")
            result.append((stem, path))
    return sorted(result)


def image_grid(mask_path):
    """Read 3D image physical coordinates without accepting voxel-only assumptions."""
    import nibabel as nib
    import numpy as np
    img = nib.load(str(mask_path))
    if len(img.shape) != 3 or img.header.get_xyzt_units()[0] != "mm":
        raise ValueError("Only 3D masks with millimetre units may be combined")
    affine = np.asarray(img.affine, dtype=float)
    if not np.isfinite(affine).all() or abs(float(np.linalg.det(affine[:3, :3]))) < 1e-9:
        raise ValueError("Invalid physical coordinate transform")
    return img.shape, affine


def matching_grid(reference, candidate):
    """Reject unrelated study coordinates instead of visually faking lesion placement."""
    import numpy as np
    a_shape, a_affine = image_grid(reference)
    b_shape, b_affine = image_grid(candidate)
    if a_shape != b_shape or not np.allclose(a_affine, b_affine, rtol=0, atol=1e-3):
        raise ValueError("Affected-region mask does not align with anatomical mask grid")
    return True


def mask_digest(path):
    """SHA256 provenance fingerprint stored privately, without leaking source paths."""
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def nifti_mask_to_mesh(mask_path, step_size=1):
    """Crop to the labelled ROI and preserve the NIfTI affine and mm-scale geometry."""
    import nibabel as nib
    import numpy as np
    import trimesh
    from skimage.measure import marching_cubes

    if step_size not in (1, 2):
        raise ValueError("Mesh sampling step must be 1 or 2")
    img = nib.load(str(mask_path))
    if len(img.shape) != 3:
        raise ValueError("3D mask required")
    if not np.isfinite(img.affine).all() or abs(float(np.linalg.det(img.affine[:3, :3]))) < 1e-9:
        raise ValueError("Invalid voxel-to-world geometry")
    if img.header.get_xyzt_units()[0] != "mm":
        raise ValueError("NIfTI voxel-to-world length units must be millimetres")
    voxels = np.asarray(img.dataobj) > 0
    count = int(np.count_nonzero(voxels))
    if count < 64:
        raise ValueError("Too few segmented voxels; no reliable surface")
    slices = []
    for axis in range(3):
        coordinates = np.flatnonzero(np.any(voxels, axis=tuple(i for i in range(3) if i != axis)))
        slices.append(slice(max(0, int(coordinates[0]) - 1),
                            min(voxels.shape[axis], int(coordinates[-1]) + 2)))
    cropped = np.pad(voxels[tuple(slices)].astype(np.uint8), 1)
    verts, faces, _, _ = marching_cubes(cropped, level=0.5,
                                         step_size=step_size, allow_degenerate=False)
    verts += np.array([sl.start - 1 for sl in slices], dtype="float32")
    world = nib.affines.apply_affine(img.affine, verts).astype("float32")
    if not np.isfinite(world).all() or len(faces) < 8:
        raise ValueError("Invalid or degenerate surface")
    mesh = trimesh.Trimesh(vertices=world, faces=faces, process=False)
    mesh.fix_normals()
    volume_ml = count * abs(float(np.linalg.det(img.affine[:3, :3]))) / 1000.0
    return mesh, count, volume_ml

def reconstruct(args):
    import trimesh
    started = perf_counter()

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
    catalog = json.loads((Path(__file__).parent / "phoenix-anatomy-models.json").read_text(encoding="utf8"))
    default_id = "ct_general" if args.modality == "ct" else "mr_general"
    model_id = args.task or default_id
    selected = next((task for task in catalog["tasks"] if task["id"] == model_id), None)
    if selected is None or selected["modality"] != args.modality:
        raise ValueError("Invalid anatomy task ID for chosen modality")
    if selected["licensed"] not in ("Apache-2.0", "vendor-license-required"):
        raise ValueError("Task license status is not executable")
    # PHI-adjacent geometry must never land in a world-readable output folder.
    os.umask(0o077)
    target.mkdir(mode=0o700, parents=True, exist_ok=True)
    masks = target / "masks"
    external_masks = Path(args.mask_folder).expanduser().resolve(strict=True) if args.mask_folder else None
    if external_masks is None:
        masks.mkdir(mode=0o700, parents=True, exist_ok=True)
        # Reuse model weights without writing patient data into the shared cache.
        home = os.environ.get("PHOENIX_ANATOMY_HOME")
        if not home:
            local = os.environ.get("LOCALAPPDATA")
            home = str(Path(local) / "PHOENIX" / "anatomy" if local
                       else Path.home() / ".phoenix" / "anatomy")
        store = Path(os.environ.get("TOTALSEG_HOME_DIR") or
                     str(Path(home).expanduser().resolve() / "models")).expanduser().resolve()
        store.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.environ["TOTALSEG_HOME_DIR"] = str(store)
        from totalsegmentator.config import setup_totalseg, set_config_key, has_valid_license
        setup_totalseg()
        set_config_key("send_usage_stats", False)
        if selected["licensed"] == "vendor-license-required":
            # Only the vendor can validate a signed entitlement. This request
            # sends the configured license number, never any patient images.
            validation, _ = has_valid_license()
            if validation != "yes":
                raise ValueError("Official model license not valid or not configured")
        from totalsegmentator.python_api import totalsegmentator
        totalsegmentator(
            input=source, output=masks, task=selected["task"],
            roi_subset=args.structures or None, fast=args.fast, device=args.device,
            quiet=True, output_type="nifti",
        )
    else:
        if not external_masks.is_dir() or external_masks == target or target in external_masks.parents:
            raise ValueError("Mask source must be a separate directory")
        masks = external_masks
    candidates = mask_files(masks)
    if not candidates:
        raise RuntimeError("No segmentation masks created")
    if len(candidates) > args.max_meshes:
        raise RuntimeError("Too many structures; select ROI or increase --max-meshes explicitly")

    lesions = []
    if args.lesion_mask_folder:
        lesion_dir = Path(args.lesion_mask_folder).expanduser().resolve(strict=True)
        if not lesion_dir.is_dir() or lesion_dir == target or target in lesion_dir.parents:
            raise ValueError("Affected-region mask folder must be separate from output")
        if external_masks is not None and lesion_dir == external_masks:
            raise ValueError("Affected-region annotations require a separate directory")
        lesions = mask_files(lesion_dir)
        if not lesions:
            raise ValueError("Affected-region folder has no NIfTI annotations")
        if len(lesions) + len(candidates) > args.max_meshes:
            raise ValueError("Too many anatomy and affected-region layers")
        # Fail closed before writing a GLB if the annotation belongs to another grid.
        for _, lesion in lesions:
            matching_grid(candidates[0][1], lesion)

    scene = trimesh.Scene()
    quality = []
    step = 2 if args.fast else 1
    for name, mask in candidates:
        try:
            mesh, voxel_count, volume_ml = nifti_mask_to_mesh(mask, step_size=step)
            scene.add_geometry(mesh, geom_name=name, node_name=name)
            quality.append({"structure": name, "voxels": voxel_count,
                            "triangles": len(mesh.faces), "volumeMl": round(volume_ml, 3),
                            "sourceMaskSha256": mask_digest(mask),
                            "layer": "anatomy", "reviewStatus": "unreviewed",
                            "meshResolution": "coarse" if args.fast else "full",
                            "state": "unreviewed"})
        except ValueError as error:
            quality.append({"structure": name, "state": "rejected",
                            "reason": str(error), "layer": "anatomy"})

    if lesions and not scene.geometry:
        raise RuntimeError("Cannot show affected regions without an anatomical reference")
    for name, mask in lesions:
        # These are user-supplied delineations, not automated findings or diagnoses.
        mesh, voxel_count, volume_ml = nifti_mask_to_mesh(mask, step_size=1)
        mesh.visual.vertex_colors = [237, 79, 67, 255]
        label = "affected_region__" + name
        scene.add_geometry(mesh, geom_name=label, node_name=label)
        quality.append({"structure": label, "label": name,
                        "voxels": voxel_count, "triangles": len(mesh.faces),
                        "volumeMl": round(volume_ml, 3),
                        "sourceMaskSha256": mask_digest(mask),
                        "layer": "clinician-supplied-affected-region", "state": "unreviewed",
                        "reviewStatus": "unreviewed", "meshResolution": "full",
                        "provenance": "external NIfTI annotation; not independently verified"})

    if not scene.geometry:
        raise RuntimeError("No valid meshes; check study resolution and segmentation")
    out = target / "anatomy.glb"
    staging = target / "anatomy.glb.partial"
    staging.write_bytes(scene.export(file_type="glb"))
    staging.replace(out)
    report = {
        "schema": 1, "generatedAt": datetime.now(timezone.utc).isoformat(),
        "model": "clinician-provided masks" if external_masks else "TotalSegmentator",
        "task": "external-masks" if external_masks else selected["task"],
        "catalogModelId": model_id, "modelLicense": selected["licensed"],
        "sourceType": "local volumetric imaging", "modality": args.modality,
        "coordinateSystem": "NIfTI affine world (RAS+, millimetres)",
        "geometrySource": "patient-study-derived segmentation; NOT confirmed anatomy",
        "clinicalStatus": "UNVALIDATED_RESEARCH_OUTPUT",
        "needsExpertReview": True,
        "modelWeightsMayDownload": external_masks is None,
        "affectedRegions": len(lesions),
        "affectedRegionSource": ("clinician-supplied annotation; not an automatic diagnosis"
                                 if lesions else None),
        "sourceRegistration": ("affected-region grid matched to anatomy grid"
                               if lesions else "not-applicable"),
        "meshResolution": "coarse anatomy / full affected regions" if args.fast else "full",
        "elapsedSeconds": round(perf_counter() - started, 3),
        "structures": quality,
        "limitations": [
            "Validate with source DICOM/NIfTI slices before clinical interpretation.",
            "An affected-region layer is an external annotation, not a verified patient lesion.",
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
                      "affectedRegions": len(lesions), "elapsedSeconds": round(perf_counter() - started, 3),
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
