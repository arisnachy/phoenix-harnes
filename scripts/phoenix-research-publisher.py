#!/usr/bin/env python3
"""Phoenix Research Studio: verified report renderer, JSON on stdin/out, no external network."""
import hashlib
import html
import json
import math
import os
import re
import sys
import tempfile
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

try:
    from docx import Document
    from docx.shared import Cm, Inches, Pt, RGBColor
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
    from reportlab.lib.pagesizes import A4, letter
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.utils import ImageReader
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle, LongTable, HRFlowable, Image as PdfImage
    from reportlab.platypus.tableofcontents import TableOfContents
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from PIL import Image, ImageDraw, ImageFont
except ImportError as error:
    sys.stderr.write("RESEARCH_PUBLISH_DEPENDENCIES_MISSING: " + str(error) + "\n")
    sys.exit(4)

# A citation group can contain one or more registry keys, e.g. [@a; @b].
CITE_ANY_RE = re.compile(r"\[@([^\]\r\n]*)\]")
REF_RE = re.compile(r"\[@([A-Za-z0-9_-]{1,64}(?:\s*[,;]\s*@?[A-Za-z0-9_-]{1,64})*)\]")

def citation_keys(value):
    """Validate and extract *all* source keys, never leave unresolved [@...] in output."""
    if "[@" in value and not CITE_ANY_RE.findall(value):
        raise ValueError("Malformed citation marker in manuscript")
    keys = []
    for match in CITE_ANY_RE.finditer(value):
        token = match.group(0)
        if REF_RE.fullmatch(token) is None:
            raise ValueError("Unsupported citation group " + token[:120] +
                             ". Use [@a; @b] or [@a].")
        keys.extend(k.strip().lstrip("@") for k in re.split(r"[;,]", match.group(1)))
    if value.count("[@") != len(list(CITE_ANY_RE.finditer(value))):
        raise ValueError("Unclosed citation marker")
    return keys

def complete_research_profile(data, cited):
    """Admission gate: research isn't complete because a PDF happens to render."""
    profile = data.get("quality_profile", "professional")
    if profile not in ("professional", "educational_brief"):
        raise ValueError("Invalid quality_profile")
    if profile == "educational_brief":
        if data.get("document_type") != "brief" or data.get("user_requested_brief") is not True:
            raise ValueError("educational_brief requires explicit user_requested_brief and document_type brief")
        return
    document_type = data.get("document_type", "brief")
    if document_type == "brief":
        raise ValueError("A professional scientific investigation cannot default to a brief. "
                         "Use narrative_review, journal_manuscript, thesis, etc. "
                         "An expressly requested short demonstration requires educational_brief.")
    threshold = {
        "narrative_review": (2400, 8), "systematic_review": (3000, 10),
        "original_research": (1500, 8), "journal_manuscript": (1500, 8),
        "thesis": (8000, 15), "monograph": (4000, 12),
        "research_protocol": (1800, 8), "policy_report": (1800, 8),
    }
    min_words, min_sources = threshold.get(document_type, (2000, 8))
    total_words = sum(len(re.findall(r"\b\w+\b", sec["text"], re.UNICODE))
                      for sec in data["sections"])
    problems = []
    if total_words < min_words:
        problems.append(f"solo {total_words} palabras; perfil {document_type} exige mínimo editorial {min_words}")
    if len(cited) < min_sources:
        problems.append(f"solo {len(cited)} fuentes citadas; mínimo editorial {min_sources}")
    if document_type in ("thesis", "monograph") and not data.get("table_of_contents", True):
        problems.append("falta índice de capítulos")
    if document_type in ("narrative_review", "systematic_review", "original_research",
                         "journal_manuscript", "thesis", "monograph"):
        if not (data.get("tables") or data.get("charts")):
            problems.append("falta una tabla de evidencia o figura con fuente comprobable")
    core_kinds = {"methods", "results", "discussion"}
    for section in data["sections"]:
        kind = section_kind(section)
        words = len(re.findall(r"\b\w+\b", section["text"], re.UNICODE))
        if kind in core_kinds and words < 120:
            problems.append(f"sección {section['heading']} superficial: {words} palabras")
    # Repeated filler is not substantive writing, even if it meets a word target.
    sentences = []
    for section in data["sections"]:
        for sentence in re.split(r"[.!?]+(?:\s+|$)", section["text"]):
            canonical = " ".join(sentence.lower().split())
            if len(canonical) >= 55:
                sentences.append(canonical)
    if len(sentences) >= 15:
        duplicates = len(sentences) - len(set(sentences))
        if duplicates / len(sentences) > 0.15:
            problems.append("exceso de texto repetitivo o relleno; desarrollar contenido original y respaldado")
    if problems:
        raise ValueError("RESEARCH_QUALITY_GATE: documento incompleto: " + "; ".join(problems)
                         + ". Continuar investigando y desarrollando antes de publicar.")

NAME_RE = re.compile(r"[^a-zA-Z0-9_-]+")
MAX_CONTENT = 1000000
PRESENTATIONS = ("academic", "journal", "editorial", "hybrid")
# Reusable design tokens: deterministic, offline, provenance-safe, never an invented asset.
DESIGN_PRESETS = {
    "editorial_navy": {"navy": "#142b3a", "accent": "#117e84",
                      "highlight": "#d59a54", "paper": "#f7faf9",
                      "title": "#142b3a", "shape": "orbit"},
    "clinical_teal": {"navy": "#123d45", "accent": "#087b76",
                      "highlight": "#71c1b8", "paper": "#f6fbfa",
                      "title": "#153a41", "shape": "clinical"},
    "executive_amber": {"navy": "#262e3c", "accent": "#b47a26",
                        "highlight": "#e0b866", "paper": "#fcfaf5",
                        "title": "#262e3c", "shape": "executive"},
    "minimal_graphite": {"navy": "#282c33", "accent": "#3c5665",
                         "highlight": "#8a9ba6", "paper": "#ffffff",
                         "title": "#282c33", "shape": "minimal"},
    "creative_coral": {"navy": "#442b48", "accent": "#bd5869",
                       "highlight": "#f0ab83", "paper": "#fff8f5",
                       "title": "#442b48", "shape": "creative"},
    "journal_ink": {"navy": "#17212a", "accent": "#334c61",
                    "highlight": "#a2b6bd", "paper": "#ffffff", "title": "#17212a", "shape": "journal"},
    "research_violet": {"navy": "#242748", "accent": "#5c5996",
                        "highlight": "#bbb3da", "paper": "#faf9ff", "title": "#242748", "shape": "matrix"},
    "biotech_green": {"navy": "#17392e", "accent": "#267b59",
                      "highlight": "#93c8a6", "paper": "#f8fcf9", "title": "#17392e", "shape": "leaf"},
    "ocean_blue": {"navy": "#173249", "accent": "#257cac",
                   "highlight": "#75bfd9", "paper": "#f6fbff", "title": "#173249", "shape": "waves"},
    "terracotta_report": {"navy": "#402a2a", "accent": "#a15a42",
                          "highlight": "#d6a38b", "paper": "#fffaf5", "title": "#402a2a", "shape": "stack"},
    "clinical_white": {"navy": "#273641", "accent": "#24798c",
                       "highlight": "#8bc9cf", "paper": "#ffffff", "title": "#273641", "shape": "cross"},
}
DESIGN_PRESET_NAMES = ("auto", "academic_classic", *DESIGN_PRESETS)

def resolve_design_preset(data, presentation):
    """Choose a stable style by context; respect explicit user selection."""
    if presentation in ("academic", "journal"):
        return "academic_classic"
    selected = data.get("design_preset", "auto")
    if selected != "auto":
        return selected
    doc_type = data.get("document_type")
    if doc_type == "policy_report":
        return "executive_amber"
    if doc_type in ("original_research", "systematic_review", "narrative_review",
                    "journal_manuscript", "research_protocol"):
        return "clinical_teal"
    if doc_type == "thesis":
        return "minimal_graphite"
    if doc_type == "monograph":
        return "editorial_navy"
    title = unicodedata.normalize("NFKD", data.get("title", "")).lower()
    title = "".join(c for c in title if not unicodedata.combining(c))
    if any(w in title for w in ("salud", "clinica", "medicina", "neuro", "farmaco")):
        return "clinical_teal"
    if any(w in title for w in ("negocio", "empresa", "mercado", "finanza", "estrateg")):
        return "executive_amber"
    if any(w in title for w in ("arte", "creativ", "diseno", "cultura", "novela")):
        return "creative_coral"
    return "editorial_navy"
DOCUMENT_TYPES = ("brief", "monograph", "research_protocol", "narrative_review",
                  "systematic_review", "original_research", "thesis", "journal_manuscript", "policy_report")
