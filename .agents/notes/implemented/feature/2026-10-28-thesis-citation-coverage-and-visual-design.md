# Agent Note: Thesis bibliography guidance and evidence-based visual presentation

Status: implemented

English | [中文](2026-10-28-thesis-citation-coverage-and-visual-design.zh.md)

## Problem

The research publisher applied one internal 15-source floor to every professional thesis regardless of degree. It planned APA and Vancouver workflows but did not communicate degree-specific bibliography targets, and the HTML reader numbered APA reference lists. University manuals may impose stricter requirements, and attractive charts must not be fabricated.

## Decision

The academic planner infers undergraduate, master and doctoral theses and returns advisory targets of 20–40, 40–80 and at least 100 distinct cited sources. These are guidance rather than universal rules. A reviewed institutional `min_references` overrides advisory policy and is enforced in both TypeScript and Python publishers. Thesis submissions must explicitly choose APA 7 or Vancouver, retaining the existing citation-to-reference validation. APA is author-date with alphabetically sorted, unnumbered, hanging-indent bibliography; Vancouver uses numbered citations and order of first appearance. The HTML reader now respects that distinction.

The visual plan supports a premium preference while leaving formal academic/journal formatting intact. Hybrid-reading thesis reports can select context-aware research-violet or clinical-teal palettes; academic presentation remains traditional when the institutional document requires it. Figures and tables still require real source keys and traceable data, never generated values or logos.

## Alternatives considered

**Reject all theses beneath the advisory target:** would incorrectly turn planning suggestions into universal academic regulations.

**Generate invented charts or bibliography entries until a quota is met:** would undermine research provenance and is rejected.

**Apply a decorative cover to official academic submissions:** would compromise institutional formatting, so the professional hybrid version carries enhanced styling separately.

## Consequences

The planner reports source and citation guidance before drafting. The publisher differentiates binding user-reviewed university minimums from nonblocking bibliography advisories in its receipt. Actual PDF page counts, source checks, research depth and human review remain required; style metadata does not certify university compliance or external reference authenticity.

## Testing

Planner and TypeScript publication tests cover degree targets, APA/Vancouver behavior, premium planning, and institution minimum validation. Linux/Windows smoke coverage verifies real HTML bibliography layout and rejects inappropriate citation styles and unmet reviewed minima.
