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
from datetime import datetime, timezone
from pathlib import Path

try:
    from docx import Document
    from docx.shared import Cm, Inches, Pt
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
    from reportlab.lib.pagesizes import A4, letter
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.utils import ImageReader
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle, Image as PdfImage
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from PIL import Image, ImageDraw, ImageFont
except ImportError as error:
    sys.stderr.write("RESEARCH_PUBLISH_DEPENDENCIES_MISSING: " + str(error) + "\n")
    sys.exit(4)

REF_RE = re.compile(r"\[@([A-Za-z0-9_-]{1,64})\]")
NAME_RE = re.compile(r"[^a-zA-Z0-9_-]+")
MAX_CONTENT = 100000

def validate(data):
    if not isinstance(data, dict):
        raise ValueError("report must be an object")
    title = data.get("title")
    sections = data.get("sections")
    refs = data.get("references")
    if not isinstance(title, str) or not (5 <= len(title.strip()) <= 240):
        raise ValueError("report.title must have 5 to 240 characters")
    if not isinstance(sections, list) or not (1 <= len(sections) <= 36):
        raise ValueError("report.sections must contain 1 to 36 entries")
    if not isinstance(refs, list) or not (1 <= len(refs) <= 200):
        raise ValueError("report.references must contain 1 to 200 verified-source entries")
    if data.get("style", "apa") not in ("apa", "vancouver"):
        raise ValueError("style must be apa or vancouver")
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
        if len(section["heading"]) > 180 or len(section["text"]) > 30000:
            raise ValueError("section exceeds safe length")
        cited.update(REF_RE.findall(section["text"]))
    if not cited or cited - keys:
        raise ValueError("each report must cite real listed source keys with [@key], unknown=" + str(sorted(cited-keys)))
    if len(json.dumps(data, ensure_ascii=False)) > MAX_CONTENT:
        raise ValueError("report payload exceeds limit")
    for entry in data.get("charts", []):
        if not isinstance(entry, dict) or entry.get("source_key") not in cited:
            raise ValueError("each data chart must cite a referenced source_key")
        vals = entry.get("values", [])
        labs = entry.get("labels", [])
        if not isinstance(labs, list) or not isinstance(vals, list) or not 1 <= len(vals) <= 15 or len(vals) != len(labs):
            raise ValueError("charts need 1-15 matched labels/values")
        if any(not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v) for v in vals):
            raise ValueError("chart values must be finite authentic numbers")
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

def chart_image(chart, folder, ordinal):
    labels = [str(s)[:32] for s in chart["labels"]]
    values = chart["values"]
    image = Image.new("RGB", (1000, 480), "white")
    d = ImageDraw.Draw(image)
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
        d.rectangle((x0, min(y, baseline), x1, max(y, baseline)), fill="#b2652b")
        d.text((x0, 400), labels[i][:max(4, int(available/10))], fill="#222222")
        d.text((x0, max(42, y-18)), str(round(value, 2)), fill="#222222")
    destination = folder / f"figure-{ordinal}.png"
    image.save(destination)
    return destination

