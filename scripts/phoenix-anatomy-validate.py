#!/usr/bin/env python3
"""PHOENIX research segmentation quality assessment, not clinical certification.

Compare binary NIfTI masks against clinician-curated references in the same
physical coordinate system. Refuse silently resampling misaligned studies.
"""
from __future__ import annotations
import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

def names(folder):
    return {
        p.name[:-7] if p.name.endswith(".nii.gz") else p.stem: p
        for p in folder.iterdir()
        if p.is_file() and (p.name.endswith(".nii.gz") or p.name.endswith(".nii"))
        and re.fullmatch(r"[A-Za-z0-9_-]{1,80}", p.name[:-7] if p.name.endswith(".nii.gz") else p.stem)
    }

def check_affine(img, other):
    import numpy as np
    if img.shape != other.shape:
        raise ValueError("voxel shape mismatch, manual alignment required")
    if len(img.shape) != 3:
        raise ValueError("only 3D NIfTI segmentation is supported")
    if img.header.get_xyzt_units()[0] != "mm" or other.header.get_xyzt_units()[0] != "mm":
        raise ValueError("explicit millimetre image units are required")
    if not np.allclose(img.affine, other.affine, rtol=0, atol=1e-3):
        raise ValueError("affine mismatch, do not resample labels silently")
    transform = img.affine[:3, :3]
    gram = transform.T @ transform
    diagonal = np.diag(gram)
    if np.any(diagonal <= 0) or np.max(np.abs(gram - np.diag(diagonal))) > 1e-3:
        raise ValueError("oblique/sheared voxel grid must be orthogonalized with a documented registration")
    return np.sqrt(diagonal), abs(float(np.linalg.det(transform))) / 1000.0

def metrics(a, b, spacing, voxel_volume_ml):
    import numpy as np
    from scipy.ndimage import binary_erosion, distance_transform_edt
    prediction = np.asarray(a, dtype=bool)
    reference = np.asarray(b, dtype=bool)
    na = int(np.count_nonzero(prediction))
    nb = int(np.count_nonzero(reference))
    true_positive = int(np.count_nonzero(prediction & reference))
    if na == 0 and nb == 0:
        return {"state": "both-empty", "dice": None, "hd95mm": None,
                "sensitivity": None, "predVolumeMl": 0.0, "refVolumeMl": 0.0}
    dice = 2 * true_positive / (na + nb)
    sensitivity = true_positive / nb if nb else None
    hd95 = None
    if na and nb:
        surface_a = prediction & ~binary_erosion(prediction, border_value=0)
        surface_b = reference & ~binary_erosion(reference, border_value=0)
        dist_b = distance_transform_edt(~surface_b, sampling=spacing)
        dist_a = distance_transform_edt(~surface_a, sampling=spacing)
        distances = np.concatenate((dist_b[surface_a], dist_a[surface_b]))
        hd95 = float(np.percentile(distances, 95)) if distances.size else None
    border = any(bool(np.any(prediction.take((0, -1), axis=axis))) for axis in range(3))
    return {
        "state": "compared",
        "dice": round(dice, 6),
        "hd95mm": round(hd95, 3) if hd95 is not None else None,
        "sensitivity": round(sensitivity, 6) if sensitivity is not None else None,
        "predVolumeMl": round(na * voxel_volume_ml, 3),
        "refVolumeMl": round(nb * voxel_volume_ml, 3),
        "borderTruncated": border,
    }

def validate(prediction_dir, reference_dir, output):
    import nibabel as nib
    import numpy as np
    pred = names(prediction_dir)
    references = names(reference_dir)
    if not pred or not references:
        raise ValueError("both directories must contain named NIfTI masks")
    rows = []
    for label, predicted_path in sorted(pred.items()):
        if label not in references:
            rows.append({"structure": label, "status": "reference-missing"})
            continue
        actual_img = nib.load(str(predicted_path))
        reference_img = nib.load(str(references[label]))
        try:
            spacing, volume = check_affine(actual_img, reference_img)
            item = metrics(np.asanyarray(actual_img.dataobj)>0, np.asanyarray(reference_img.dataobj)>0,
                           spacing, volume)
            rows.append({"structure": label, "status": "measured", **item})
        except ValueError as error:
            rows.append({"structure": label, "status": "geometry-rejected", "reason": str(error)})
    report = {
        "schema":1, "generatedAt":datetime.now(timezone.utc).isoformat(),
        "evaluation":"research-only", "clinicalValidation":"NOT_VALIDATED",
        "groundTruthStatus":"reference masks supplied by operator, not independently authenticated",
        "reviewNeeded":True, "predictionsCount":len(pred), "referencesCount":len(references),
        "comparisons":rows, "unmatchedReferences":sorted(set(references)-set(pred)),
        "warning":"Dice and HD95 do not establish diagnostic safety, anatomical completeness, or regulatory approval.",
    }
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if output.exists():
        raise ValueError("validation report already exists; never overwrite earlier evidence")
    with output.open("x",encoding="utf8") as handle:
        json.dump(report,handle,indent=2,ensure_ascii=False)
        handle.write("\n")
    return report

def main():
    p=argparse.ArgumentParser(description="PHOENIX NIfTI quality evidence (research only)")
    p.add_argument("--pred",type=Path,required=True)
    p.add_argument("--reference",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    p.add_argument("--research-only",action="store_true",required=True)
    args=p.parse_args()
    try:
        if not args.pred.is_dir() or not args.reference.is_dir():
            raise ValueError("both mask directories must exist")
        result=validate(args.pred.resolve(),args.reference.resolve(),args.output.resolve())
        print(json.dumps({"status":"evidence-generated", "compared":sum(x["status"]=="measured" for x in result["comparisons"]),
         "clinicalValidation":"NOT_VALIDATED"}))
    except Exception as error:
        print(json.dumps({"status":"error", "type":type(error).__name__,
                          "message":"Mask quality validation failed; inspect inputs locally without logging patient paths."}),file=sys.stderr)
        return 2
    return 0

if __name__=="__main__":
    sys.exit(main())
