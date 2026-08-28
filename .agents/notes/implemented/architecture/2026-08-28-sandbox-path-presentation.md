# Agent Note: readable Windows sandbox paths

Status: implemented

English | [中文](2026-08-28-sandbox-path-presentation.zh.md)

## Decision

The sandbox policy prompt renders workspace and PHOENIX evolution roots as quoted filesystem paths without JSON-escaping Windows separators. Embedded quotes remain escaped so the prose stays unambiguous.

## Verification

The Windows HARDNESS sandbox-policy tests pass, including the model-facing self-evolution guidance. This changes prompt presentation only; sandbox mode resolution, protected roots, and write enforcement remain unchanged.
