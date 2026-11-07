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

class TestSyntheticMesh(unittest.TestCase):
    def test_mesh_preserves_physical_nifti_affine(self):
        reconstruction_spec = importlib.util.spec_from_file_location(
            "phoenix_anatomy_reconstruct",
            Path(__file__).with_name("phoenix-anatomy-reconstruct.py"))
        reconstruction = importlib.util.module_from_spec(reconstruction_spec)
        reconstruction_spec.loader.exec_module(reconstruction)
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "synthetic_structure.nii.gz"
            volume = np.zeros((22, 22, 22), dtype=np.uint8)
            volume[5:17, 6:18, 7:19] = 1
            affine = np.array([[2.,0.,0.,10.],[0.,2.,0.,-30.],
                               [0.,0.,3.,45.],[0.,0.,0.,1.]])
            image=nib.Nifti1Image(volume, affine)
            image.header.set_xyzt_units("mm")
            nib.save(image, str(path))
            mesh, count, ml = reconstruction.nifti_mask_to_mesh(path)
            self.assertEqual(count,12*12*12)
            self.assertAlmostEqual(ml,(12*12*12*2*2*3)/1000.)
            self.assertGreater(len(mesh.faces),0)
            self.assertTrue(np.isfinite(mesh.vertices).all())
            self.assertGreater(float(mesh.vertices[:,0].min()),10.0)
            self.assertGreater(float(mesh.vertices[:,2].min()),45.0)
            import trimesh
            self.assertEqual(trimesh.Scene(mesh).export(file_type="glb")[:4], b"glTF")


class TestAffectedRegionEvidence(unittest.TestCase):
    """Synthetic geometry tests contain no patient data."""
    def test_annotated_region_is_registered_and_included_without_diagnostic_claim(self):
        import argparse
        reconstruction_spec = importlib.util.spec_from_file_location(
            "phoenix_anatomy_reconstruct",
            Path(__file__).with_name("phoenix-anatomy-reconstruct.py"))
        recon = importlib.util.module_from_spec(reconstruction_spec)
        reconstruction_spec.loader.exec_module(recon)
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            organs, lesion = base / "organs", base / "annotations"
            organs.mkdir()
            lesion.mkdir()
            volume = np.zeros((32, 32, 32), dtype=np.uint8)
            volume[6:27, 5:26, 4:25] = 1
            marked = np.zeros_like(volume)
            marked[12:20, 13:21, 10:18] = 1
            mask(organs / "heart.nii.gz", volume)
            mask(lesion / "clinician_region.nii.gz", marked)
            self.assertTrue(recon.matching_grid(organs / "heart.nii.gz",
                                                lesion / "clinician_region.nii.gz"))
            args = argparse.Namespace(input=str(organs / "heart.nii.gz"),
                output=str(base / "output"), modality="ct", task=None, structures=None,
                device="cpu", fast=True, max_meshes=200, mask_folder=str(organs),
                lesion_mask_folder=str(lesion), research_only=True)
            recon.reconstruct(args)
            result = json.loads((base / "output" / "anatomy-manifest.json").read_text())
            self.assertEqual(result["affectedRegions"], 1)
            self.assertEqual(result["clinicalStatus"], "UNVALIDATED_RESEARCH_OUTPUT")
            self.assertEqual(result["sourceRegistration"],
                             "affected-region grid matched to anatomy grid")
            self.assertTrue(result["needsExpertReview"])
            self.assertEqual(len(result["structures"]), 2)
            affected = [r for r in result["structures"]
                        if r.get("layer") == "clinician-supplied-affected-region"][0]
            self.assertEqual(affected["state"], "unreviewed")
            self.assertRegex(affected["sourceMaskSha256"], r"^[a-f0-9]{64}$")
            self.assertGreater(affected["triangles"], 8)
            data = (base / "output" / "anatomy.glb").read_bytes()
            self.assertEqual(data[:4], b"glTF")
            self.assertNotIn(b"John Doe", data)

    def test_misaligned_annotation_is_rejected_before_export(self):
        recon_spec = importlib.util.spec_from_file_location(
            "phoenix_anatomy_reconstruct",
            Path(__file__).with_name("phoenix-anatomy-reconstruct.py"))
        recon = importlib.util.module_from_spec(recon_spec)
        recon_spec.loader.exec_module(recon)
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            arr = np.zeros((24, 24, 24), dtype=np.uint8)
            arr[5:18, 5:18, 5:18] = 1
            mask(base / "organ.nii.gz", arr)
            mask(base / "other-study.nii.gz", arr, translation=(17, 0, 0))
            with self.assertRaisesRegex(ValueError, "does not align"):
                recon.matching_grid(base / "organ.nii.gz", base / "other-study.nii.gz")

    def test_crop_preserves_global_geometry_and_fine_detail(self):
        recon_spec = importlib.util.spec_from_file_location(
            "phoenix_anatomy_reconstruct",
            Path(__file__).with_name("phoenix-anatomy-reconstruct.py"))
        recon = importlib.util.module_from_spec(recon_spec)
        recon_spec.loader.exec_module(recon)
        with tempfile.TemporaryDirectory() as root:
            base=Path(root)
            arr=np.zeros((80, 80, 80), dtype=np.uint8)
            arr[31:50, 25:48, 20:51]=1
            mask(base / "organ.nii.gz", arr, translation=(100, -50, 20))
            fine, count, volume=recon.nifti_mask_to_mesh(base / "organ.nii.gz",step_size=1)
            coarse, c_count, c_volume=recon.nifti_mask_to_mesh(base / "organ.nii.gz",step_size=2)
            self.assertEqual((count, volume),(c_count, c_volume))
            self.assertTrue(np.isfinite(fine.vertices).all())
            self.assertTrue(np.isfinite(coarse.vertices).all())
            self.assertGreater(float(fine.vertices[:,0].min()),100)
            self.assertGreater(float(coarse.vertices[:,0].min()),100)
            self.assertLessEqual(len(coarse.faces), len(fine.faces))

if __name__=="__main__":
    unittest.main()
