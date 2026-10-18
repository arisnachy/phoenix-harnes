#!/usr/bin/env python3
"""Offline smoke test for Phoenix editorial, hybrid and standards-first PDF profiles."""
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parent
PUBLISHER = ROOT / "phoenix-research-publisher.py"

def report(presentation):
    return {
        "title": "Informe editorial verificable sobre un hallazgo de prueba",
        "document_type": "brief",
        "quality_profile": "educational_brief",
        "user_requested_brief": True,
        "presentation": presentation,
        "style": "vancouver",
        "table_of_contents": True,
        "cover": {"institution": "Institución de ensayo", "author": "Autor de ensayo"},
        "sections": [
            {"heading": "Resumen", "text": "Síntesis de prueba respaldada por la cita registrada [@source1]."},
            {"heading": "Métodos", "text": "Método de simulación, sin datos reales ni inferencias clínicas [@source1]."},
            {"heading": "Conclusiones", "text": "No representa una investigación, sino una prueba de maquetación [@source1]."}
        ],
        "tables": [{"title": "Tabla de demostración", "source_key": "source1",
                    "columns": ["Estudio", "Población", "Resultado", "Limitación"],
                    "rows": [["Ensayo simulado", "Muestra de prueba", "Sin mediciones", "No extrapolar"]]}],
        "references": [{"key": "source1", "authors": "Equipo de pruebas", "year": "2026",
                        "title": "Fuente ficticia para comprobar maquetación",
                        "url": "https://example.org/placeholder"}]
    }

def main():
    with tempfile.TemporaryDirectory(prefix="phoenix-editorial-") as home:
        for profile in ("academic", "editorial", "hybrid"):
            source = json.dumps(report(profile), ensure_ascii=False)
            run = subprocess.run([sys.executable, str(PUBLISHER)], input=source, text=True,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 timeout=120, env={**__import__("os").environ, "HOME": home})
            if run.returncode:
                raise AssertionError(profile + ": " + run.stderr)
            result = json.loads(run.stdout)
            assert result["state"] == "REPORT_READY", (profile, result)
            assert result["presentation"] == profile
            pdf = Path(result["files"]["pdf"])
            docx = Path(result["files"]["docx"])
            assert pdf.read_bytes().startswith(b"%PDF-") and pdf.stat().st_size > 1000
            with ZipFile(docx) as archive:
                assert archive.testzip() is None
                assert "word/document.xml" in archive.namelist()
            assert result["quality"]["visual_page_review"] == "not_performed"
            print("EDITORIAL_SMOKE_PASS", profile, result["pagination"]["pdf_pages"], "pages")
    print("EDITORIAL_STRUCTURAL_PASS; visual review still required")

if __name__ == "__main__":
    main()
