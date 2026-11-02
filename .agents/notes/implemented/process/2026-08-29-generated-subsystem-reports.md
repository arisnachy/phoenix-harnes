# Agent Note: Generated subsystem reports stay outside the bilingual index

Status: implemented

English | [中文](2026-08-29-generated-subsystem-reports.zh.md)

## Problem

Skill verification commands generate Markdown reports under `docs/subsystems/`, but those reports have no reviewed Chinese counterpart and are regenerated from runtime observations. The subsystem folder index and the bilingual pairing gate therefore disagreed about whether these outputs were current documentation pages.

## Decision

The generated reports `skill-english-overlays.md`, `skill-operational-adapters-by-category.md`, and `skill-operational-adapters-report.md` are explicit translation-pairing exclusions until reviewed counterparts exist. The documentation-site projection uses the same exclusions, so generated reports are not placed in the subsystem README or published sidebar. Authored subsystem references for OpenClaw skills and operational adapters have reviewed Chinese counterparts, are indexed on both sides, and are published through the normal paired-page manifest.

## Alternatives considered

**Translate every generated report immediately.** Rejected: the owning commands regenerate these files from runtime observations, so a checked-in translation would become stale without a reviewed translation workflow for each run.

**Index and publish the generated reports in English only.** Rejected: the subsystem index presents reference pages as maintained documentation, while these outputs are evidence snapshots with no stable reviewed counterpart.

## Verification

`verify-translation-pairing` rejects an excluded report with a `.zh.md` or `.i18n.yaml` companion, while the named OpenClaw and operational-adapter pairs require complete hashes and matching structure. `project-doc-site.spec.ts` derives its subsystem index set from the same exclusion manifest and checks both README locales. The owning skill verifiers remain responsible for report generation and evidence freshness.

## Consequences

The repository keeps generated evidence available to maintainers without presenting an untranslated runtime report as a bilingual reference page. Adding a reviewed counterpart requires removing that exact report from the exclusion list, adding both locale index rows, and registering the paired page in `website/docs.ts`.