def main():
    raw = sys.stdin.buffer.read(MAX_CONTENT * 4)
    report = json.loads(raw.decode("utf-8"))
    refs, cited = validate(report)
    style = report.get("style", "apa")
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
    normal.paragraph_format.line_spacing = 2 if style == "apa" else 1.4
    normal.paragraph_format.space_after = Pt(6)

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
    if cover.get("faculty"): center_doc(cover["faculty"])
    doc.add_paragraph("")
    center_doc(title, True, 17)
    if cover.get("author"): center_doc("Autor(es): " + str(cover["author"]))
    if cover.get("course"): center_doc("Asignatura: " + str(cover["course"]))
    if cover.get("lecturer"): center_doc("Docente: " + str(cover["lecturer"]))
    if cover.get("city"): center_doc(cover["city"])
    center_doc(cover.get("date", datetime.now(timezone.utc).date().isoformat()))
    doc.add_page_break()

    for section in report["sections"]:
        doc.add_heading(section["heading"], level=1)
        text = format_text(section["text"], refs, style, numbers)
        for paragraph in text.split("\n"):
            if paragraph.strip(): doc.add_paragraph(paragraph.strip())
    figures = []
    if report.get("charts"):
        doc.add_heading("Figuras", level=1)
        for ix, chart in enumerate(report["charts"], 1):
            path = chart_image(chart, output_root, ix)
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
    body = ParagraphStyle("RBody", parent=styles["Normal"], fontName=font, fontSize=10.5, leading=16, alignment=TA_JUSTIFY, spaceAfter=10)
    h1 = ParagraphStyle("RH1", parent=styles["Heading1"], fontName=font, fontSize=15, leading=21, spaceBefore=14, spaceAfter=11)
    center = ParagraphStyle("RCenter", parent=body, alignment=TA_CENTER, fontSize=12)
    heading = ParagraphStyle("RTitle", parent=center, fontSize=17, leading=25, spaceAfter=22)
    small = ParagraphStyle("RSmall", parent=body, fontSize=9, leading=13)
    story = []
    def para(value, st=body):
        story.append(Paragraph(html.escape(str(value)).replace("\n", "<br/>"), st))
    if logo_file:
        with Image.open(logo_file) as picture:
            w, h = picture.size
        story.append(PdfImage(str(logo_file), width=110, height=110*h/max(1,w)))
        story.append(Spacer(1, 16))
    for key in ("institution", "faculty"):
        if cover.get(key): para(cover[key], center)
    story.append(Spacer(1, 46))
    para(title, heading)
    for key in ("author", "course", "lecturer", "city", "date"):
        if cover.get(key): para(cover[key], center)
    story.append(PageBreak())
    for section in report["sections"]:
        para(section["heading"], h1)
        value = format_text(section["text"], refs, style, numbers)
        for piece in value.split("\n"):
            if piece.strip(): para(piece)
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
    printer = SimpleDocTemplate(str(pdf_file), pagesize=paper, rightMargin=60, leftMargin=60, topMargin=64, bottomMargin=62, title=title, author=str(cover.get("author","")))
    def footer(canvas, document):
        canvas.setFont(font, 9)
        canvas.drawCentredString(paper[0]/2, 32, str(document.page))
    printer.build(story, onFirstPage=footer, onLaterPages=footer)

    chunks = []
    chunks.append("<!doctype html><html lang='es'><meta charset='utf-8'><title>"+html.escape(title)+"</title>")
    chunks.append("<style>body{font:18px/1.65 Georgia,serif;max-width:760px;margin:44px auto;padding:0 22px;color:#222}h1,h2{line-height:1.3}a{color:#a45017}nav{padding:20px 0}.ref{font-size:.9em}figure img{width:100%}</style>")
    chunks.append("<h1>"+html.escape(title)+"</h1>")
    chunks.append("<p>"+html.escape(" · ".join(str(cover.get(k,"")) for k in ("institution","author","date") if cover.get(k)))+"</p>")
    chunks.append("<nav>"+ " · ".join("<a href='#sec-"+str(i)+"'>"+html.escape(v["heading"])+"</a>" for i,v in enumerate(report["sections"]))+"</nav>")
    for i,section in enumerate(report["sections"]):
        rendered=format_text(section["text"],refs,style,numbers)
        chunks.append("<section id='sec-"+str(i)+"'><h2>"+html.escape(section["heading"])+"</h2><p>"+html.escape(rendered).replace("\n","</p><p>")+"</p></section>")
    for ix, (chart,path) in enumerate(figures,1):
        chunks.append("<figure><figcaption>"+html.escape(str(chart.get("title","Figura")))+"</figcaption><img src='"+html.escape(path.name)+"'></figure>")
    chunks.append("<h2>Referencias</h2><ol>")
    for src in ordered_refs:
        chunks.append("<li class='ref'>"+html.escape(bibliography(src,style,numbers[src["key"]]))+"</li>")
    chunks.append("</ol></html>")
    html_file=output_root/"informe.html"
    html_file.write_text("".join(chunks),encoding="utf-8")
    result={"state":"REPORT_READY","report_id":digest,"title":title,"style":style,"source_count":len(cited),"source_verification":"metadata_user_supplied_not_network_verified","files":{"docx":str(docx_file),"pdf":str(pdf_file),"html":str(html_file)},"output_dir":str(output_root)}
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
