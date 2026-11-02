#!/usr/bin/env python3
"""Real DOCX/PDF/HTML regression for concise editorial evidence and visual diversity.

Only synthetic fixtures are used; this smoke does not claim external source verification.
"""
import copy
import json
import subprocess
import sys
from pathlib import Path

import fitz
from docx import Document
from PIL import Image

PUBLISHER = Path(__file__).with_name("phoenix-research-publisher.py")


def sample():
    headings = ["Resumen ejecutivo", "Pregunta y alcance", "Método de contraste",
                "Resultados", "Conclusiones"]
    sections = []
    for section_number, heading in enumerate(headings):
        items = []
        for index in range(6):
            items.append(
                f"Esta observación sintética {section_number + 1}.{index + 1} permite comprobar "
                "si el editor organiza la información con claridad sin presentar cifras de prueba "
                "como hallazgos verificables. El contraste usa referencias ficticias declaradas "
                f"exclusivamente para la ejecución de pruebas del publicador [@r{index % 5 + 1}]."
            )
        sections.append({"heading": heading, "text": " ".join(items)})
    references = [
        {"key": f"r{i}", "authors": f"Persona de prueba {i}", "year": "2026",
         "title": f"Documento sintético {i}", "url": f"https://example.org/fixture-{i}"}
        for i in range(1, 6)
    ]
    return {
        "title": "Evaluación sintética de indicadores sanitarios comparables",
        "document_type": "brief", "quality_profile": "professional_brief",
        "user_requested_brief": True,
        "presentation": "hybrid", "style": "apa7", "table_of_contents": True,
        "visual_requirements": {"min_tables": 2, "min_charts": 3,
                                "min_chart_types": 3, "max_body_words": 1200},
        "sections": sections, "references": references,
        "tables": [
            {"title": "Tabla 1. Tabla 1. Observaciones comparadas", "source_key": "r1",
             "columns": ["Periodo", "Indicador", "Valor"],
             "rows": [["2015", "Prueba A", 12], ["2023", "Prueba B", 15]],
             "units": "datos sintéticos", "method": "fixture determinista"},
            {"title": "Indicadores y cobertura de observación", "source_key": "r2",
             "columns": ["Serie", "Año inicial", "Año final"],
             "rows": [["Ensayo", 2015, 2023]], "note": "Valores sintéticos"}
        ],
        "charts": [
            {"type": "area", "title": "Figura 1. Serie longitudinal sintética",
             "source_key": "r1", "labels": ["2015", "2019", "2023"],
             "x_values": [2015, 2019, 2023], "values": [12, 14, 15],
             "units": "puntos", "x_label": "Año"},
            {"type": "lollipop", "title": "Comparación de grupos",
             "source_key": "r2", "labels": ["Grupo A", "Grupo B", "Grupo C"],
             "values": [9, 12, 18], "units": "puntos"},
            {"type": "donut", "title": "Composición del conjunto observado",
             "source_key": "r3", "labels": ["A", "B", "C"],
             "values": [50, 35, 15], "units": "%"}
        ],
    }


def publish(report):
    outcome = subprocess.run(
        [sys.executable, str(PUBLISHER)], input=json.dumps(report).encode("utf8"),
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False
    )
    return outcome, json.loads(outcome.stdout) if outcome.returncode == 0 else None


def main():
    report = sample()
    outcome, manifest = publish(report)
    assert outcome.returncode == 0, outcome.stderr.decode("utf8")
    assert manifest["state"] == "REPORT_READY", manifest["warnings"]
    assert manifest["visual_audit"]["tables"] == 2
    assert manifest["visual_audit"]["figures"] == 3
    assert len(manifest["visual_audit"]["chart_types"]) == 3
    assert manifest["visual_audit"]["requirements_met"]
    assert 600 <= manifest["visual_audit"]["body_words"] <= 1200
    paths = {key: Path(value) for key, value in manifest["files"].items()}
    word = Document(paths["docx"])
    word_text = "\n".join(p.text for p in word.paragraphs)
    assert "Tabla 1. Tabla 1." not in word_text
    assert "Tabla 1. Observaciones comparadas" in word_text
    assert "Índice general" in word_text and "Pregunta y alcance" in word_text
    pdf = fitz.open(paths["pdf"])
    content = "\n".join(page.get_text() for page in pdf)
    assert "Tabla 1. Tabla 1." not in content
    assert "Figura 1. Figura 1." not in content
    assert "Tabla 1. Observaciones comparadas" in content
    pdf.close()
    html = paths["html"].read_text(encoding="utf8")
    assert "Tabla 1. Tabla 1." not in html
    assert "Figura 1. Figura 1." not in html
    for i in range(1, 4):
        figure = Path(manifest["output_dir"]) / f"figure-{i}.png"
        with Image.open(figure) as picture:
            assert picture.size == (1200, 650)

    incomplete = copy.deepcopy(report)
    incomplete["charts"].pop()
    _, receipt = publish(incomplete)
    assert receipt["state"] == "REPORT_NEEDS_REVISION"
    assert any("figuras" in message for message in receipt["warnings"])

    unsafe = copy.deepcopy(report)
    unsafe["charts"][-1]["values"] = [50, 30, 15]  # 95%, not an exhaustive population.
    failure, _ = publish(unsafe)
    assert failure.returncode != 0 and b"totaling 100" in failure.stderr

    bad_area = copy.deepcopy(report)
    bad_area["charts"][0]["x_values"] = [2019, 2015, 2023]
    failure, _ = publish(bad_area)
    assert failure.returncode != 0 and b"strictly increasing" in failure.stderr

    verbose = copy.deepcopy(report)
    verbose["visual_requirements"]["max_body_words"] = 650
    _, receipt = publish(verbose)
    assert receipt["state"] == "REPORT_NEEDS_REVISION"
    assert any("Extensión incumplida" in message for message in receipt["warnings"])
    print("RESEARCH_EDITORIAL_HUMAN_QUALITY_PASS", manifest["visual_audit"])


if __name__ == "__main__":
    main()
