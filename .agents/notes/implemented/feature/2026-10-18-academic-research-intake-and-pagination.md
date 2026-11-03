# Agent Note: Academic research intake and physical page verification

Status: implemented

English | [中文](2026-10-18-academic-research-intake-and-pagination.zh.md)

## Problem

A university asks for a complete long thesis with institutional cover, participants, a page target and appendices, while a journal article needs a shorter IMRaD manuscript. Treating both as the same short publication input can produce genuine files whose structure and physical page count are insufficient. The distinction between APA/Vancouver citations and the scientific article as a document type also needs an explicit user-facing route.

## Decision

The Phoenix hero offers three compact optional research starters: APA 7, Vancouver and Scientific article. Clicking a starter fills the existing unsent draft, preserving editability and user control. The independent `phoenix_research_plan` tool resolves type, citation family, cover fields and chapter budgets before the separate `phoenix_research_publish` tool receives a complete manuscript. When asked for an 80-page thesis, its initial distribution follows 9/4/6/2/15/12/12/9/5/6 for preliminaries through references; these are planning allocations, not fabricated text.

The renderer accepts longer text, up to 140 chapters and 500 source rows; cover participants and IDs; academic preliminaries; Word table-of-contents fields; PDF running pagination and indexed section links; scientific declarations and cited appendices. It counts rendered PDF pages and reports a mismatch with the requested page target rather than inserting repetition. The generated Word TOC requires field refresh in an editor; bibliographic metadata and journal compliance are never independently certified by the offline renderer. Institution manuals must be read and interpreted upstream, not silently treated as validated by the publisher.

## Alternatives considered

**Stretch short reports to a requested count with blank pages or generated filler:** meets a number without completing the intended scientific work and is therefore rejected.

**Conflate Article with Vancouver:** journal manuscripts may use different bibliographic families, so document type and citation style remain independent.

**Automatically claim uploaded institution guidance was enforced:** a local cover path is not evidence that a separate PDF/DOCX regulation was parsed and applied.

## Consequences

The new tool adds a deterministic plan before expensive research and emits a countable production receipt after publication. Print layout and source provenance remain distinct: the output directory contains the editable project, and delivery over email or Telegram remains a separate authorized action. A claimed 80-page thesis needs actual grounded content and the user's review; the renderer can flag shortfalls but cannot create unperformed experiments, real patient cohorts, ethical approvals or peer review.

## Testing

Research planner tests assert the three routes and the exact 80-page allocation. Linux/Windows publisher smoke tests exercise front matter, multiple authors, Word TOC structure, PDF index, cited appendices, scientific declarations and honest shortfall warnings.
