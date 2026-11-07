"""Synthetic-only checks for PHOENIX research segmentation QA."""
from __future__ import annotations
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

import nibabel as nib
import numpy as np

spec = importlib.util.spec_from_file_location("phoenix_anatomy_validator",
                                            Path(__file__).with_name("phoenix-anatomy-validate.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def mask(path, data, translation=(0, 0, 0)):
    affine = np.diag([1.0, 1.0, 2.0, 1.0])
    affine[:3, 3] = translation
    image = nib.Nifti1Image(data.astype(np.uint8), affine=affine)
    image.header.set_xyzt_units("mm")
    nib.save(image, str(path))

class ValidateResearchMasks(unittest.TestCase):
    def test_identical_masks_have_perfect_dice_without_clinical_authority(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            pred, ref = base / "pred", base / "reference"
            pred.mkdir(); ref.mkdir()
            data = np.zeros((20, 20, 20), dtype=np.uint8)
            data[5:14, 5:14, 5:14] = 1
            mask(pred / "heart.nii.gz", data)
            mask(ref / "heart.nii.gz", data)
            report = module.validate(pred, ref, base / "result.json")
            self.assertEqual(report["clinicalValidation"], "NOT_VALIDATED")
            self.assertTrue(report["reviewNeeded"])
            row = report["comparisons"][0]
            self.assertEqual(row["dice"], 1)
            self.assertEqual(row["hd95mm"], 0)
            self.assertGreater(row["predVolumeMl"], 0)
            self.assertFalse(row["borderTruncated"])
    def test_misaligned_reference_is_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            base=Path(root)
            pred, ref=base/"pred", base/"ref"
            pred.mkdir(); ref.mkdir()
            arr=np.zeros((10,10,10), dtype=np.uint8)
            arr[2:6,2:6,2:6]=1
            mask(pred/"aorta.nii.gz",arr)
            mask(ref/"aorta.nii.gz",arr,translation=(10,0,0))
            result=module.validate(pred,ref,base/"qa.json")
            self.assertEqual(result["comparisons"][0]["status"],"geometry-rejected")
    def test_missing_reference_never_becomes_pass(self):
        with tempfile.TemporaryDirectory() as root:
            base=Path(root)
            pred, ref=base/"pred", base/"ref"
            pred.mkdir(); ref.mkdir()
            arr=np.zeros((12,12,12),dtype=np.uint8);arr[2:7,2:7,2:7]=1
            mask(pred/"brain.nii.gz",arr)
            mask(ref/"heart.nii.gz",arr)
            report=module.validate(pred,ref,base/"qa.json")
            self.assertEqual(report["comparisons"][0]["status"],"reference-missing")
            self.assertEqual(report["unmatchedReferences"],["heart"])

if __name__=="__main__":
    unittest.main()
