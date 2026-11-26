"""Optional professional Office engines for PHOENIX's existing agent runtime.

No network, shell execution, or dependency installation. Run within the normal
workspace/approval boundary. Specs are local JSON; output must be a new file.
"""
import argparse
import importlib.util
import json
import math
import re
import shutil
import tempfile
from pathlib import Path

ENGINES = {"docx": "docx", "xlsx": "openpyxl", "pptx": "pptx"}
MAX_SPEC = 4_000_000


def doctor():
    return {"engines": {kind: importlib.util.find_spec(module) is not None
                        for kind, module in ENGINES.items()},
            "converters": {name: bool(shutil.which(name))
                           for name in ("pandoc", "soffice")}}


def text(value, limit=12000):
    if not isinstance(value, str) or len(value) > limit:
        raise ValueError("Invalid text")
    return value


def sequence(value, limit):
    if not isinstance(value, list) or len(value) > limit:
        raise ValueError("Invalid or oversized list")
    return value


def document(spec, path):
    from docx import Document
    from docx.shared import Inches, Pt, RGBColor

    doc = Document()
    sec = doc.sections[0]
    sec.top_margin = sec.bottom_margin = Inches(0.85)
    sec.left_margin = sec.right_margin = Inches(0.9)
    normal = doc.styles["Normal"]
    normal.font.name = "Calibri"
    normal.font.size = Pt(11)
    normal.paragraph_format.space_after = Pt(7)
    for level in (1, 2, 3):
        style = doc.styles[f"Heading {level}"]
        style.font.color.rgb = RGBColor.from_string("23435E")
    doc.add_heading(text(spec["title"], 240), 0)
    for section in sequence(spec.get("sections", []), 100):
        if "heading" in section:
            doc.add_heading(text(section["heading"], 240), 1)
        for para in sequence(section.get("paragraphs", []), 200):
            doc.add_paragraph(text(para))
        for bullet in sequence(section.get("bullets", []), 100):
            doc.add_paragraph(text(bullet), style="List Bullet")
        for table in sequence(section.get("tables", []), 20):
            headers = sequence(table["headers"], 20)
            if not headers:
                raise ValueError("Table requires headers")
            native = doc.add_table(rows=1, cols=len(headers))
            native.style = "Light Shading Accent 1"
            for cell, value in zip(native.rows[0].cells, headers):
                cell.text = text(value, 240)
            for row in sequence(table["rows"], 500):
                if len(sequence(row, 20)) != len(headers):
                    raise ValueError("Table row width mismatch")
                for cell, value in zip(native.add_row().cells, row):
                    cell.text = text(value, 2000)
    doc.save(path)
    reopened = Document(path)
    return {"paragraphs": len(reopened.paragraphs), "tables": len(reopened.tables)}


# Permit ordinary spreadsheet formulas but not external references, file/URL
# calls or DDE. Literal strings (including leading =) remain literal.
FORMULA = re.compile(r"^=[A-Za-z0-9_.$()+*/,:<>= !%-]{1,500}$")
UNSAFE_FORMULA = re.compile(r"\b(?:HYPERLINK|WEBSERVICE|RTD|DDE|EXEC|CALL|REGISTER|INDIRECT|IMAGE|IMPORT\w*)\s*\(", re.I)


def workbook(spec, path):
    from openpyxl import Workbook, load_workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.chart import BarChart, Reference
    from openpyxl.utils import get_column_letter

    sheets = sequence(spec["sheets"], 30)
    if not sheets:
        raise ValueError("Workbook requires sheets")
    book = Workbook()
    book.remove(book.active)
    total_rows = 0
    for data in sheets:
        title = text(data["name"], 31)
        if not title or title.casefold() in [x.casefold() for x in book.sheetnames]:
            raise ValueError("Duplicate or empty sheet")
        ws = book.create_sheet(title)
        headers = sequence(data["headers"], 100)
        if not headers:
            raise ValueError("Sheet requires headers")
        for col, header in enumerate(headers, 1):
            cell = ws.cell(1, col, text(header, 200))
            cell.data_type = "s"
            cell.font = Font(name="Calibri", bold=True, color="FFFFFF")
            cell.fill = PatternFill("solid", fgColor="23435E")
            cell.alignment = Alignment(wrap_text=True)
            ws.column_dimensions[get_column_letter(col)].width = min(45, max(14, len(header) + 3))
        for idx, row in enumerate(sequence(data["rows"], 20000), 2):
            if len(sequence(row, 100)) != len(headers):
                raise ValueError("Sheet row width mismatch")
            for col, value in enumerate(row, 1):
                cell = ws.cell(idx, col)
                if isinstance(value, dict):
                    formula = text(value.get("formula"), 501)
                    if not FORMULA.fullmatch(formula) or UNSAFE_FORMULA.search(formula):
                        raise ValueError("Unsupported or unsafe formula")
                    cell.value = formula
                elif isinstance(value, str):
                    cell.value = text(value, 30000)
                    cell.data_type = "s"
                elif value is None or isinstance(value, bool):
                    cell.value = value
                elif isinstance(value, (int, float)) and math.isfinite(value):
                    cell.value = value
                    cell.number_format = "#,##0.00" if isinstance(value, float) else "#,##0"
                else:
                    raise ValueError("Invalid cell value")
                if idx % 2 == 0:
                    cell.fill = PatternFill("solid", fgColor="EDF3F7")
            total_rows += 1
            if total_rows > 50000:
                raise ValueError("Workbook row limit exceeded")
        ws.freeze_panes = "A2"
        ws.auto_filter.ref = ws.dimensions
        for chart in sequence(data.get("charts", []), 6):
            category, value = chart["category_column"], chart["value_column"]
            if not isinstance(category, int) or not isinstance(value, int) or not (1 <= category <= len(headers) and 1 <= value <= len(headers)) or ws.max_row < 2:
                raise ValueError("Invalid chart columns")
            native = BarChart()
            native.title = text(chart["title"], 180)
            native.add_data(Reference(ws, min_col=value, min_row=1, max_row=ws.max_row), titles_from_data=True)
            native.set_categories(Reference(ws, min_col=category, min_row=2, max_row=ws.max_row))
            ws.add_chart(native, get_column_letter(len(headers) + 2) + str(2 + 16 * len(ws._charts)))
    book.save(path)
    check = load_workbook(path, read_only=True, data_only=False, keep_links=False)
    try:
        return {"sheets": check.sheetnames, "data_rows": total_rows, "formula_values_recalculated": False}
    finally:
        check.close()


