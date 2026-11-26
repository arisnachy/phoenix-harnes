import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

MODULE = Path(__file__).with_name("phoenix-office.py")
SPEC = importlib.util.spec_from_file_location("phoenix_office", MODULE)
office = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(office)


class OfficeTest(unittest.TestCase):
    def test_doctor(self):
        self.assertEqual(set(office.doctor()["engines"]), {"docx", "xlsx", "pptx"})

    def build(self, kind, spec):
        if not office.doctor()["engines"][kind]:
            self.skipTest("Optional engine not installed")
        with tempfile.TemporaryDirectory() as temp:
            src = Path(temp) / "spec.json"
            dst = Path(temp) / ("output." + kind)
            src.write_text(json.dumps(spec), encoding="utf-8")
            result = office.build(src, dst)
            self.assertTrue(result["structure_reopened"])
            self.assertFalse(result["visual_render_verified"])
            self.assertGreater(dst.stat().st_size, 0)
            with self.assertRaises(FileExistsError):
                office.build(src, dst)
            if kind == "xlsx":
                from openpyxl import load_workbook
                book = load_workbook(dst)
                self.assertEqual(book["Data"]["A2"].data_type, "s")
                self.assertEqual(book["Data"]["B2"].value, "=1+2")
                self.assertEqual(book.sheetnames, ["Data", "Summary"])
                self.assertEqual(len(book["Data"]._charts), 1)
                book.close()
            return result

    def test_docx(self):
        result = self.build("docx", {"title": "Report", "sections": [
            {"heading": "Results", "paragraphs": ["Content"],
             "tables": [{"headers": ["Name"], "rows": [["Example"]]}]}]})
        self.assertEqual(result["tables"], 1)

    def test_xlsx(self):
        result = self.build("xlsx", {"sheets": [
            {"name": "Data", "headers": ["Item", "Value"],
             "rows": [["=untrusted", {"formula": "=1+2"}], ["Other", 4]],
             "charts": [{"title": "Values", "category_column": 1, "value_column": 2}]},
            {"name": "Summary", "headers": ["Total"], "rows": [[7]]}]})
        self.assertEqual(result["data_rows"], 3)

    def test_pptx(self):
        result = self.build("pptx", {"slides": [{"title": "Overview", "bullets": ["One", "Two"]}]})
        self.assertEqual(result["slides"], 1)


if __name__ == "__main__":
    unittest.main()
