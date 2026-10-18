# Agent Note: Scientific research output separates evidence, structure, and visual presentation

Status: implemented

English | [中文](2026-10-18-scientific-hybrid-publication.zh.md)

## Problem

A structurally valid PDF could contain only a brief summary while claiming to be a complete thesis or scientific review. Publication rendering conflated bibliography conventions with visual styling and lacked real source-linked tables.

## Decision

The existing `phoenix_research_publish` tool distinguishes `document_type` (brief, reviews, original research, thesis, journal manuscript, policy report), `style` (APA/APA7 and Vancouver), and `presentation` (academic, editorial, hybrid). The Python publisher checks type-specific required manuscript sections before writing files. A systematic review is rejected without a separately declared screening/extraction evidence record. All tabular numeric material references a cited source key and is rendered into editable Word tables, paginated PDF tables, and HTML tables. The hybrid profile adds restrained color, hierarchy, running page furniture, and figures without changing the citation convention.

The metadata receipt explicitly states that supplied reference metadata is not independently verified and that a completed visual page review or submission certification has not occurred. The tool rejects `submission_ready: true`, since acceptance into a journal requires journal-specific checks and accountable authorship. Legacy short reports retain the `brief` and `academic` defaults.

## Alternatives considered

**Apply JAMA styling to every academic document:** an attractive printed article is not a submission-ready Word manuscript; JAMA and APA use different editorial and citation requirements.

**Require twenty references or a fixed page count:** quantity alone does not establish scientific validity. Type-specific sections and source traceability are enforceable without inventing material.

**Claim full CSL style coverage through an approximate custom formatter:** only the two currently implemented citation families are advertised until their extended metadata and rendering are validated.

## Consequences

Researchers can request a reader-friendly hybrid edition without overwriting strict academic defaults. Source metadata and results still require independent fact checking; the PDF renderer cannot execute a study, validate a PRISMA protocol, certify APA compliance for a particular institution, or replace peer review. Renderer format regressions are exercised in both Linux and Windows smoke tests.

## Testing

`scripts/phoenix-research-publisher-smoke.py` creates actual DOCX/PDF/HTML files for academic APA, editorial APA7, and hybrid Vancouver modes. It checks the rendered table and image descriptions and rejects incomplete thesis and systematic-review payloads.
