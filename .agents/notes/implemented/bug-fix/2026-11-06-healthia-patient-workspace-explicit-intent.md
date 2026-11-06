# Agent Note: Explicit HealthIA patient workspace activation

Status: implemented

English | [中文](2026-11-06-healthia-patient-workspace-explicit-intent.zh.md)

## Problem

A medical academic case caused PHOENIX to invoke the global HealthIA activator; that tool returned all conversational profiles, and the chat renderer treated activation as a request to show patient intake. The same research workflow could also pass a multi-page question to a 500-character planner and fail before searching.

## Decision

Keep medical research and simulated cases in PHOENIX Research APEX without activating patient-record tools. Make global HealthIA activation return no patient list or presentation contract. Patient list reads remain invisible metadata; only the explicit `health_patient_workspace` tool may show a patient-management interface when the user requests profile operations. Retain first-party patient creation confirmations and bounded longitudinal snapshots. Condense oversized tool research questions into a topic-and-identifiers query while keeping the original user request in conversation.

## Alternatives considered

**Hide all HealthIA results in the chat:** Rejected because deliberately created or opened patient profiles must remain accessible.

**Make activation always show onboarding:** Rejected because activation enables tools; it does not prove that the user wants a patient record.

**Raise the research planner limit without reducing queries:** Rejected because uncontrolled search text hurts provider relevance and performance.

## Consequences

Academic clinical questions no longer turn background activation receipts into a profile intake UI. Explicit patient browsing requires a named tool call, and source research respects the existing 500-character planner contract. A model can still select an unnecessary activation tool; this is guided against, while the UI no longer treats activation as proof of record intent.

## Verification

Unit tests cover activation without patient metadata, explicit profile workspaces, forged UI receipts and long clinical questions. CI, source integration and client rendering checks must be observed before claiming release readiness.
