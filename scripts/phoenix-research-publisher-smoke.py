#!/usr/bin/env python3
"""Cross-platform real DOCX, PDF and HTML smoke test for Research Studio."""
import json
import subprocess
import sys
from pathlib import Path
from zipfile import ZipFile
from PIL import Image

script = Path(__file__).with_name("phoenix-research-publisher.py")
logo = Path(__file__).with_name(".phoenix-research-test-logo.png")
Image.new("RGB", (160, 100), "#c67a3c").save(logo)
try:
    report = {
        "title": "Informe de prueba de Phoenix Research Studio",
        "style": "apa",
        "presentation": "academic",
        "document_type": "brief",
        "keywords": ["metodología", "fuentes", "validación"],
        "paper": "A4",
        "cover": {"institution": "Institución de prueba", "faculty": "Facultad de Ciencias",
                  "author": "Investigador de prueba", "date": "2026-10-17",
                  "logo_path": str(logo)},
        "sections": [
            {"heading": "Resumen", "text": "Cita a una referencia sintética [@source1]."},
            {"heading": "Metodología", "text": "El gráfico contiene datos de prueba [@source1]."},
            {"heading": "Limitaciones", "text": "Esta prueba no valida la evidencia externa [@source1]."},
        ],
        "references": [
            {"key": "source1", "authors": "Apellido, A.", "year": "2026",
             "title": "Referencia sintética de prueba", "journal": "Revista de prueba",
             "url": "https://example.org/phoenix-research-ci"},
        ],
        "tables": [
            {"title": "Comparación de prueba", "columns": ["Grupo", "Tamaño", "Resultado"],
             "rows": [["A", 12, 4], ["B", 18, 9]], "source_key": "source1",
             "note": "Valores sintéticos únicamente para pruebas de formato"}
        ],
        "charts": [
            {"title": "Gráfico sintético", "labels": ["A", "B", "C"],
             "values": [4, 9, 3], "source_key": "source1"},
        ],
    }
    for style, presentation in (("apa", "academic"), ("vancouver", "hybrid"), ("apa7", "editorial")):
        report["style"] = style
        report["presentation"] = presentation
        process = subprocess.run([sys.executable, str(script)], input=json.dumps(report).encode("utf-8"),
                                 capture_output=True, check=True, timeout=90)
        receipt = json.loads(process.stdout)
        assert receipt["state"] == "REPORT_READY", receipt
        assert Path(receipt["project_path"]).is_file()
        assert json.loads(Path(receipt["project_path"]).read_text(encoding="utf-8"))["style"] == style
        assert receipt["source_verification"] == "metadata_user_supplied_not_network_verified"
        paths = {k: Path(v) for k, v in receipt["files"].items()}
        assert all(p.is_file() and p.stat().st_size > 500 for p in paths.values())
        assert paths["pdf"].read_bytes().startswith(b"%PDF-")
        html_contents = paths["html"].read_text(encoding="utf-8")
        assert "Referencias" in html_contents
        assert "<table>" in html_contents and "Comparación de prueba" in html_contents
        assert "Figura 1" in html_contents and "alt=" in html_contents
        assert receipt["presentation"] == presentation
        assert receipt["quality"]["submission_certified"] is False
        with ZipFile(paths["docx"]) as archive:
            assert archive.testzip() is None
            assert "word/document.xml" in archive.namelist()
            assert any(name.startswith("word/media/") for name in archive.namelist())
            xml = archive.read("word/document.xml").decode("utf-8")
            assert "Referencias" in xml and "Metodología" in xml
            assert "Comparación de prueba" in xml
            assert ("(Apellido, 2026)" in xml) if style in ("apa", "apa7") else ("[1]" in xml)
        print("OK", style, paths["pdf"], paths["docx"], paths["html"])
    report["document_type"] = "thesis"
    incomplete = subprocess.run([sys.executable, str(script)], input=json.dumps(report).encode("utf-8"),
                                capture_output=True, timeout=30)
    assert incomplete.returncode != 0
    assert b"requires missing sections" in incomplete.stderr
    report["document_type"] = "systematic_review"
    not_systematic = subprocess.run([sys.executable, str(script)], input=json.dumps(report).encode("utf-8"),
                                     capture_output=True, timeout=30)
    assert not_systematic.returncode != 0
    print("RESEARCH_PUBLISHER_SMOKE_PASS")
finally:
    logo.unlink(missing_ok=True)