SECTION_ALIASES = {
    "abstract": ("resumen", "abstract", "resumen ejecutivo", "resumen estructurado"),
    "introduction": ("introduccion", "introduction", "planteamiento del problema"),
    "framework": ("marco teorico", "theoretical framework", "revision bibliografica", "marco teorico y estado del arte"),
    "problem": ("planteamiento del problema", "problema de investigacion", "problem statement", "planteamiento del problema y justificacion"),
    "objectives": ("objetivos", "objetivos e hipotesis", "objetivo general y especificos", "objectives"),
    "methods": ("metodos", "metodologia", "methods", "methodology", "materiales y metodos"),
    "results": ("resultados", "results", "hallazgos", "findings", "sintesis de evidencia"),
    "discussion": ("discusion", "discussion", "analisis critico", "analisis"),
    "limitations": ("limitaciones", "limitations", "sesgos y limitaciones"),
    "conclusions": ("conclusiones", "conclusions", "conclusiones y recomendaciones"),
    "recommendations": ("recomendaciones", "recommendations", "implicaciones"),
    "ethics": ("consideraciones eticas", "ethics", "etica y cronograma"),
    "expected_results": ("resultados esperados", "expected results", "contribuciones esperadas"),
}
REQUIRED_SECTIONS = {
    "narrative_review": ("abstract", "introduction", "methods", "results", "discussion", "limitations", "conclusions"),
    "systematic_review": ("abstract", "introduction", "methods", "results", "discussion", "limitations", "conclusions"),
    "original_research": ("abstract", "introduction", "methods", "results", "discussion", "limitations", "conclusions"),
    "journal_manuscript": ("abstract", "introduction", "methods", "results", "discussion", "limitations", "conclusions"),
    "thesis": ("abstract", "introduction", "problem", "objectives", "framework", "methods", "results", "discussion", "conclusions", "recommendations"),
    "monograph": ("abstract", "introduction", "problem", "objectives", "framework", "methods", "discussion", "conclusions"),
    "research_protocol": ("abstract", "introduction", "problem", "objectives", "framework", "methods", "ethics", "expected_results"),
    "policy_report": ("abstract", "introduction", "methods", "results", "discussion", "limitations", "conclusions"),
}

def section_kind(section):
    if section.get("kind") in SECTION_ALIASES:
        return section["kind"]
    heading = unicodedata.normalize("NFKD", section["heading"])
    heading = "".join(c for c in heading if not unicodedata.combining(c)).lower().strip()
    heading = re.sub(r"^(?:capitulo\s+(?:[ivxlcdm]+|[0-9]+)[. :]*)|^(?:[0-9]+[. )-]*)", "", heading).strip()
    for kind, variants in SECTION_ALIASES.items():
        if heading in variants:
            return kind
    return None


VISUAL_TEXT_FIELDS = ("title", "note", "units", "method", "statistical_note",
                      "abbreviations", "x_label", "y_label", "interval_label", "alt_text", "series_label")

def validate_visual_metadata(item, kind):
    """Prevent invented or oversized statistical annotation."""
    for field in VISUAL_TEXT_FIELDS:
        if field in item and (not isinstance(item[field], str) or len(item[field]) > 1600):
            raise ValueError(kind + "." + field + " must be bounded text")
    if "sample_size" in item and (not isinstance(item["sample_size"], int)
                                  or isinstance(item["sample_size"], bool)
                                  or not 1 <= item["sample_size"] <= 1000000000):
        raise ValueError(kind + ".sample_size must be an observed positive integer")
    if "title" in item and not item["title"].strip():
        raise ValueError(kind + ".title cannot be empty")

def visual_notes(item, refs, style, numbers):
    """Print source, actual method and observed sample/units beneath each scientific visual."""
    result = ["Fuente: " + citation_string(item["source_key"], refs, style, numbers)]
    for key, label in (("sample_size", "Tamaño muestral (n)"),
                       ("units", "Unidades"), ("method", "Método"),
                       ("interval_label", "Intervalos"), ("statistical_note", "Análisis estadístico"),
                       ("abbreviations", "Abreviaturas"), ("note", "Nota")):
        value = item.get(key)
        if value is not None and str(value).strip():
            result.append(label + ": " + str(value))
    return result

