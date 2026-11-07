# Agent Note: Isolated data-native PDF printing and container-responsive visual UI

Status: implemented

## Problem

Clicking "Imprimir / PDF" on a PHOENIX Visual Intelligence card called `window.print()` on the *entire* browser page. A user screenshot on 2026-11-07 showed menus, conversation history, user composer, sidebar and browser chrome in the print preview, rather than an authored report. Other intelligent UI elements relied primarily on viewport media queries, although a conversation bubble may be narrow even on a large desktop screen.

## Decision

Replace page-level printing with an isolated, local, deterministic PDF generator in `VisualIntelligencePdf.ts`. PDF sections are assembled **from validated structured data**, not screenshots, HTML canvas captures, or the assistant's surrounding DOM. Each report has a professional title band, traceability, metrics, vector charts, complete tabular records with pagination, optional document text, geolocation coordinates, media references, and provenance/limitations. Report pages are self-contained and use visible page numbers. Long records and multicolumn data have bounded layouts; sources retain declared rather than invented verification status.

The "Imprimir informe" action opens the generated PDF in a separate browser tab so the platform's PDF viewer prints only that document. "Descargar PDF profesional" saves the same bytes. The embedded document editor uses this same pipeline, preserving actual edits. The live-data section includes a timestamped reading only when a real authorized same-origin fetch produced it; otherwise the PDF explicitly says that live data was unavailable. Existing clinical assessment export retains its separate, stricter report generator; printing a form definition does not fabricate filled clinical answers.

Make `visual_intelligence`, `ui_canvas`, generic cards and smart-form surfaces respond to their **actual component width** via CSS container queries. Tables scroll when viewed in narrow chat bubbles; print uses a new full-data paginator rather than the scrolled viewport. Phone-friendly layouts stack metrics, form controls and comparison rows.

## Alternatives considered

**Print the whole browser and hide chrome with a global stylesheet.** Rejected because an embedded client can have other print styles, shadow/iframe boundaries, session UI and scroll positions. A professional report should not depend on the browser window geometry.

**Use HTML rasterization or screenshot capture.** Rejected because it produces unreadable, clipped and non-searchable pages and can leak confidential surrounding conversation content.

**Silently omit data that exceed one printed page.** Rejected. PDF pagination includes every row and treats many-column tables as readable record cards.

## Consequences

The report is searchable, text/vector-first, self-contained, and independent of the chat UI. It does not embed remote photos or an interactive map bitmap; these are represented by source metadata and coordinates to avoid network tracking or fabricated imagery. It does not certify clinical or scientific correctness of model values. The print action opens a separate PDF viewer tab; automatic invocation of the OS print dialog is delegated to the browser. Tests exercise content/pagination, PDF structure, escaping, live-state disclosure and button behavior. CI validates typecheck, build and UI regressions.
