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

REF_RE = re.compile(r"\[@([A-Za-z0-9_-]{1,64})\]")
NAME_RE = re.compile(r"[^a-zA-Z0-9_-]+")
MAX_CONTENT = 1000000
PRESENTATIONS = ("academic", "editorial", "hybrid")
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
    heading = re.sub(r"^(?:capitulo\\s+(?:[ivxlcdm]+|[0-9]+)[. :]*)|^(?:[0-9]+[. )-]*)", "", heading).strip()
    for kind, variants in SECTION_ALIASES.items():
        if heading in variants:
            return kind
    return None


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
    if data.get("style", "apa") not in ("apa", "apa7", "vancouver"):
        raise ValueError("style must be apa, apa7 or vancouver")
    if data.get("presentation", "academic") not in PRESENTATIONS:
        raise ValueError("presentation must be academic, editorial or hybrid")
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
        cited.update(REF_RE.findall(section["text"]))
    if not cited or cited - keys:
        raise ValueError("each report must cite registered source keys with [@key], unknown=" + str(sorted(cited-keys)))
    document_type = data.get("document_type", "brief")
    section_kinds = {section_kind(section) for section in sections}
    missing = [kind for kind in REQUIRED_SECTIONS.get(document_type, ()) if kind not in section_kinds]
    if missing:
        raise ValueError(document_type + " requires missing sections: " + ", ".join(missing))
    if document_type == "systematic_review" and not data.get("systematic_review_evidence"):
        raise ValueError("systematic_review requires documented screening and extraction evidence")
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
    if not isinstance(data.get("charts", []), list) or len(data.get("charts", [])) > 20:
        raise ValueError("charts must be an array of up to 20 entries")
    for entry in data.get("charts", []):
        if not isinstance(entry, dict) or entry.get("source_key") not in cited:
            raise ValueError("each data chart must cite a referenced source_key")
        kind = entry.get("type", "bar")
        if kind not in ("bar", "forest"):
            raise ValueError("chart type must be bar or forest")
        vals = entry.get("values", [])
        labs = entry.get("labels", [])
        if not isinstance(labs, list) or not isinstance(vals, list) or not 1 <= len(vals) <= 15 or len(vals) != len(labs):
            raise ValueError("charts need 1-15 matched labels/values")
        if any(not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v) for v in vals):
            raise ValueError("chart values must be finite authentic numbers")
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
    author = ref["authors"].split(",")[0].strip()
    return "(" + author + ", " + ref["year"] + ")"

def format_text(value, refs, style, order):
    return REF_RE.sub(lambda match: citation_string(match.group(1), refs, style, order), value)

def bibliography(ref, style, number):
    authors = ref["authors"].strip()
    year = ref["year"]
    title = ref["title"].strip()
    journal = ref.get("journal", "").strip()
    doi = ref.get("doi", "").strip()
    url = "https://doi.org/" + doi if doi else ref["url"]
    if style == "vancouver":
        return f"{number}. {authors}. {title}. {journal}. {year}. {url}"
    return f"{authors} ({year}). {title}. {journal}. {url}"