def validate(data):
    if not isinstance(data, dict):
        raise ValueError("report must be an object")
    title = data.get("title")
    sections = data.get("sections")
    refs = data.get("references")
    if not isinstance(title, str) or not (5 <= len(title.strip()) <= 240):
        raise ValueError("report.title must have 5 to 240 characters")
    if not isinstance(sections, list) or not (1 <= len(sections) <= 140):
        raise ValueError("report.sections must contain 1 to 140 entries")
    if not isinstance(refs, list) or not (1 <= len(refs) <= 500):
        raise ValueError("report.references must contain 1 to 500 supplied sources")
    if data.get("style", "apa") not in ("apa", "apa7", "vancouver", "ama"):
        raise ValueError("style must be apa, apa7, vancouver or ama")
    resolved_presentation = data.get("presentation", "journal" if (data.get("document_type") == "journal_manuscript" or data.get("journal_requirements", {}).get("journal")) else ("hybrid" if data.get("quality_profile", "professional") == "professional" else "academic"))
    if resolved_presentation not in PRESENTATIONS:
        raise ValueError("presentation must be academic, journal, editorial or hybrid")
    selected_design = data.get("design_preset", "auto")
    if selected_design not in DESIGN_PRESET_NAMES:
        raise ValueError("design_preset must be one of the registered modern design names")
    if resolved_presentation in ("academic", "journal") and selected_design not in ("auto", "academic_classic"):
        raise ValueError("academic and journal modes cannot use decorative covers")
    if resolved_presentation not in ("academic", "journal") and selected_design == "academic_classic":
        raise ValueError("academic_classic requires academic or journal presentation")
    if data.get("document_type", "brief") not in DOCUMENT_TYPES:
        raise ValueError("unsupported document_type")
    if data.get("paper", "A4") not in ("A4", "Letter"):
        raise ValueError("paper must be A4 or Letter")
    if data.get("submission_ready") is True:
        raise ValueError("submission_ready requires external journal, authorship and human review")
    page_plan = data.get("page_plan", {})
    if not isinstance(page_plan, dict):
        raise ValueError("page_plan must be an object")
    target = page_plan.get("target_pages")
    if target is not None and (isinstance(target, bool) or not isinstance(target, int) or not 1 <= target <= 350):
        raise ValueError("target_pages must be an integer between 1 and 350")
    if page_plan.get("scope", "all") not in ("all", "body"):
        raise ValueError("page_plan.scope must be all or body")
    preliminary = data.get("front_matter", {})
    if not isinstance(preliminary, dict):
        raise ValueError("front_matter must be an object")
    for field in ("approval", "originality", "dedication", "acknowledgements", "abstract_en"):
        if field in preliminary and (not isinstance(preliminary[field], str) or len(preliminary[field]) > 20000):
            raise ValueError("front_matter." + field + " must be a bounded text")
    journal = data.get("journal_requirements", {})
    if not isinstance(journal, dict):
        raise ValueError("journal_requirements must be an object")
    for limit in ("max_words", "max_abstract_words", "max_references", "max_tables_figures"):
        if limit in journal and (isinstance(journal[limit], bool) or not isinstance(journal[limit], int)
                                 or not 1 <= journal[limit] <= 100000):
            raise ValueError("journal " + limit + " must be a positive integer")
    if "journal" in journal and (not isinstance(journal["journal"], str) or len(journal["journal"]) > 120):
        raise ValueError("journal identifier invalid")
    if "max_words" in journal:
        body_words = sum(len(re.findall(r"\b\w+\b", section["text"], re.UNICODE))
                         for section in sections if section_kind(section) != "abstract")
        if body_words > journal["max_words"]:
            raise ValueError("manuscript text exceeds journal max_words: " + str(body_words))
    abstract_words = sum(len(re.findall(r"\b\w+\b", section["text"], re.UNICODE))
                         for section in sections if section_kind(section) == "abstract")
    if "max_abstract_words" in journal and abstract_words > journal["max_abstract_words"]:
        raise ValueError("abstract exceeds journal max_abstract_words: " + str(abstract_words))
    if "max_references" in journal and len(refs) > journal["max_references"]:
        raise ValueError("references exceed journal max_references")
    if "max_tables_figures" in journal and len(data.get("tables", [])) + len(data.get("charts", [])) > journal["max_tables_figures"]:
        raise ValueError("tables and figures exceed journal limit")
    institutional = data.get("institutional_rules", {})
    if not isinstance(institutional, dict):
        raise ValueError("institutional_rules must be an object")
    if institutional:
        if institutional.get("reviewed_by_user") is not True:
            raise ValueError("institutional_rules require user review of source-located candidates")
        margin = institutional.get("margin_cm")
        if margin is not None and (not isinstance(margin, (int, float)) or isinstance(margin, bool)
                                   or not math.isfinite(margin) or not 1.5 <= margin <= 4):
            raise ValueError("institutional margin_cm must be 1.5 to 4")
        spacing = institutional.get("line_spacing")
        if spacing is not None and (spacing not in (1, 1.15, 1.5, 2)):
            raise ValueError("institutional line_spacing unsupported")
        if institutional.get("font_family", "Times New Roman") not in ("Times New Roman", "Arial", "Calibri", "Georgia"):
            raise ValueError("institutional font not allowed")
    key_points = preliminary.get("key_points", [])
    if not isinstance(key_points, list) or len(key_points) > 3 or any(
        not isinstance(point, str) or len(point) > 500 or not point.strip() for point in key_points
    ):
        raise ValueError("key_points should have up to 3 nonempty statements")
    if journal.get("require_key_points") and len(key_points) != 3:
        raise ValueError("journal requires 3 verified Key Points statements")
    cover = data.get("cover", {})
    if not isinstance(cover, dict):
        raise ValueError("cover must be an object")
    authors = cover.get("authors", [])
    if not isinstance(authors, list) or len(authors) > 30:
        raise ValueError("cover.authors must be a list of at most 30 authors")
    for author in authors:
        if not isinstance(author, dict) or not isinstance(author.get("name"), str) or not author["name"].strip():
            raise ValueError("each author requires a name")
        for field in ("student_id", "affiliation", "orcid"):
            if field in author and (not isinstance(author[field], str) or len(author[field]) > 240):
                raise ValueError("author " + field + " must be a short text")
    if data.get("document_type") in ("thesis", "monograph"):
        if not cover.get("institution"):
            raise ValueError("academic manuscript requires cover.institution")
        if not authors and not cover.get("author"):
            raise ValueError("academic manuscript requires at least one author")

    keywords = data.get("keywords", [])
    if not isinstance(keywords, list) or len(keywords) > 12 or any(
        not isinstance(word, str) or not word.strip() or len(word) > 80 for word in keywords
    ):
        raise ValueError("keywords must contain up to 12 short strings")
    keys = set()
    for source in refs:
        if not isinstance(source, dict):
            raise ValueError("each reference must be an object")
        key = source.get("key")
        if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", key) or key in keys:
            raise ValueError("reference keys must be unique")
        keys.add(key)
        for field in ("authors", "title", "year", "url"):
            if not isinstance(source.get(field), str) or not source[field].strip():
                raise ValueError("reference " + key + " missing " + field)
        if not source["url"].startswith("https://") or len(source["url"]) > 1200:
            raise ValueError("reference URLs must be HTTPS")
        if not re.fullmatch(r"(19|20)\d{2}", source["year"]):
            raise ValueError("invalid reference year")
    cited = set()
    for section in sections:
        if not isinstance(section, dict) or not isinstance(section.get("heading"), str) or not isinstance(section.get("text"), str):
            raise ValueError("sections require heading and text")
        if len(section["heading"]) > 180 or len(section["text"]) > 65000:
            raise ValueError("section exceeds safe length")
        cited.update(citation_keys(section["text"]))
    if not cited or cited - keys:
        raise ValueError("each report must cite registered source keys with [@key], unknown=" + str(sorted(cited-keys)))
    extra_sections = data.get("appendices", [])
    if not isinstance(extra_sections, list) or len(extra_sections) > 30:
        raise ValueError("appendices must be an array of up to 30 entries")
    for appendix in extra_sections:
        if not isinstance(appendix, dict) or not isinstance(appendix.get("title"), str) or not isinstance(appendix.get("text"), str):
            raise ValueError("each appendix requires title and text")
        if not appendix["title"].strip() or len(appendix["title"]) > 180 or len(appendix["text"]) > 35000:
            raise ValueError("appendix content exceeds safe bounds")
        cited.update(citation_keys(appendix["text"]))
    if cited - keys:
        raise ValueError("appendix contains unknown source keys " + str(sorted(cited-keys)))
    declarations = data.get("declarations", {})
    if not isinstance(declarations, dict):
        raise ValueError("declarations must be an object")
    if any(field not in ("ethics", "funding", "conflicts", "data_availability", "registration") or
           not isinstance(value, str) or len(value) > 10000
           for field, value in declarations.items()):
        raise ValueError("unsupported or oversized research declaration")
    document_type = data.get("document_type", "brief")
    section_kinds = {section_kind(section) for section in sections}
    missing = [kind for kind in REQUIRED_SECTIONS.get(document_type, ()) if kind not in section_kinds]
    if missing:
        raise ValueError(document_type + " requires missing sections: " + ", ".join(missing))
    if document_type == "systematic_review" and not data.get("systematic_review_evidence"):
        raise ValueError("systematic_review requires documented screening and extraction evidence")
    complete_research_profile(data, cited)
    if len(json.dumps(data, ensure_ascii=False)) > MAX_CONTENT:
        raise ValueError("report payload exceeds limit")
    tables = data.get("tables", [])
    if not isinstance(tables, list) or len(tables) > 25:
        raise ValueError("tables must be an array of up to 25 entries")
    for entry in tables:
        if not isinstance(entry, dict) or entry.get("source_key") not in cited:
            raise ValueError("every table must cite a source_key used in the manuscript")
        columns, rows = entry.get("columns"), entry.get("rows")
        if not isinstance(columns, list) or not 2 <= len(columns) <= 9 or not all(isinstance(x, str) and x.strip() for x in columns):
            raise ValueError("table requires 2-9 nonempty columns")
        if not isinstance(rows, list) or not 1 <= len(rows) <= 100:
            raise ValueError("table requires 1-100 data rows")
        if any(not isinstance(row, list) or len(row) != len(columns)
               or any(not isinstance(cell, (str, int, float)) or len(str(cell)) > 550 for cell in row) for row in rows):
            raise ValueError("table row must match headers and contain simple values")
        validate_visual_metadata(entry, "table")
    if not isinstance(data.get("charts", []), list) or len(data.get("charts", [])) > 20:
        raise ValueError("charts must be an array of up to 20 entries")
    for entry in data.get("charts", []):
        if not isinstance(entry, dict) or entry.get("source_key") not in cited:
            raise ValueError("each data chart must cite a referenced source_key")
        kind = entry.get("type", "bar")
        if kind not in ("bar", "horizontal_bar", "line", "scatter", "forest"):
            raise ValueError("chart type must be bar, horizontal_bar, line, scatter or forest")
        vals = entry.get("values", [])
        labs = entry.get("labels", [])
        if not isinstance(labs, list) or not isinstance(vals, list) or not 1 <= len(vals) <= 15 or len(vals) != len(labs):
            raise ValueError("charts need 1-15 matched labels/values")
        if any(not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v) for v in vals):
            raise ValueError("chart values must be finite authentic numbers")
        if any(not isinstance(label, str) or not label.strip() or len(label) > 100 for label in labs):
            raise ValueError("chart labels must be readable text")
        validate_visual_metadata(entry, "figure")
        x_values = entry.get("x_values")
        if kind == "scatter" and x_values is None:
            raise ValueError("scatter requires actual numeric x_values")
        if x_values is not None and (not isinstance(x_values, list) or len(x_values) != len(vals) or
            any(not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) for value in x_values)):
            raise ValueError("x_values must be finite numbers aligned to observations")
        if kind != "forest" and ("ci_low" in entry or "ci_high" in entry):
            lows, highs = entry.get("ci_low"), entry.get("ci_high")
            if not isinstance(lows, list) or not isinstance(highs, list) or len(lows) != len(vals) or len(highs) != len(vals):
                raise ValueError("error bars need aligned ci_low and ci_high")
            if any(not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in (lo, hi))
                   or not lo <= estimate <= hi for lo, estimate, hi in zip(lows, vals, highs)):
                raise ValueError("error bars require ordered finite intervals")
            if not entry.get("interval_label"):
                raise ValueError("error bars require interval_label documenting the interval type")
        if kind == "forest":
            lows, highs = entry.get("ci_low"), entry.get("ci_high")
            if not isinstance(lows, list) or not isinstance(highs, list) or len(lows) != len(vals) or len(highs) != len(vals):
                raise ValueError("forest plot requires aligned ci_low and ci_high arrays")
            if any(not all(isinstance(v, (int,float)) and not isinstance(v,bool) and math.isfinite(v)
                           for v in (lo, hi)) or not lo <= estimate <= hi
                   for lo, estimate, hi in zip(lows, vals, highs)):
                raise ValueError("forest plot requires finite ordered confidence intervals")
            if not isinstance(entry.get("method"), str) or not entry["method"].strip():
                raise ValueError("forest plot requires the documented effect/CI estimation method")
    return {s["key"]: s for s in refs}, cited

