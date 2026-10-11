# Agent Note: Declarative interactive assistant workspaces

Status: implemented

## Problem

Assistant-generated tables and forms could hold user input but had no deterministic calculation model. Tables did not expose cell editing, formula dependencies, or recoverable drafts. Team activity and state indicators also differed between ordinary messages and UI cards.

## Decision

The conversation renderer accepts bounded \`scale_form\`, \`spreadsheet\`, \`status_pill\`, and \`agent_line\` specifications beside the existing \`ui_canvas\` representation. Each parser has an explicit field allowlist, tight text and row bounds, and no authority to execute model-authored scripts, functions, URLs, or arbitrary event callbacks. The scale computes numeric selections synchronously in React and refuses to report a completed total for missing or unsupported answers. Numeric scores and bands come from the supplied definition, which remains unverified until the author supplies a vetted source.

The spreadsheet allows editing and locally evaluates bounded numeric arithmetic, cell references, and SUM, AVERAGE, MIN, and MAX. A formula parser replaces JavaScript execution and detects errors, circular references, invalid addresses, and excessive expansion. Draft recovery is browser-local by sheet id; CSV import/export is explicitly distinct from full XLSX workbook preservation and escapes leading expression characters when exporting untrusted values. The common UI primitives supply local outline icons, semantic status pills, and agent activity rows. Known status terms receive the same semantic pills when projected through tables.

## Alternatives considered

**Execute freeform model-generated React, JavaScript, or formulas through eval.** Rejected because it would give a textual response unnecessary execution authority, with unacceptable injection and reproducibility risks.

**Make each form change round-trip through an LLM.** Rejected because deterministic local calculations are faster, cheaper, and auditable.

**Pretend CSV is a complete Excel workbook.** Rejected because CSV does not preserve sheets, formats, validation, or formulas as workbook metadata.

**Introduce a new icon-font or external CDN.** Rejected because static inline SVGs can use currentColor and Phoenix theme tokens with no network, lockfile, or font dependencies.

## Consequences

The components can render inside existing assistant turns, with predictable low-latency interactions and familiar responsive styling. Spreadsheet support remains intentionally narrower than Excel: no XLSX round trip, multi-sheet references, macros, charts, or encrypted Host-owned data recovery. Browser-local storage is not a clinical records database and should not contain identifiable patient data. Published clinical cutoffs remain the responsibility of the source author; the UI cannot certify their validity. Keyless UI tests pin the parser and calculation behaviors.
