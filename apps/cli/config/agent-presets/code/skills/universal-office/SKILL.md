---
name: universal-office
description: Use for professional office deliverables, editable Word, Excel, PowerPoint, PDF, document conversion, data analysis and reports across domains.
---

# Universal Office

Use existing tools before inventing exporters. Discover authorized connectors and skills from the current tool catalog. For connected documents use the appropriate native connector, preserve the source and respect permissions. For local work, inspect the existing workspace and runtime, then choose the best available maintained engine: python-docx for DOCX, openpyxl or XlsxWriter for XLSX, python-pptx for PPTX, Pandoc for supported document conversion, and LibreOffice for compatible rendering/conversion. Check actual availability before use; do not claim these optional programs are installed, download dependencies silently or bypass sandbox permissions.

Prefer actual editable artifacts to prose or screenshots. Keep source files and work on copies unless an overwrite is requested. Use the built-in Space export for simple native documents, workbooks and decks; do not represent its limited formats as a full Office editor. For advanced requirements use an available specialist engine. If no engine is available, explain the precise blocker and give the best supported output.

For every deliverable, establish the requested audience, format and acceptance criteria. Use visual hierarchy, consistent typography, suitable charts and professional layouts. Validate formulas, totals, references and data fidelity. Reopen files with an independent parser or render when available; inspect pagination, text overflow, chart labels and compatibility. Do not declare visual validation unless actually performed. Save outputs in the authorized workspace, provide actual artifact references and disclose unresolved limitations. Do not claim an email was sent or a document uploaded without a successful authorized tool result.

## Professional local engine bridge

When the PHOENIX checkout is accessible, use the existing authorized terminal or Python runtime to invoke `python scripts/phoenix-office.py doctor` (use the actual interpreter on Windows, e.g. `py -3`). This reports real optional engine availability. If missing, use the normal approval flow for installing `scripts/requirements-office.txt` in an isolated environment; never install into system Python or request the user type technical commands when the authorized tool can do it. Existing connectors take precedence for native cloud work: Google Workspace, Outlook, OneDrive, SharePoint, Notion and Teams, as available. Call connector_list and respect capability/read-write status.

For local deliverables, write a bounded JSON spec in the authorized workspace, then run `python scripts/phoenix-office.py build spec.json output.docx` (or output.xlsx / output.pptx). The helper calls maintained python-docx, openpyxl and python-pptx engines directly and reopens the file before publishing; it refuses overwrites. Example schemas:

- DOCX: `{"title":"Report","sections":[{"heading":"Results","paragraphs":["Text"],"bullets":["Action"],"tables":[{"headers":["Item","Value"],"rows":[["A","10"]]}]}]}`
- XLSX: `{"sheets":[{"name":"Data","headers":["Item","Value"],"rows":[["A",10],["B",{"formula":"=SUM(B2:B2)"}]],"charts":[{"title":"Values","category_column":1,"value_column":2}]}]}`
- PPTX: `{"slides":[{"title":"Overview","bullets":["Action","Result"]}]}`

These are professional starting templates, not substitutes for advanced custom designs. A successful structural reopen is not visual verification; use an available converter/rendering tool to inspect layouts, and recalculate formulas with a suitable spreadsheet engine when needed. If the helper is unavailable, use an authorized installed engine directly or the existing Space baseline exporter. Deliver the real generated file via the existing workspace artifact system.