def citation_string(key, refs, style, index):
    ref = refs[key]
    if style == "vancouver":
        return "[" + str(index[key]) + "]"
    if style == "ama":
        return str(index[key]).translate(str.maketrans("0123456789", "⁰¹²³⁴⁵⁶⁷⁸⁹"))
    author = ref["authors"].split(",")[0].strip()
    return "(" + author + ", " + ref["year"] + ")"

def format_text(value, refs, style, order):
    def replace_group(match):
        keys = [part.strip().lstrip("@") for part in re.split(r"[;,]", match.group(1))]
        if style == "vancouver":
            return "[" + ",".join(str(order[key]) for key in keys) + "]"
        if style == "ama":
            return ",".join(citation_string(key, refs, style, order) for key in keys)
        entries = [citation_string(key, refs, style, order)[1:-1]
                   for key in sorted(keys, key=lambda key: (refs[key]["authors"], refs[key]["year"]))]
        return "(" + "; ".join(entries) + ")"
    result = REF_RE.sub(replace_group, value)
    if "[@" in result:
        raise ValueError("Unresolved manuscript citations cannot enter PDF/Word/HTML")
    return result

def bibliography(ref, style, number):
    authors = ref["authors"].strip()
    year = ref["year"]
    title = ref["title"].strip()
    journal = ref.get("journal", "").strip()
    doi = ref.get("doi", "").strip()
    url = "https://doi.org/" + doi if doi else ref["url"]
    volume = str(ref.get("volume", "")).strip()
    issue = str(ref.get("issue", "")).strip()
    pages = str(ref.get("pages", "")).strip()
    if style == "vancouver":
        source = str(ref.get("journal_abbrev") or journal)
        detail = (";" + volume if volume else "") + ("(" + issue + ")" if issue else "") + (":" + pages if pages else "")
        return f"{number}. {authors}. {title}. {source}. {year}{detail}. {('doi:' + doi) if doi else url}"
    if style == "ama":
        volume = str(ref.get("volume", "")).strip()
        issue = str(ref.get("issue", "")).strip()
        pages = str(ref.get("pages", "")).strip()
        detail = (";" + volume if volume else "") + ("(" + issue + ")" if issue else "") + (":" + pages if pages else "")
        return f"{number}. {authors}. {title}. {ref.get('journal_abbrev') or journal}. {year}{detail}. {('doi:' + doi) if doi else url}"
    detail = (", " + volume if volume else "") + ("(" + issue + ")" if issue else "")
    if pages: detail += ", " + pages
    return f"{authors} ({year}). {title}. {journal}{detail}. {url}"

def chart_image(chart, folder, ordinal, accent="#087783"):
    """Draw scientific bars, lines, scatter points and confidence intervals from real inputs."""
    labels, values = chart["labels"], chart["values"]
    kind = chart.get("type", "bar")
    image = Image.new("RGB", (1200, 650), "white")
    draw = ImageDraw.Draw(image)
    font_file = next((p for p in (
        "C:/Windows/Fonts/segoeui.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
    ) if Path(p).is_file()), None)
    font = ImageFont.truetype(font_file, 19) if font_file else ImageFont.load_default()
    small = ImageFont.truetype(font_file, 16) if font_file else ImageFont.load_default()
    ink, grid = "#243442", "#e0e7eb"
    left, right, top, bottom = 140, 1100, 75, 510

    def fmt(v):
        return f"{v:.3g}"

    def bounds(numbers, include_zero=False):
        low, high = min(numbers), max(numbers)
        if include_zero:
            low, high = min(0, low), max(0, high)
        span = high-low
        if span == 0:
            span = max(abs(low)*0.10, 1)
            return low-span/2, high+span/2
        padding = 0.08*span
        return low-(0 if include_zero and low == 0 else padding), high+padding

    lows = chart.get("ci_low", values)
    highs = chart.get("ci_high", values)
    all_values = [*values, *lows, *highs]
    if kind in ("forest", "horizontal_bar"):
        low, high = bounds(all_values, kind == "horizontal_bar")
        x_left, x_right = 330, 970
        xx = lambda v: x_left + (v-low)/(high-low)*(x_right-x_left)
        for i in range(6):
            v = low+(high-low)*i/5
            x = xx(v)
            draw.line((x,top,x,bottom), fill=grid, width=2)
            draw.text((x-19,bottom+12), fmt(v), fill=ink, font=small)
        if kind == "forest":
            null_value = chart.get("null_value", 1)
            if isinstance(null_value,(int,float)) and not isinstance(null_value,bool) and math.isfinite(null_value) and low <= null_value <= high:
                draw.line((xx(null_value),top,xx(null_value),bottom), fill="#7c8b96", width=3)
        elif low <= 0 <= high:
            draw.line((xx(0),top,xx(0),bottom), fill=ink, width=3)
        spacing = (bottom-top)/len(values)
        for i,(label,v) in enumerate(zip(labels,values)):
            y = top+(i+.5)*spacing
            draw.text((10,y-10),str(label)[:31],fill=ink,font=small)
            if kind == "forest":
                lo,hi = lows[i],highs[i]
                draw.line((xx(lo),y,xx(hi),y),fill=accent,width=4)
                for bound in (lo,hi):
                    draw.line((xx(bound),y-7,xx(bound),y+7),fill=accent,width=2)
                draw.rectangle((xx(v)-7,y-7,xx(v)+7,y+7),fill=accent)
                draw.text((985,y-10),f"{fmt(v)} [{fmt(lo)}, {fmt(hi)}]",fill=ink,font=small)
            else:
                draw.rectangle((min(xx(0),xx(v)),y-spacing*.25,max(xx(0),xx(v)),y+spacing*.25),fill=accent)
                draw.text((985,y-10),fmt(v),fill=ink,font=small)
        draw.text((x_left+150,575),(chart.get("x_label") or chart.get("units") or "Valor")[:65],fill=ink,font=font)
    else:
        low,high = bounds(all_values,kind == "bar")
        yy = lambda v: bottom-(v-low)/(high-low)*(bottom-top)
        for i in range(6):
            v=low+(high-low)*i/5
            y=yy(v)
            draw.line((left,y,right,y),fill=grid,width=2)
            draw.text((38,y-10),fmt(v),fill=ink,font=small)
        draw.line((left,top,left,bottom),fill=ink,width=3)
        draw.line((left,bottom,right,bottom),fill=ink,width=3)
        if low<=0<=high:
            draw.line((left,yy(0),right,yy(0)),fill="#8695a0",width=2)
        if kind == "scatter":
            xs=chart["x_values"]
            x_low,x_high=bounds(xs)
            xx=lambda v:left+(v-x_low)/(x_high-x_low)*(right-left)
            points=[(xx(xv),yy(yv)) for xv,yv in zip(xs,values)]
            for i in range(6):
                v=x_low+(x_high-x_low)*i/5
                draw.text((xx(v)-18,bottom+13),fmt(v),fill=ink,font=small)
        else:
            step=(right-left)/len(values)
            points=[(left+(i+.5)*step,yy(v)) for i,v in enumerate(values)]
            for i,label in enumerate(labels):
                draw.text((points[i][0]-min(32,step*.30),bottom+13),
                          str(label)[:max(3,int(step/11))],fill=ink,font=small)
        if kind == "bar":
            step=(right-left)/len(values)
            for x,y in points:
                draw.rectangle((x-step*.30,min(yy(0),y),x+step*.30,max(yy(0),y)),fill=accent)
        else:
            if kind == "line" and len(points)>1:
                draw.line(points,fill=accent,width=4)
            for x,y in points:
                draw.ellipse((x-7,y-7,x+7,y+7),fill=accent)
        if "ci_low" in chart:
            for (x,_),lo,hi in zip(points,lows,highs):
                draw.line((x,yy(lo),x,yy(hi)),fill="#536d81",width=3)
                for v in (lo,hi):
                    draw.line((x-6,yy(v),x+6,yy(v)),fill="#536d81",width=2)
        draw.text((left+170,575),(chart.get("x_label") or "Categoría")[:68],fill=ink,font=font)
        if chart.get("y_label") or chart.get("units"):
            draw.text((15,22),(chart.get("y_label") or chart.get("units"))[:70],fill=ink,font=font)
    if chart.get("series_label"):
        draw.text((right-330,25),chart["series_label"][:48],fill=accent,font=small)
    destination = folder / f"figure-{ordinal}.png"
    image.save(destination, dpi=(220,220))
    return destination

