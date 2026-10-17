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
        "charts": [
            {"title": "Gráfico sintético", "labels": ["A", "B", "C"],
             "values": [4, 9, 3], "source_key": "source1"},
        ],
    }
    for style in ("apa", "vancouver"):
        report["style"] = style
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
        assert "Referencias" in paths["html"].read_text(encoding="utf-8")
        with ZipFile(paths["docx"]) as archive:
            assert archive.testzip() is None
            assert "word/document.xml" in archive.namelist()
            assert any(name.startswith("word/media/") for name in archive.namelist())
            xml = archive.read("word/document.xml").decode("utf-8")
            assert "Referencias" in xml and "Metodología" in xml
            assert ("(Apellido, 2026)" in xml) if style == "apa" else ("[1]" in xml)
        print("OK", style, paths["pdf"], paths["docx"], paths["html"])
    print("RESEARCH_PUBLISHER_SMOKE_PASS")
finally:
    logo.unlink(missing_ok=True)
