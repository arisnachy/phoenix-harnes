#!/usr/bin/env python3
"""Check genuine editable DOCX and visually different PDFs for each Phoenix style."""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from zipfile import ZipFile

import fitz

ROOT = Path(__file__).resolve().parent
PUBLISHER = ROOT / "phoenix-research-publisher.py"
PRESETS = ("editorial_navy", "clinical_teal", "executive_amber",
           "minimal_graphite", "creative_coral", "journal_ink", "research_violet",
           "biotech_green", "ocean_blue", "terracotta_report", "clinical_white")

def report(presentation, preset="auto", title="Informe editorial verificable sobre un hallazgo de prueba"):
    return {
        "title": title,
        "document_type": "brief",
        "quality_profile": "educational_brief",
        "user_requested_brief": True,
        "presentation": presentation,
        "design_preset": preset,
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
        "charts": [{"type": "line", "title": "Tendencia observada", "source_key": "source1",
                    "labels": ["A", "B", "C"], "values": [2, 4, 3], "units": "unidades de prueba",
                    "sample_size": 3, "method": "Serie sintética",
                    "statistical_note": "Solo prueba del diseño"},
                   {"type": "scatter", "title": "Dispersión observada", "source_key": "source1",
                    "labels": ["A", "B", "C"], "x_values": [0, 2, 4],
                    "values": [1, 2, 5], "x_label": "Tiempo", "y_label": "Valor"},
                   {"type": "horizontal_bar", "title": "Barras horizontales", "source_key": "source1",
                    "labels": ["A", "B", "C"], "values": [2, 4, 3]}],
        "references": [{"key": "source1", "authors": "Equipo de pruebas", "year": "2026",
                        "title": "Fuente ficticia para comprobar maquetación",
                        "url": "https://example.org/placeholder"}]
    }

def publish(data, home, success=True):
    run = subprocess.run([sys.executable, str(PUBLISHER)],
                         input=json.dumps(data, ensure_ascii=False), text=True,
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120,
                         env={**os.environ, "HOME": home, "USERPROFILE": home})
    if not success:
        assert run.returncode != 0, run.stdout
        return None
    if run.returncode:
        raise AssertionError(data["presentation"] + ": " + run.stderr)
    result = json.loads(run.stdout)
    assert result["state"] == "REPORT_READY", result
    assert result["presentation"] == data["presentation"]
    pdf = Path(result["files"]["pdf"])
    docx = Path(result["files"]["docx"])
    assert pdf.read_bytes().startswith(b"%PDF-") and pdf.stat().st_size > 1000
    with ZipFile(docx) as archive:
        assert archive.testzip() is None
        assert "word/document.xml" in archive.namelist()
    assert result["quality"]["visual_page_review"] == "not_performed"
    with fitz.open(pdf) as document:
        assert len(document) >= 2, "missing content pages"
        cover = document[0]
        assert " ".join(data["title"].split()) in " ".join(cover.get_text().split()), "missing real cover title"
        assert "Institución de ensayo" in cover.get_text(), "lost metadata"
        content = "\n".join(page.get_text() for page in document)
        for forbidden in ("EDICIÓN PROFESIONAL", "PHOENIX / RESEARCH STUDIO", "PHOENIX  /  INVESTIGACIÓN"):
            assert forbidden not in content, "unexpected internal publisher branding: " + forbidden
        assert "Tamaño muestral (n)" in content and "Figura 3" in content
        raster = cover.get_pixmap(matrix=fitz.Matrix(0.5, 0.5), alpha=False)
        fingerprint = hashlib.sha256(raster.samples).hexdigest()
        for page in document:
            for block in page.get_text("blocks"):
                if len(block) < 5 or not str(block[4]).strip():
                    continue
                x0, y0, x1, y1 = block[:4]
                assert x0 >= -3 and y0 >= -3, "text starts outside page"
                assert x1 <= page.rect.width + 3 and y1 <= page.rect.height + 3, "text clipped"
    return result, fingerprint

def main():
    with tempfile.TemporaryDirectory(prefix="phoenix-editorial-") as home:
        prints = set()
        for preset in PRESETS:
            result, fingerprint = publish(report("hybrid", preset), home)
            assert result["design_preset"] == preset
            assert fingerprint not in prints, "distinct designs rendered identical covers"
            prints.add(fingerprint)
            print("EDITORIAL_PRESET_PASS", preset, result["pagination"]["pdf_pages"], "pages")
        basic, _ = publish(report("academic"), home)
        strict_journal, _ = publish(report("journal", "academic_classic"), home)
        assert strict_journal["presentation"] == "journal"
        assert basic["design_preset"] == "academic_classic"
        automatic, _ = publish(report("editorial", title="Informe de salud comunitaria y neurociencia"), home)
        assert automatic["design_preset"] == "clinical_teal"
        automatic, _ = publish(report("hybrid", title="Informe de estrategia de empresa y mercado"), home)
        assert automatic["design_preset"] == "executive_amber"
        publish(report("academic", "creative_coral"), home, success=False)
        publish(report("hybrid", "unregistered_name"), home, success=False)
    print("EDITORIAL_ELEVEN_PRESETS_PASS; neutral journal and scientific figures verified; visual approval is separate")

if __name__ == "__main__":
    main()
