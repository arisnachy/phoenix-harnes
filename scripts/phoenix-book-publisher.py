#!/usr/bin/env python3
"""Phoenix book interior: real typeset PDF, table of contents and extraction-verified pages.

stdin: one JSON object with title, author, chapters, output. stdout: one JSON receipt.
No network, generated claims of royalties, publication, covers or originality.
"""
import contextlib
import html
import json
import os
import re
import sys
from pathlib import Path

try:
    import fitz
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
    from reportlab.lib.units import inch
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import BaseDocTemplate, Frame, KeepTogether, PageBreak, PageTemplate, Paragraph, Spacer
    from reportlab.platypus.tableofcontents import TableOfContents
except ImportError as exc:
    sys.stderr.write("BOOK_PUBLISH_DEPENDENCIES_MISSING: " + str(exc) + "\n")
    sys.exit(4)

MAX_WORDS = 1_000_000
PAGE = (6 * inch, 9 * inch)
INK = colors.HexColor("#202021")
ACCENT = colors.HexColor("#563d34")


def font_choice():
    choices = [
        os.environ.get("PHOENIX_BOOK_TTF", ""),
        "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
        "C:/Windows/Fonts/georgia.ttf",
        "C:/Windows/Fonts/times.ttf",
    ]
    for candidate in choices:
        if candidate and Path(candidate).is_file():
            pdfmetrics.registerFont(TTFont("PhoenixEditorial", str(candidate)))
            return "PhoenixEditorial"
    raise ValueError("No hay fuente TTF serif Unicode; define PHOENIX_BOOK_TTF.")


def validate(data):
    if not isinstance(data, dict):
        raise ValueError("Libro JSON debe ser objeto.")
    title, author, chapters = data.get("title"), data.get("author"), data.get("chapters")
    if not isinstance(title, str) or not 3 <= len(title.strip()) <= 180:
        raise ValueError("Título inválido.")
    if not isinstance(author, str) or not 2 <= len(author.strip()) <= 160:
        raise ValueError("Autor inválido.")
    if not isinstance(chapters, list) or not 1 <= len(chapters) <= 500:
        raise ValueError("Cantidad de capítulos inválida.")
    if data.get("trim", "6x9") != "6x9":
        raise ValueError("Este renderizador solo admite interior 6x9 pulgadas.")
    if data.get("lang", "es") not in ("es", "en", "fr", "pt", "de", "it"):
        raise ValueError("Idioma no compatible con este renderizador.")
    count = 0
    for index, chapter in enumerate(chapters):
        if not isinstance(chapter, dict) or chapter.get("number") != index + 1:
            raise ValueError("Capítulos consecutivos obligatorios.")
        text, heading = chapter.get("text"), chapter.get("title")
        if not isinstance(text, str) or not text.strip() or not isinstance(heading, str) or not heading.strip():
            raise ValueError("Capítulo vacío o sin encabezado.")
        count += len(re.findall(r"\b[\wÀ-ÿ]+\b", text))
        if count > MAX_WORDS:
            raise ValueError("Libro supera el máximo de palabras.")
    output = data.get("output")
    if not isinstance(output, str) or not Path(output).is_absolute() or not output.endswith(".pdf"):
        raise ValueError("Ruta PDF debe ser absoluta.")
    return title.strip(), author.strip(), chapters, output, count