def cover_authors(cover):
    people = cover.get("authors") or []
    if people:
        return [str(p["name"]) +
                ((" · Matrícula/ID: " + str(p["student_id"])) if p.get("student_id") else "") +
                ((" · " + str(p["affiliation"])) if p.get("affiliation") else "") +
                ((" · ORCID: " + str(p["orcid"])) if p.get("orcid") else "")
                for p in people]
    return [str(cover["author"])] if cover.get("author") else []

FRONT_LABELS = [
    ("approval", "Hoja de aprobación"),
    ("originality", "Declaración de originalidad"),
    ("dedication", "Dedicatoria"),
    ("acknowledgements", "Agradecimientos"),
    ("abstract_en", "Abstract"),
]

def add_word_field(paragraph, instruction):
    field = OxmlElement("w:fldSimple")
    field.set(qn("w:instr"), instruction)
    paragraph._p.append(field)

class IndexedDocTemplate(SimpleDocTemplate):
    def afterFlowable(self, flowable):
        info = getattr(flowable, "_outline_entry", None)
        if info is not None:
            key, label = info
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(label, key, level=0, closed=False)
            self.notify("TOCEntry", (0, label, self.page, key))

def main():
    raw = sys.stdin.buffer.read(MAX_CONTENT * 4)
    report = json.loads(raw.decode("utf-8"))
    refs, cited = validate(report)
    style = "apa" if report.get("style", "apa") == "apa7" else report.get("style", "apa")
    presentation = report.get("presentation", "journal" if (report.get("document_type") == "journal_manuscript" or report.get("journal_requirements", {}).get("journal")) else ("hybrid" if report.get("quality_profile", "professional") == "professional" else "academic"))
    journal = report.get("journal_requirements", {})
    institutional = report.get("institutional_rules", {})
    editorial = presentation in ("editorial", "hybrid")
    design_preset = resolve_design_preset(report, presentation)
    tokens = DESIGN_PRESETS.get(design_preset, {
        "navy": "#171717", "accent": "#171717", "highlight": "#777777",
        "paper": "#ffffff", "title": "#171717", "shape": "minimal",
    })
    accent = tokens["accent"]
    first_order = []
    for section in [*report["sections"], *report.get("appendices", [])]:
        for key in citation_keys(section["text"]):
            if key not in first_order: first_order.append(key)
    numbers = {key: i+1 for i, key in enumerate(first_order)}
    ordered_refs = [refs[key] for key in (first_order if style in ("vancouver", "ama") else sorted(cited, key=lambda k: (refs[k]["authors"], refs[k]["year"])))]
    digest = hashlib.sha256(raw).hexdigest()[:16]
    output_root = Path.home() / ".dsh" / "research-reports" / digest
    output_root.mkdir(parents=True, exist_ok=True)
    title = report["title"].strip()
    cover = report.get("cover") if isinstance(report.get("cover"), dict) else {}
    front = report.get("front_matter", {})
    academic_work = report.get("document_type") in ("monograph", "thesis", "research_protocol")
    include_toc = report.get("table_of_contents", False if presentation == "journal" else
                             (academic_work or report.get("quality_profile", "professional") == "professional"))
    authors = cover_authors(cover)
    paper = A4 if report.get("paper", "A4") == "A4" else letter
    doc = Document()
    sec = doc.sections[0]
    sec.page_height = Cm(29.7) if paper == A4 else Inches(11)
    sec.page_width = Cm(21) if paper == A4 else Inches(8.5)
    margin_cm = institutional.get("margin_cm", 2.54)
    pdf_margin = margin_cm * 72 / 2.54 if institutional else (72 if style == "apa" and not editorial else 60)
    content_width = paper[0] - 2 * pdf_margin
    sec.top_margin = sec.bottom_margin = Cm(margin_cm)
    sec.left_margin = sec.right_margin = Cm(margin_cm)
    normal = doc.styles["Normal"]
    normal.font.name = institutional.get("font_family", "Times New Roman")
    normal.font.size = Pt(12)
    normal.paragraph_format.line_spacing = institutional.get(
        "line_spacing", 1.38 if editorial else (2 if style == "apa" else 1.4))
    normal.paragraph_format.space_after = Pt(7 if editorial else (0 if style == "apa" else 6))
    if editorial:
        normal.font.name = institutional.get("font_family", "Aptos")
        normal.font.size = Pt(11)
        heading_style = doc.styles["Heading 1"]
        heading_style.font.name = "Aptos Display"
        heading_style.font.color.rgb = RGBColor.from_string(accent.lstrip("#"))

    logo = cover.get("logo_path", "") if isinstance(cover, dict) else ""
    logo_file = None
    if logo:
        candidate = Path(logo).expanduser().resolve()
        if candidate.suffix.lower() not in (".png", ".jpg", ".jpeg") or not candidate.is_file() or candidate.stat().st_size > 3_000_000:
            raise ValueError("logo must be an existing PNG/JPEG below 3 MB")
        with Image.open(candidate) as im:
            im.verify()
        logo_file = candidate

    def center_doc(value, bold=False, size=None):
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(str(value))
        r.bold = bold
        if size: r.font.size = Pt(size)
        return p

    if logo_file:
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.add_run().add_picture(str(logo_file), width=Inches(1.25))
    if cover.get("institution"): center_doc(cover["institution"], True, 14)
    for field in ("faculty", "department", "degree"):
        if cover.get(field): center_doc(cover[field])
    doc.add_paragraph("")
    center_doc(title, True, 20 if editorial else 17)
    for author in authors: center_doc("Autor(a): " + author)
    if cover.get("course"): center_doc("Asignatura: " + str(cover["course"]) +
                                       (" · " + str(cover["course_code"]) if cover.get("course_code") else ""))
    if cover.get("lecturer"): center_doc("Docente: " + str(cover["lecturer"]))
    if cover.get("advisor"): center_doc("Asesor(a): " + str(cover["advisor"]))
    if cover.get("city") or cover.get("country"):
        center_doc(", ".join(str(cover[k]) for k in ("city", "country") if cover.get(k)))
    center_doc(cover.get("date", datetime.now(timezone.utc).date().isoformat()))
    doc.add_page_break()
    for key, label in FRONT_LABELS:
        if front.get(key):
            doc.add_heading(label, level=1)
            for value in front[key].split("\n"):
                if value.strip(): doc.add_paragraph(value.strip())
            doc.add_page_break()
    if include_toc:
        doc.add_heading("Índice general", level=1)
        add_word_field(doc.add_paragraph(), 'TOC \\o "1-3" \\h \\z \\u')
        if report.get("tables"):
            doc.add_heading("Índice de tablas", level=1)
            for ix, item in enumerate(report["tables"], 1):
                doc.add_paragraph("Tabla " + str(ix) + ". " + str(item.get("title", "Resultados")))
        if report.get("charts"):
            doc.add_heading("Índice de figuras", level=1)
            for ix, item in enumerate(report["charts"], 1):
                doc.add_paragraph("Figura " + str(ix) + ". " + str(item.get("title", "Gráfico")))
        doc.add_page_break()
    settings = doc.settings._element
    update_field = OxmlElement("w:updateFields")
    update_field.set(qn("w:val"), "true")
    settings.append(update_field)
    footer_paragraph = sec.footer.paragraphs[0]
    footer_paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    add_word_field(footer_paragraph, "PAGE")
    if front.get("key_points"):
        doc.add_heading("Key Points", level=1)
        for point in front["key_points"]: doc.add_paragraph("• " + point)
    if report.get("keywords"):
        doc.add_paragraph("Palabras clave: " + ", ".join(str(x) for x in report["keywords"]))
    for section in report["sections"]:
        doc.add_heading(section["heading"], level=1)
        text = format_text(section["text"], refs, style, numbers)
        for paragraph in text.split("\n"):
            if paragraph.strip():
                entry = doc.add_paragraph(paragraph.strip())
                if style == "apa" and not editorial and section_kind(section) != "abstract":
                    entry.paragraph_format.first_line_indent = Cm(1.27)
    if report.get("tables"):
        doc.add_heading("Tablas", level=1)
        for ix, item in enumerate(report["tables"], 1):
            caption = doc.add_paragraph()
            caption.add_run("Tabla " + str(ix) + ". ").bold = True
            caption.add_run(str(item.get("title", "Resultados"))).italic = True
            tab = doc.add_table(rows=1, cols=len(item["columns"]))
            tab.style = "Table Grid"
            header_row = tab.rows[0]
            repeat = OxmlElement("w:tblHeader")
            repeat.set(qn("w:val"), "true")
            header_row._tr.get_or_add_trPr().append(repeat)
            for cell, value in zip(header_row.cells, item["columns"]):
                cell.text = str(value)
                for run in cell.paragraphs[0].runs: run.bold = True
                shading = OxmlElement("w:shd")
                shading.set(qn("w:fill"), "E7EFF2" if editorial else "F0F0F0")
                cell._tc.get_or_add_tcPr().append(shading)
            for row_values in item["rows"]:
                for cell, value in zip(tab.add_row().cells, row_values):
                    cell.text = str(value)
            for note_line in visual_notes(item, refs, style, numbers):
                doc.add_paragraph(note_line)
    figures = []
    if report.get("charts"):
        doc.add_heading("Figuras", level=1)
        for ix, chart in enumerate(report["charts"], 1):
            path = chart_image(chart, output_root, ix, accent)
            figures.append((chart, path))
            fig_caption = doc.add_paragraph()
            fig_caption.add_run("Figura " + str(ix) + ". ").bold = True
            fig_caption.add_run(str(chart.get("title", "Gráfico"))).italic = True
            doc.add_picture(str(path), width=Inches(5.8))
            for note_line in visual_notes(chart, refs, style, numbers):
                doc.add_paragraph(note_line)
    if report.get("declarations"):
        doc.add_heading("Declaraciones de investigación", level=1)
        for key, label in (("ethics", "Ética"), ("funding", "Financiación"),
                           ("conflicts", "Conflictos de interés"), ("data_availability", "Disponibilidad de datos"),
                           ("registration", "Registro del estudio")):
            if report["declarations"].get(key):
                doc.add_heading(label, level=2)
                doc.add_paragraph(report["declarations"][key])
    doc.add_heading("Referencias", level=1)
    for source in ordered_refs:
        entry = doc.add_paragraph(bibliography(source, style, numbers[source["key"]]))
        if style == "apa":
            entry.paragraph_format.left_indent = Cm(1.27)
            entry.paragraph_format.first_line_indent = Cm(-1.27)
    if report.get("appendices"):
        doc.add_heading("Anexos y apéndices", level=1)
        for ix, item in enumerate(report["appendices"], 1):
            doc.add_heading("Anexo " + str(ix) + ". " + item["title"], level=2)
            for line in format_text(item["text"], refs, style, numbers).split("\n"):
                if line.strip(): doc.add_paragraph(line)
    docx_file = output_root / "informe.docx"
    doc.save(docx_file)

    font = "Helvetica"
    for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/Arial.ttf"]:
        if Path(p).is_file():
            pdfmetrics.registerFont(TTFont("ResearchUnicode", p))
            font = "ResearchUnicode"
            break
    # Prefer modern local typefaces. Offline and Windows-safe fallback is essential.
    heading_font = font
    if editorial:
        for candidate in (
            "C:/Windows/Fonts/segoeuib.ttf",
            "/usr/share/fonts/truetype/lato/Lato-Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        ):
            if Path(candidate).is_file():
                try:
                    pdfmetrics.registerFont(TTFont("ResearchHeading", candidate))
                    heading_font = "ResearchHeading"
                    break
                except Exception:
                    continue
    styles = getSampleStyleSheet()
    ink = colors.HexColor(tokens["title"]) if editorial else colors.black
    heading_ink = colors.HexColor(accent) if editorial else colors.black
    body = ParagraphStyle("RBody", parent=styles["Normal"], fontName=font,
                          fontSize=10.9 if editorial else (12 if style == "apa" else 10.5),
                          leading=17.5 if editorial else (24 if style == "apa" else 16),
                          alignment=TA_LEFT if style == "apa" or editorial else TA_JUSTIFY,
                          textColor=ink, spaceAfter=11)
    h1 = ParagraphStyle("RH1", parent=styles["Heading1"],
                        fontName=heading_font if editorial else font,
                        fontSize=17.2 if editorial else 15, leading=24, textColor=heading_ink,
                        spaceBefore=20, spaceAfter=11, keepWithNext=True)
    center = ParagraphStyle("RCenter", parent=body, alignment=TA_CENTER, fontSize=11)
    heading = ParagraphStyle("RTitle", parent=body if editorial else center,
                             fontName=heading_font if editorial else font,
                             fontSize=27 if editorial else 17,
                             leading=35 if editorial else 25, textColor=ink, spaceAfter=19)
    small = ParagraphStyle("RSmall", parent=body, fontSize=9, leading=13.5)
    caption_style = ParagraphStyle("RVisualCaption", parent=small,
                                   fontName=heading_font, fontSize=10, leading=14,
                                   textColor=ink, spaceBefore=8, spaceAfter=8,
                                   keepWithNext=True)
    cover_meta = ParagraphStyle("RCoverMeta", parent=small,
                                fontSize=10, leading=15.5, textColor=ink, spaceAfter=6)
    story = []
    def para(value, st=body):
        story.append(Paragraph(html.escape(str(value)).replace("\n", "<br/>"), st))
    if editorial:
        # Cover content starts beneath the vector masthead, with semantic hierarchy.
        story.append(Spacer(1, 112))
        if logo_file:
            with Image.open(logo_file) as picture:
                w, h = picture.size
            story.append(PdfImage(str(logo_file), width=88, height=88*h/max(1,w)))
            story.append(Spacer(1, 14))
        para(title, heading)
        story.append(HRFlowable(width=90, thickness=2.5, color=heading_ink, spaceAfter=25, hAlign="LEFT"))
        for key in ("institution", "faculty", "department", "degree"):
            if cover.get(key): para(cover[key], cover_meta)
        for person in authors: para("Autor(a): " + person, cover_meta)
        for key in ("course", "course_code", "lecturer", "advisor", "city", "country", "date"):
            if cover.get(key): para(cover[key], cover_meta)
    else:
        if logo_file:
            with Image.open(logo_file) as picture:
                w, h = picture.size
            story.append(PdfImage(str(logo_file), width=110, height=110*h/max(1,w)))
            story.append(Spacer(1, 16))
        for key in ("institution", "faculty", "department", "degree"):
            if cover.get(key): para(cover[key], center)
        story.append(Spacer(1, 46))
        para(title, heading)
        for person in authors: para("Autor(a): " + person, center)
        for key in ("course", "course_code", "lecturer", "advisor", "city", "country", "date"):
            if cover.get(key): para(cover[key], center)
    story.append(PageBreak())
    for key, label in FRONT_LABELS:
        if front.get(key):
            para(label, h1)
            for line in front[key].split("\n"):
                if line.strip(): para(line)
            story.append(PageBreak())
    if include_toc:
        para("Índice general", h1)
        toc = TableOfContents()
        toc.levelStyles = [ParagraphStyle("IndexEntry", parent=body, leftIndent=12,
                                          firstLineIndent=-10, spaceAfter=5, fontSize=10)]
        story.append(toc)
        if report.get("tables"):
            para("Índice de tablas", h1)
            for ix, item in enumerate(report["tables"], 1):
                para("Tabla " + str(ix) + ". " + str(item.get("title", "Resultados")), small)
        if report.get("charts"):
            para("Índice de figuras", h1)
            for ix, item in enumerate(report["charts"], 1):
                para("Figura " + str(ix) + ". " + str(item.get("title", "Gráfico")), small)
        story.append(PageBreak())
    if front.get("key_points"):
        para("Key Points", h1)
        for point in front["key_points"]: para("• " + point)
    if report.get("keywords"):
        para("Palabras clave: " + ", ".join(str(x) for x in report["keywords"]), small)
        story.append(Spacer(1, 8))
    for ix, section in enumerate(report["sections"]):
        heading_flowable = Paragraph(html.escape(section["heading"]), h1)
        heading_flowable._outline_entry = ("section-" + str(ix), section["heading"])
        story.append(heading_flowable)
        if editorial:
            story.append(HRFlowable(width="100%", thickness=0.7, color=colors.HexColor("#dce6e6"), spaceAfter=9))
        value = format_text(section["text"], refs, style, numbers)
        for piece in value.split("\n"):
            if piece.strip(): para(piece)
    if report.get("tables"):
        para("Tablas", h1)
        for ix, item in enumerate(report["tables"], 1):
            para("Tabla " + str(ix) + ". " + str(item.get("title", "Resultados")), caption_style)
            weights = ([0.19, 0.21, 0.29, 0.31] if len(item["columns"]) == 4 and editorial
                       else [1 / len(item["columns"])] * len(item["columns"]))
            col_widths = [content_width * weight for weight in weights]
            cell_style = ParagraphStyle("TableCell" + str(ix), parent=small,
                                        fontSize=8.5 if editorial else 8,
                                        leading=12 if editorial else 11, spaceAfter=0)
            cells = [[Paragraph(html.escape(str(value)), cell_style) for value in row]
                     for row in [item["columns"], *item["rows"]]]
            tab = LongTable(cells, colWidths=col_widths,
                            repeatRows=1, hAlign="LEFT")
            tab.setStyle(TableStyle([
                ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#e9f3f4") if editorial else colors.HexColor("#eeeeee")),
                ("TEXTCOLOR", (0,0), (-1,0), heading_ink),
                ("BOTTOMPADDING", (0,0), (-1,-1), 7),
                ("TOPPADDING", (0,0), (-1,-1), 7),
                ("VALIGN", (0,0), (-1,-1), "TOP"),
                ("LINEBELOW", (0,0), (-1,0), 0.9, heading_ink),
                ("LINEBELOW", (0,1), (-1,-1), 0.3, colors.HexColor("#cbd5db")),
            ]))
            story.append(tab)
            for note_line in visual_notes(item, refs, style, numbers):
                para(note_line, small)
            story.append(Spacer(1, 14))
    if figures:
        para("Figuras", h1)
        for ix, (chart, path) in enumerate(figures, 1):
            para(f"Figura {ix}. {chart.get('title','Gráfico')}", caption_style)
            figure_width = min(420, content_width)
            story.append(PdfImage(str(path), width=figure_width, height=figure_width * 650 / 1200))
            for note_line in visual_notes(chart, refs, style, numbers):
                para(note_line, small)
            story.append(Spacer(1, 12))
    if report.get("declarations"):
        para("Declaraciones de investigación", h1)
        for key, label in (("ethics", "Ética"), ("funding", "Financiación"),
                           ("conflicts", "Conflictos de interés"), ("data_availability", "Disponibilidad de datos"),
                           ("registration", "Registro del estudio")):
            if report["declarations"].get(key):
                para(label, h1)
                para(report["declarations"][key])
    para("Referencias", h1)
    for source in ordered_refs:
        para(bibliography(source, style, numbers[source["key"]]), small)
    if report.get("appendices"):
        para("Anexos y apéndices", h1)
        for ix, item in enumerate(report["appendices"], 1):
            para("Anexo " + str(ix) + ". " + item["title"], h1)
            para(format_text(item["text"], refs, style, numbers))

    pdf_file = output_root / "informe.pdf"
    printer = IndexedDocTemplate(str(pdf_file), pagesize=paper, rightMargin=pdf_margin,
                                 leftMargin=pdf_margin, topMargin=pdf_margin,
                                 bottomMargin=pdf_margin, title=title, author=", ".join(authors))
    rendered_pages = [0]
    def footer(canvas, document):
        rendered_pages[0] = document.page
        canvas.saveState()
        if editorial:
            canvas.setStrokeColor(heading_ink)
            canvas.setLineWidth(2)
            canvas.line(60, paper[1] - 41, paper[0] - 60, paper[1] - 41)
            canvas.setFont(font, 8)
            canvas.setFillColor(ink)
            short_title = title
            while short_title and pdfmetrics.stringWidth(short_title, font, 8) > paper[0]-120:
                short_title = short_title[:-1]
            if short_title != title: short_title = short_title.rstrip() + "…"
            canvas.drawString(60, paper[1] - 31, short_title)
            canvas.setStrokeColor(colors.HexColor("#ccd6da"))
            canvas.setLineWidth(0.5)
            canvas.line(60, 44, paper[0] - 60, 44)
        canvas.setFillColor(ink)
        canvas.setFont(font, 9)
        canvas.drawCentredString(paper[0]/2, 30, str(document.page))
        canvas.restoreState()
    def editorial_cover(canvas, document):
        """Five genuinely distinct vector compositions, without external imagery."""
        canvas.saveState()
        navy = colors.HexColor(tokens["navy"])
        accent_color = colors.HexColor(tokens["accent"])
        highlight = colors.HexColor(tokens["highlight"])
        paper_color = colors.HexColor(tokens["paper"])
        shape = tokens["shape"]
        W, H = paper
        canvas.setFillColor(paper_color)
        canvas.rect(0, 0, W, H, stroke=0, fill=1)
        if shape == "orbit":
            canvas.setFillColor(navy)
            canvas.rect(0, H-132, W, 132, stroke=0, fill=1)
            canvas.setFillColor(accent_color)
            canvas.circle(W+18, H-67, 105, stroke=0, fill=1)
            canvas.setStrokeColor(highlight)
            canvas.setLineWidth(2.5)
            canvas.line(60, H-70, 111, H-70)
            label_y, label_color = H-54, colors.white
        elif shape == "clinical":
            canvas.setFillColor(accent_color)
            canvas.rect(0, 0, 16, H, stroke=0, fill=1)
            canvas.setStrokeColor(colors.HexColor("#c9dfde"))
            canvas.setLineWidth(1.3)
            for radius in (42, 72, 102):
                canvas.circle(W-71, H-94, radius, stroke=1, fill=0)
            canvas.setFillColor(highlight)
            canvas.circle(W-71, H-94, 13, stroke=0, fill=1)
            canvas.setStrokeColor(accent_color)
            canvas.setLineWidth(4)
            canvas.line(60, H-148, 182, H-148)
            label_y, label_color = H-54, navy
        elif shape == "executive":
            canvas.setFillColor(navy)
            canvas.rect(0, H-164, W, 164, stroke=0, fill=1)
            canvas.setFillColor(highlight)
            canvas.rect(0, H-168, W, 4, stroke=0, fill=1)
            path = canvas.beginPath()
            path.moveTo(W-188, H)
            path.lineTo(W-84, H)
            path.lineTo(W-215, H-164)
            path.lineTo(W-319, H-164)
            path.close()
            canvas.setFillColor(accent_color)
            canvas.drawPath(path, stroke=0, fill=1)
            label_y, label_color = H-60, colors.white
        elif shape == "minimal":
            canvas.setStrokeColor(navy)
            canvas.setLineWidth(1.25)
            canvas.line(60, H-56, W-60, H-56)
            canvas.setFillColor(accent_color)
            canvas.rect(60, H-64, 46, 4, stroke=0, fill=1)
            label_y, label_color = H-44, navy
        elif shape == "journal":
            canvas.setFillColor(navy)
            canvas.rect(0, H-24, W, 24, fill=1, stroke=0)
            canvas.setStrokeColor(accent_color)
            canvas.setLineWidth(2)
            canvas.line(60, H-86, W-60, H-86)
            canvas.line(60, H-94, W-175, H-94)
        elif shape == "matrix":
            canvas.setFillColor(navy)
            canvas.rect(0, H-122, W, 122, fill=1, stroke=0)
            canvas.setFillColor(highlight)
            for row in range(4):
                for col in range(10):
                    canvas.circle(W-270+col*26, H-23-row*25, 3+(col+row)%3, fill=1, stroke=0)
        elif shape == "leaf":
            canvas.setFillColor(accent_color)
            canvas.rect(0, H-18, W, 18, fill=1, stroke=0)
            canvas.setStrokeColor(highlight)
            canvas.setLineWidth(5)
            canvas.circle(W-100, H-100, 74, fill=0, stroke=1)
            canvas.setFillColor(accent_color)
            canvas.ellipse(W-141, H-120, W-70, H-75, fill=1, stroke=0)
        elif shape == "waves":
            canvas.setFillColor(navy)
            canvas.rect(0, H-128, W, 128, fill=1, stroke=0)
            canvas.setStrokeColor(highlight)
            canvas.setLineWidth(4)
            for offset in range(4):
                wave = canvas.beginPath()
                wave.moveTo(W-280, H-30-offset*21)
                wave.curveTo(W-220, H-12-offset*21, W-165, H-63-offset*21, W-100, H-30-offset*21)
                wave.curveTo(W-40, H-2-offset*21, W+12, H-58-offset*21, W+60, H-30-offset*21)
                canvas.drawPath(wave, stroke=1)
        elif shape == "stack":
            canvas.setFillColor(navy)
            canvas.rect(0, H-108, W, 108, fill=1, stroke=0)
            canvas.setFillColor(highlight)
            canvas.rect(W-280, H-156, 215, 88, fill=1, stroke=0)
            canvas.setFillColor(accent_color)
            canvas.rect(W-215, H-140, 215, 88, fill=1, stroke=0)
        elif shape == "cross":
            canvas.setStrokeColor(accent_color)
            canvas.setLineWidth(5)
            canvas.line(60, H-116, W-60, H-116)
            canvas.setFillColor(highlight)
            canvas.rect(W-120, H-123, 27, 77, fill=1, stroke=0)
            canvas.rect(W-145, H-98, 77, 27, fill=1, stroke=0)
        else:  # creative: asymmetric editorial shapes
            canvas.setFillColor(navy)
            canvas.rect(0, H-102, W, 102, stroke=0, fill=1)
            canvas.setFillColor(accent_color)
            canvas.circle(W-26, H-28, 80, stroke=0, fill=1)
            canvas.setFillColor(highlight)
            canvas.circle(W-118, H-32, 35, stroke=0, fill=1)
            canvas.setStrokeColor(highlight)
            canvas.setLineWidth(4)
            canvas.line(60, H-140, 210, H-140)
            label_y, label_color = H-47, colors.white
        canvas.setStrokeColor(colors.HexColor("#dae4e4"))
        canvas.setLineWidth(0.6)
        canvas.line(60, 66, W-60, 66)
        canvas.restoreState()
    printer.multiBuild(story, onFirstPage=editorial_cover if editorial else footer,
                       onLaterPages=footer)

    chunks = []
    chunks.append("<!doctype html><html lang='es'><meta charset='utf-8'><title>"+html.escape(title)+"</title>")
    chunks.append("<style>:root{--ink:"+tokens["title"]+";--accent:"+accent+";--paper:"+tokens["paper"]+"}body{font:17px/1.65 system-ui,Georgia,serif;max-width:880px;margin:44px auto;padding:0 22px;color:var(--ink);background:var(--paper)}h1,h2{line-height:1.3}h2{color:var(--accent);border-bottom:1px solid #d9e3e6;padding-bottom:.45em}a{color:var(--accent)}nav{padding:20px 0}.ref{font-size:.88em;margin:9px 0}figure img{width:100%}table{border-collapse:collapse;width:100%;font-size:.88em;display:block;overflow-x:auto}td,th{border-bottom:1px solid #dce5ea;padding:9px;text-align:left}th{background:#e9f3f4}</style>")
    chunks.append("<h1>"+html.escape(title)+"</h1>")
    chunks.append("<p>"+html.escape(" · ".join(str(cover.get(k,"")) for k in ("institution","faculty","degree","date") if cover.get(k)))+"</p>")
    for author in authors: chunks.append("<p class='ref'>"+html.escape(author)+"</p>")
    if front.get("key_points"):
        chunks.append("<section><h2>Key Points</h2><ul>")
        for point in front["key_points"]: chunks.append("<li>"+html.escape(point)+"</li>")
        chunks.append("</ul></section>")
    for key, label in FRONT_LABELS:
        if front.get(key):
            chunks.append("<section><h2>"+html.escape(label)+"</h2><p>"+
                          html.escape(front[key]).replace("\n", "</p><p>")+"</p></section>")
    chunks.append("<nav>"+ " · ".join("<a href='#sec-"+str(i)+"'>"+html.escape(v["heading"])+"</a>" for i,v in enumerate(report["sections"]))+"</nav>")
    for i,section in enumerate(report["sections"]):
        rendered=format_text(section["text"],refs,style,numbers)
        chunks.append("<section id='sec-"+str(i)+"'><h2>"+html.escape(section["heading"])+"</h2><p>"+html.escape(rendered).replace("\n","</p><p>")+"</p></section>")
    for ix,item in enumerate(report.get("tables", []), 1):
        chunks.append("<figure><figcaption>Tabla "+str(ix)+". "+html.escape(str(item.get("title","Resultados")))+"</figcaption><table><thead><tr>")
        chunks.extend("<th scope='col'>"+html.escape(str(c))+"</th>" for c in item["columns"])
        chunks.append("</tr></thead><tbody>")
        for row in item["rows"]:
            chunks.append("<tr>"+"".join("<td>"+html.escape(str(cell))+"</td>" for cell in row)+"</tr>")
        chunks.append("</tbody></table>")
        for note_line in visual_notes(item, refs, style, numbers):
            chunks.append("<p class='ref'>"+html.escape(note_line)+"</p>")
        chunks.append("</figure>")
    for ix, (chart,path) in enumerate(figures,1):
        chunks.append("<figure><figcaption>Figura "+str(ix)+". "+html.escape(str(chart.get("title","Figura")))+"</figcaption><img alt='"+html.escape(str(chart.get("alt_text") or chart.get("title","Gráfico")))+"' src='"+html.escape(path.name)+"'>")
        for note_line in visual_notes(chart, refs, style, numbers):
            chunks.append("<p class='ref'>"+html.escape(note_line)+"</p>")
        chunks.append("</figure>")
    chunks.append("<h2>Referencias</h2><ol>")
    for src in ordered_refs:
        chunks.append("<li class='ref'>"+html.escape(bibliography(src,style,numbers[src["key"]]))+"</li>")
    chunks.append("</ol>")
    if report.get("declarations"):
        chunks.append("<section><h2>Declaraciones de investigación</h2>")
        for key, label in (("ethics", "Ética"), ("funding", "Financiación"),
                           ("conflicts", "Conflictos de interés"), ("data_availability", "Disponibilidad de datos"),
                           ("registration", "Registro del estudio")):
            if report["declarations"].get(key):
                chunks.append("<h3>"+html.escape(label)+"</h3><p>"+
                              html.escape(report["declarations"][key])+"</p>")
        chunks.append("</section>")
    if report.get("appendices"):
        chunks.append("<section><h2>Anexos y apéndices</h2>")
        for ix, item in enumerate(report["appendices"], 1):
            chunks.append("<h3>Anexo "+str(ix)+". "+html.escape(item["title"])+"</h3><p>"+
                          html.escape(format_text(item["text"],refs,style,numbers)).replace("\n","</p><p>")+"</p>")
        chunks.append("</section>")
    chunks.append("</html>")
    html_file=output_root/"informe.html"
    html_file.write_text("".join(chunks),encoding="utf-8")
    target_pages = report.get("page_plan", {}).get("target_pages")
    scope = report.get("page_plan", {}).get("scope", "all")
    page_match = target_pages is None or (scope == "all" and target_pages == rendered_pages[0])
    page_floors = {"narrative_review": 6, "systematic_review": 8, "original_research": 5,
                   "journal_manuscript": 5, "thesis": 25, "monograph": 12,
                   "research_protocol": 5, "policy_report": 5}
    editorial_minimum_pages = page_floors.get(report.get("document_type"), 5) if report.get("quality_profile", "professional") == "professional" else 0
    warnings = []
    if rendered_pages[0] < editorial_minimum_pages:
        warnings.append("El PDF quedó corto para una publicación profesional: " +
                        str(rendered_pages[0]) + " páginas; piso editorial " +
                        str(editorial_minimum_pages) + ". Continuar revisión y desarrollo.")
    if target_pages is not None and scope == "body":
        warnings.append("El límite se refiere solo al cuerpo: el PDF total no permite certificarlo automáticamente.")
    elif target_pages is not None and not page_match:
        warnings.append("La extensión solicitada no se alcanzó: PDF real " + str(rendered_pages[0]) +
                        ", objetivo " + str(target_pages) + ". No se añade contenido ficticio.")
    final_state = "REPORT_NEEDS_REVISION" if warnings else "REPORT_READY"
    result={"state":final_state,"report_id":digest,"title":title,"style":style,
            "design_preset":design_preset,
            "quality_profile": report.get("quality_profile", "professional"),
            "presentation":presentation,"document_type":report.get("document_type", "brief"),
            "quality": {"required_sections_checked": True, "submission_certified": False,
                        "bibliographic_metadata_network_verified": False, "visual_page_review": "not_performed",
                        "pagination_review_required": bool(warnings),
                        "references_style_certified": False,
                        "citation_markers_resolved": True,
                        "manuscript_word_count": sum(len(re.findall(r"\b\w+\b", sec["text"], re.UNICODE)) for sec in report["sections"])},
            "pagination": {"pdf_pages": rendered_pages[0], "requested_pages": target_pages,
                           "scope": scope, "target_met": page_match if scope == "all" else None},
            "warnings": warnings,
            "source_count":len(cited),"source_verification":"metadata_user_supplied_not_network_verified","files":{"docx":str(docx_file),"pdf":str(pdf_file),"html":str(html_file)},"output_dir":str(output_root)}
    # Preserve the exact structured project so model handoffs and revisions do not
    # need to re-run every source lookup or reconstruct the manuscript from PDF.
    project = output_root / "project.json"
    project.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    result["project_path"] = str(project)
    (output_root/"manifest.json").write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
    if not docx_file.exists() or not pdf_file.exists() or not docx_file.stat().st_size or not pdf_file.stat().st_size:
        raise RuntimeError("produced files failed existence checks")
    from zipfile import ZipFile
    with ZipFile(docx_file) as archive:
        if archive.testzip() is not None or "word/document.xml" not in archive.namelist():
            raise RuntimeError("invalid DOCX archive")
    if not pdf_file.read_bytes().startswith(b"%PDF-"):
        raise RuntimeError("PDF header is invalid")
    sys.stdout.buffer.write((json.dumps(result, ensure_ascii=False) + "\n").encode("utf-8"))

if __name__=="__main__":
    try: main()
    except Exception as error:
        sys.stderr.write("RESEARCH_PUBLISH_FAILED: "+str(error)+"\n")
        sys.exit(2)