def chart_image(chart, folder, ordinal, accent="#087783"):
    labels = [str(s)[:32] for s in chart["labels"]]
    values = chart["values"]
    image = Image.new("RGB", (1000, 480), "white")
    d = ImageDraw.Draw(image)
    if chart.get("type") == "forest":
        lows, highs = chart["ci_low"], chart["ci_high"]
        left, right = min(lows), max(highs)
        if left == right: right = left + 1
        pad = (right - left) * 0.10
        left, right = left - pad, right + pad
        x_axis = lambda value: 275 + (value - left) / (right - left) * 450
        null_value = chart.get("null_value", 1)
        if isinstance(null_value, (int, float)) and left <= null_value <= right:
            x = x_axis(null_value)
            d.line((x, 35, x, 430), fill="#98abb1", width=2)
        for i, (label, value, lo, hi) in enumerate(zip(labels, values, lows, highs)):
            y = 55 + i * (350 / max(1, len(values) - 1))
            d.text((15, int(y - 8)), label[:30], fill="#1d3040")
            d.line((x_axis(lo), y, x_axis(hi), y), fill=accent, width=4)
            d.line((x_axis(lo), y-6, x_axis(lo), y+6), fill=accent, width=2)
            d.line((x_axis(hi), y-6, x_axis(hi), y+6), fill=accent, width=2)
            x = x_axis(value)
            d.rectangle((x-6, y-6, x+6, y+6), fill=accent)
            d.text((775, int(y - 19)), f"{value:.2f} [{lo:.2f}, {hi:.2f}]", fill="#1d3040")
        destination = folder / f"figure-{ordinal}.png"
        image.save(destination)
        return destination
    low, high = min(0, min(values)), max(0, max(values))
    if high <= low: high = low + 1
    baseline = 390
    d.line((85, 45, 85, baseline), fill="#333333", width=3)
    d.line((85, baseline, 960, baseline), fill="#333333", width=3)
    available = 830 / len(values)
    for i, value in enumerate(values):
        x0 = 90 + available * i + 12
        x1 = 90 + available * (i + 1) - 12
        y = 60 + (high - value) / (high-low) * 330
        d.rectangle((x0, min(y, baseline), x1, max(y, baseline)), fill=accent)
        d.text((x0, 400), labels[i][:max(4, int(available/10))], fill="#222222")
        d.text((x0, max(42, y-18)), str(round(value, 2)), fill="#222222")
    destination = folder / f"figure-{ordinal}.png"
    image.save(destination)
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
    presentation = report.get("presentation", "academic")
    editorial = presentation in ("editorial", "hybrid")
    accent = "#087783" if presentation == "hybrid" else "#a52d37"
    first_order = []
    for section in report["sections"]:
        for key in REF_RE.findall(section["text"]):
            if key not in first_order: first_order.append(key)
    numbers = {key: i+1 for i, key in enumerate(first_order)}
    ordered_refs = [refs[key] for key in (first_order if style == "vancouver" else sorted(cited, key=lambda k: (refs[k]["authors"], refs[k]["year"])))]
    digest = hashlib.sha256(raw).hexdigest()[:16]
    output_root = Path.home() / ".dsh" / "research-reports" / digest
    output_root.mkdir(parents=True, exist_ok=True)
    title = report["title"].strip()
    cover = report.get("cover") if isinstance(report.get("cover"), dict) else {}
    front = report.get("front_matter", {})
    academic_work = report.get("document_type") in ("monograph", "thesis", "research_protocol")
    include_toc = report.get("table_of_contents", academic_work)
    authors = cover_authors(cover)
    paper = A4 if report.get("paper", "A4") == "A4" else letter
    doc = Document()
    sec = doc.sections[0]
    sec.page_height = Cm(29.7) if paper == A4 else Inches(11)
    sec.page_width = Cm(21) if paper == A4 else Inches(8.5)
    sec.top_margin = sec.bottom_margin = Cm(2.54)
    sec.left_margin = sec.right_margin = Cm(2.54)
    normal = doc.styles["Normal"]
    normal.font.name = "Times New Roman"
    normal.font.size = Pt(12)
    normal.paragraph_format.line_spacing = (1.38 if editorial else (2 if style == "apa" else 1.4))
    normal.paragraph_format.space_after = Pt(7 if editorial else 6)
    if editorial:
        normal.font.name = "Aptos"
        normal.font.size = Pt(11)
        heading_style = doc.styles["Heading 1"]
        heading_style.font.name = "Aptos Display"
        heading_style.font.color.rgb = RGBColor(8, 119, 131) if presentation == "hybrid" else RGBColor(165, 45, 55)

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
    if editorial: center_doc("PHOENIX  |  INVESTIGACIÓN CIENTÍFICA", True, 10)
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
            for value in front[key].split("\\n"):
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
    if report.get("keywords"):
        doc.add_paragraph("Palabras clave: " + ", ".join(str(x) for x in report["keywords"]))
    for section in report["sections"]:
        doc.add_heading(section["heading"], level=1)
        text = format_text(section["text"], refs, style, numbers)
        for paragraph in text.split("\n"):
            if paragraph.strip(): doc.add_paragraph(paragraph.strip())
    if report.get("tables"):
        doc.add_heading("Tablas", level=1)
        for ix, item in enumerate(report["tables"], 1):
            doc.add_paragraph("Tabla " + str(ix) + ". " + str(item.get("title", "Resultados")) +
                              " — Fuente: " + citation_string(item["source_key"], refs, style, numbers))
            tab = doc.add_table(rows=1, cols=len(item["columns"]))
            tab.style = "Table Grid"
            for cell, value in zip(tab.rows[0].cells, item["columns"]):
                cell.text = str(value)
            for row_values in item["rows"]:
                for cell, value in zip(tab.add_row().cells, row_values):
                    cell.text = str(value)
            if item.get("note"): doc.add_paragraph("Nota: " + str(item["note"]))
    figures = []
    if report.get("charts"):
        doc.add_heading("Figuras", level=1)
        for ix, chart in enumerate(report["charts"], 1):
            path = chart_image(chart, output_root, ix, accent)
            figures.append((chart, path))
            doc.add_paragraph(f"Figura {ix}. {chart.get('title','Gráfico')} — Fuente: {citation_string(chart['source_key'],refs,style,numbers)}")
            doc.add_picture(str(path), width=Inches(5.8))
    doc.add_heading("Referencias", level=1)
    for source in ordered_refs:
        doc.add_paragraph(bibliography(source, style, numbers[source["key"]]))
    docx_file = output_root / "informe.docx"
    doc.save(docx_file)

    font = "Helvetica"
    for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/Arial.ttf"]:
        if Path(p).is_file():
            pdfmetrics.registerFont(TTFont("ResearchUnicode", p))
            font = "ResearchUnicode"
            break
    styles = getSampleStyleSheet()
    ink = colors.HexColor("#1d3040") if editorial else colors.black
    heading_ink = colors.HexColor(accent) if editorial else colors.black
    body = ParagraphStyle("RBody", parent=styles["Normal"], fontName=font,
                          fontSize=10.7 if editorial else 10.5, leading=17 if editorial else 16,
                          alignment=TA_LEFT if editorial else TA_JUSTIFY, textColor=ink, spaceAfter=10)
    h1 = ParagraphStyle("RH1", parent=styles["Heading1"], fontName=font,
                        fontSize=15.5 if editorial else 15, leading=22, textColor=heading_ink,
                        spaceBefore=17, spaceAfter=11, keepWithNext=True)
    center = ParagraphStyle("RCenter", parent=body, alignment=TA_CENTER, fontSize=12)
    heading = ParagraphStyle("RTitle", parent=center, fontSize=23 if editorial else 17,
                             leading=31 if editorial else 25, textColor=ink, spaceAfter=22)
    small = ParagraphStyle("RSmall", parent=body, fontSize=9, leading=13)
    story = []
    def para(value, st=body):
        story.append(Paragraph(html.escape(str(value)).replace("\n", "<br/>"), st))
    if logo_file:
        with Image.open(logo_file) as picture:
            w, h = picture.size
        story.append(PdfImage(str(logo_file), width=110, height=110*h/max(1,w)))
        story.append(Spacer(1, 16))
    for key in ("institution", "faculty", "department", "degree"):
        if cover.get(key): para(cover[key], center)
    story.append(Spacer(1, 40 if editorial else 46))
    if editorial:
        para("PHOENIX  |  INFORME DE INVESTIGACIÓN", center)
        story.append(HRFlowable(width="100%", thickness=3, color=heading_ink, spaceAfter=20))
    para(title, heading)
    for person in authors: para("Autor(a): " + person, center)
    for key in ("course", "course_code", "lecturer", "advisor", "city", "country", "date"):
        if cover.get(key): para(cover[key], center)
    story.append(PageBreak())
    for key, label in FRONT_LABELS:
        if front.get(key):
            para(label, h1)
            for line in front[key].split("\\n"):
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
    if report.get("keywords"):
        para("Palabras clave: " + ", ".join(str(x) for x in report["keywords"]), small)
        story.append(Spacer(1, 8))
    for ix, section in enumerate(report["sections"]):
        heading_flowable = Paragraph(html.escape(section["heading"]), h1)
        heading_flowable._outline_entry = ("section-" + str(ix), section["heading"])
        story.append(heading_flowable)
        value = format_text(section["text"], refs, style, numbers)
        for piece in value.split("\n"):
            if piece.strip(): para(piece)
    if report.get("tables"):
        para("Tablas", h1)
        content_width = paper[0] - 120
        for ix, item in enumerate(report["tables"], 1):
            para("Tabla " + str(ix) + ". " + str(item.get("title", "Resultados")) + " — Fuente: " +
                 citation_string(item["source_key"], refs, style, numbers), small)
            col_width = content_width / len(item["columns"])
            cell_style = ParagraphStyle("TableCell" + str(ix), parent=small, fontSize=8, leading=11, spaceAfter=0)
            cells = [[Paragraph(html.escape(str(value)), cell_style) for value in row]
                     for row in [item["columns"], *item["rows"]]]
            tab = LongTable(cells, colWidths=[col_width] * len(item["columns"]),
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
            if item.get("note"): para("Nota: " + str(item["note"]), small)
            story.append(Spacer(1, 14))
    if figures:
        para("Figuras", h1)
        for ix, (chart, path) in enumerate(figures, 1):
            para(f"Figura {ix}. {chart.get('title','Gráfico')} — Fuente: {citation_string(chart['source_key'],refs,style,numbers)}", small)
            story.append(PdfImage(str(path), width=450, height=216))
            story.append(Spacer(1, 12))
    para("Referencias", h1)
    for source in ordered_refs:
        para(bibliography(source, style, numbers[source["key"]]), small)

    pdf_file = output_root / "informe.pdf"
    printer = IndexedDocTemplate(str(pdf_file), pagesize=paper, rightMargin=60, leftMargin=60, topMargin=64, bottomMargin=62, title=title, author=", ".join(authors))
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
            canvas.drawString(60, paper[1] - 31, "PHOENIX  /  INVESTIGACIÓN")
            canvas.setStrokeColor(colors.HexColor("#ccd6da"))
            canvas.setLineWidth(0.5)
            canvas.line(60, 44, paper[0] - 60, 44)
        canvas.setFillColor(ink)
        canvas.setFont(font, 9)
        canvas.drawCentredString(paper[0]/2, 30, str(document.page))
        canvas.restoreState()
    printer.multiBuild(story, onFirstPage=footer, onLaterPages=footer)

    chunks = []
    chunks.append("<!doctype html><html lang='es'><meta charset='utf-8'><title>"+html.escape(title)+"</title>")
    chunks.append("<style>body{font:17px/1.65 system-ui,Georgia,serif;max-width:880px;margin:44px auto;padding:0 22px;color:#203043}h1,h2{line-height:1.3}h2{color:"+accent+";border-bottom:1px solid #d9e3e6;padding-bottom:.45em}a{color:"+accent+"}nav{padding:20px 0}.ref{font-size:.88em;margin:9px 0}figure img{width:100%}table{border-collapse:collapse;width:100%;font-size:.88em;display:block;overflow-x:auto}td,th{border-bottom:1px solid #dce5ea;padding:9px;text-align:left}th{background:#e9f3f4}</style>")
    chunks.append("<h1>"+html.escape(title)+"</h1>")
    chunks.append("<p>"+html.escape(" · ".join(str(cover.get(k,"")) for k in ("institution","author","date") if cover.get(k)))+"</p>")
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
        chunks.append("</tbody></table><p class='ref'>Fuente: "+html.escape(citation_string(item["source_key"], refs, style, numbers))+"</p></figure>")
    for ix, (chart,path) in enumerate(figures,1):
        chunks.append("<figure><figcaption>Figura "+str(ix)+". "+html.escape(str(chart.get("title","Figura")))+"</figcaption><img alt='"+html.escape(str(chart.get("title","Gráfico")))+"' src='"+html.escape(path.name)+"'></figure>")
    chunks.append("<h2>Referencias</h2><ol>")
    for src in ordered_refs:
        chunks.append("<li class='ref'>"+html.escape(bibliography(src,style,numbers[src["key"]]))+"</li>")
    chunks.append("</ol></html>")
    html_file=output_root/"informe.html"
    html_file.write_text("".join(chunks),encoding="utf-8")
    result={"state":"REPORT_READY","report_id":digest,"title":title,"style":style,
            "presentation":presentation,"document_type":report.get("document_type", "brief"),
            "quality": {"required_sections_checked": True, "submission_certified": False,
                        "bibliographic_metadata_network_verified": False, "visual_page_review": "not_performed"},
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
    print(json.dumps(result,ensure_ascii=False))

if __name__=="__main__":
    try: main()
    except Exception as error:
        sys.stderr.write("RESEARCH_PUBLISH_FAILED: "+str(error)+"\n")
        sys.exit(2)