class BookDoc(BaseDocTemplate):
    def __init__(self, filename, font_name, book_title, author):
        super().__init__(filename, pagesize=PAGE, leftMargin=0.70 * inch,
                         rightMargin=0.63 * inch, topMargin=0.72 * inch,
                         bottomMargin=0.70 * inch, pageCompression=1,
                         title=book_title, author=author)
        self.book_title, self.book_author, self.font_name = book_title, author, font_name
        frame = Frame(self.leftMargin, self.bottomMargin,
                      PAGE[0] - self.leftMargin - self.rightMargin,
                      PAGE[1] - self.topMargin - self.bottomMargin,
                      id="content", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        self.addPageTemplates(PageTemplate(id="book", frames=[frame], onPage=self.decorate))

    def decorate(self, canvas, doc):
        if doc.page <= 1:
            return
        canvas.saveState()
        canvas.setFillColor(ACCENT)
        canvas.setFont(self.font_name, 7.7)
        canvas.drawCentredString(PAGE[0] / 2, PAGE[1] - 0.48 * inch,
                                (self.book_title if doc.page % 2 else self.book_author)[:65])
        canvas.setFillColor(INK)
        canvas.drawCentredString(PAGE[0] / 2, 0.41 * inch, str(doc.page))
        canvas.restoreState()

    def afterFlowable(self, flowable):
        if getattr(flowable, "_phoenix_chapter", None):
            title, key = flowable._phoenix_chapter
            self.canv.bookmarkPage(key)
            self.notify("TOCEntry", (0, title, self.page, key))


def render(data):
    title, author, chapters, output, words = validate(data)
    font = font_choice()
    out = Path(output)
    out.parent.mkdir(parents=True, exist_ok=True)
    doc = BookDoc(output, font, title, author)
    normal = ParagraphStyle("Body", fontName=font, fontSize=10.3, leading=15.1,
                            textColor=INK, alignment=TA_JUSTIFY,
                            firstLineIndent=13, spaceAfter=5,
                            allowWidows=0, allowOrphans=0, splitLongWords=False)
    heading = ParagraphStyle("ChapterTitle", fontName=font, fontSize=17, leading=23,
                             textColor=ACCENT, alignment=TA_CENTER, spaceAfter=22,
                             keepWithNext=True)
    masthead = ParagraphStyle("Masthead", fontName=font, fontSize=24, leading=29,
                              textColor=INK, alignment=TA_CENTER)
    author_style = ParagraphStyle("Author", fontName=font, fontSize=12, leading=18,
                                  textColor=ACCENT, alignment=TA_CENTER)
    toc_style = ParagraphStyle("TOC", fontName=font, fontSize=9.5, leading=17,
                               leftIndent=8, firstLineIndent=0, rightIndent=12, spaceAfter=4)
    toc = TableOfContents()
    toc.levelStyles = [toc_style]
    toc.dotsMinLevel = 0
    story = [Spacer(1, 2.1 * inch), Paragraph(html.escape(title), masthead),
             Spacer(1, .50 * inch), Paragraph(html.escape(author), author_style),
             PageBreak(), Spacer(1, .40 * inch),
             Paragraph("Índice" if data.get("lang", "es") == "es" else "Contents", heading),
             Spacer(1, .2 * inch), toc]
    for chapter in chapters:
        label = chapter["title"].strip()
        story.append(PageBreak())
        chapter_title = Paragraph(html.escape(label), heading)
        chapter_title._phoenix_chapter = (label, "chapter-" + str(chapter["number"]))
        story.append(chapter_title)
        text = chapter["text"].strip()
        for raw in re.split(r"\n\s*\n", text):
            clean = re.sub(r"^#{1,6}\s*", "", raw.strip())
            if not clean:
                continue
            line = " ".join(clean.split())
            story.append(Paragraph(html.escape(line), normal))
    doc.multiBuild(story, maxPasses=5)
    with fitz.open(output) as pdf:
        if pdf.page_count < 3:
            raise ValueError("PDF sin páginas suficientes.")
        extracted = "\n".join(page.get_text() for page in pdf)
        for chapter in chapters:
            if chapter["title"].strip() not in extracted:
                raise ValueError("Falta capítulo en extracción PDF: " + str(chapter["number"]))
        if title not in extracted or author not in extracted:
            raise ValueError("Portadilla no verificable en PDF.")
        pages = pdf.page_count
    return {"pdf_pages": pages, "chapters_verified": len(chapters),
            "source_words": words, "trim": "6x9", "file_bytes": out.stat().st_size,
            "text_extraction_verified": True, "visual_inspection_verified": False,
            "cover_and_spine_verified": False, "print_release_approved": False}


if __name__ == "__main__":
    try:
        payload = json.load(sys.stdin)
        # ReportLab multiBuild emits progress to stdout in verbose environments.
        # Keep stdout a single machine-readable JSON receipt on Linux and Windows.
        with contextlib.redirect_stdout(sys.stderr):
            result = render(payload)
        print(json.dumps({"ok": True, "result": result}, ensure_ascii=False))
    except Exception as exc:
        sys.stderr.write("BOOK_PUBLISH_ERROR: " + str(exc)[:400] + "\n")
        sys.exit(2)