def presentation(spec, path):
    from pptx import Presentation
    from pptx.util import Inches, Pt
    from pptx.dml.color import RGBColor

    deck = Presentation()
    deck.slide_width, deck.slide_height = Inches(13.333), Inches(7.5)
    slides = sequence(spec["slides"], 100)
    if not slides:
        raise ValueError("Presentation requires slides")
    for i, entry in enumerate(slides, 1):
        slide = deck.slides.add_slide(deck.slide_layouts[6])
        bg = slide.background.fill
        bg.solid()
        bg.fore_color.rgb = RGBColor.from_string("F7F9FB")
        title = slide.shapes.add_textbox(Inches(.65), Inches(.45), Inches(12), Inches(1.1))
        tf = title.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        p.text = text(entry["title"], 120)
        p.font.size, p.font.bold = Pt(32), True
        p.font.color.rgb = RGBColor.from_string("23435E")
        body = slide.shapes.add_textbox(Inches(.85), Inches(1.75), Inches(11.65), Inches(4.9))
        body.text_frame.word_wrap = True
        for n, line in enumerate(sequence(entry.get("bullets", []), 6)):
            p = body.text_frame.paragraphs[0] if n == 0 else body.text_frame.add_paragraph()
            p.text = "• " + text(line, 170)
            p.font.size = Pt(22)
            p.space_after = Pt(12)
        foot = slide.shapes.add_textbox(Inches(.7), Inches(6.9), Inches(12), Inches(.35))
        p = foot.text_frame.paragraphs[0]
        p.text = f"PHOENIX  |  {i:02d}"
        p.font.size = Pt(11)
        p.font.color.rgb = RGBColor.from_string("64748B")
    deck.save(path)
    return {"slides": len(Presentation(path).slides)}


BUILDERS = {"docx": document, "xlsx": workbook, "pptx": presentation}


def build(spec_path, output):
    source = Path(spec_path)
    target = Path(output)
    kind = target.suffix.lower().lstrip(".")
    if kind not in BUILDERS:
        raise ValueError("Supported output: .docx, .xlsx, .pptx")
    if target.exists():
        raise FileExistsError("Refusing to overwrite an existing file")
    if not doctor()["engines"][kind]:
        raise RuntimeError(f"Office engine {ENGINES[kind]} not available in this Python runtime")
    with source.open("rb") as handle:
        raw = handle.read(MAX_SPEC + 1)
    if len(raw) > MAX_SPEC:
        raise ValueError("Spec too large")
    spec = json.loads(raw)
    # Independent library reopen succeeds before publishing a new artifact.
    with tempfile.TemporaryDirectory(prefix="phoenix-office-") as root:
        draft = Path(root) / ("draft." + kind)
        evidence = BUILDERS[kind](spec, draft)
        size = draft.stat().st_size
        if size > 30_000_000:
            raise ValueError("Artifact too large")
        with draft.open("rb") as incoming, target.open("xb") as outgoing:
            try:
                shutil.copyfileobj(incoming, outgoing)
            except OSError:
                outgoing.close()
                target.unlink(missing_ok=True)
                raise
    return {"format": kind, "path": str(target.resolve()), "bytes": size,
            "structure_reopened": True, "visual_render_verified": False, **evidence}


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    commands = cli.add_subparsers(dest="command", required=True)
    commands.add_parser("doctor")
    create = commands.add_parser("build")
    create.add_argument("spec")
    create.add_argument("output")
    args = cli.parse_args()
    print(json.dumps(doctor() if args.command == "doctor" else build(args.spec, args.output),
                     ensure_ascii=True, allow_nan=False))


if __name__ == "__main__":
    main()
