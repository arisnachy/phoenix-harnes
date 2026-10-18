#!/usr/bin/env python3
"""End-to-end editorial PDF smoke: real bytes, text extraction and page count."""
import json
import subprocess
import sys
import tempfile
from pathlib import Path
import fitz


def main():
    publisher = Path(__file__).with_name("phoenix-book-publisher.py")
    with tempfile.TemporaryDirectory(prefix="phoenix-book-pdf-") as tmp:
        output = Path(tmp) / "interior.pdf"
        chapters = []
        for index in range(1, 4):
            prose = ("\n\n".join(
                "La investigadora Lucía descubrió en la página " + str(i) +
                " que una elección anterior había alterado el curso de los acontecimientos." for i in range(65)
            ))
            chapters.append({"number": index, "title": "Capítulo " + str(index) + ": El enigma",
                             "text": prose})
        request = {"title": "La señal del océano", "author": "Autora de prueba",
                   "trim": "6x9", "lang": "es", "chapters": chapters, "output": str(output)}
        process = subprocess.run([sys.executable, str(publisher)], input=json.dumps(request, ensure_ascii=False),
                                 text=True, capture_output=True, timeout=120)
        if process.returncode != 0:
            raise AssertionError(process.stderr)
        if not process.stdout.strip():
            raise AssertionError('Renderer returned empty stdout; exit='+str(process.returncode)+'; stderr='+repr(process.stderr[-1600:])+'; file_exists='+str(output.exists()))
        try:
            receipt = json.loads(process.stdout)
        except json.JSONDecodeError as exc:
            raise AssertionError('Renderer stdout is not JSON: '+repr(process.stdout[:1200])+'; stderr: '+repr(process.stderr[-500:])) from exc
        assert receipt["ok"] is True
        assert receipt["result"]["text_extraction_verified"] is True
        assert receipt["result"]["print_release_approved"] is False
        assert output.read_bytes().startswith(b"%PDF-")
        with fitz.open(str(output)) as pdf:
            assert pdf.page_count >= 4
            assert receipt["result"]["pdf_pages"] == pdf.page_count
            body = "\n".join(page.get_text() for page in pdf)
            assert "Índice" in body and "La señal del océano" in body
            assert "Lucía" in body
            for index in range(1, 4):
                assert ("Capítulo " + str(index) + ": El enigma") in body
            for page in pdf:
                assert abs(page.rect.width - 432) < 1
                assert abs(page.rect.height - 648) < 1
        print("BOOK_PDF_SMOKE_OK", receipt["result"]["pdf_pages"], "real pages")


if __name__ == "__main__":
    main()
