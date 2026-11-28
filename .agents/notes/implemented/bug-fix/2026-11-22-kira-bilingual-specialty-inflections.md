# Agent Note: Recognize natural Spanish inflections in Kira Team specialties

Status: implemented

English | [中文](2026-11-22-kira-bilingual-specialty-inflections.zh.md)

## Problem

Kira's unnamed specialist selection uses the responsibility text to choose a skill pool. Several regular Spanish task terms such as `investigación`, `automatización`, `optimización`, and `auditoría` did not match regex branches ending at a bare stem followed by a word boundary. These assignments could therefore fall through to the generic pool even though a targeted specialty already existed.

## Decision

Match zero or more Unicode letters after selected established Spanish/English stems while retaining the existing ordered, deterministic skill precedence and specialist pools. No new personnel, route permissions, model providers, or prompt budget is introduced.

## Limits

Keyword matching remains a heuristic. Ambiguous requests can match multiple categories; the existing precedence remains authoritative. This is not performance-based team routing, semantic classification by an LLM, or an empirical intelligence benchmark.

## Verification

A table of natural Spanish assignments exercises research, automation, optimization, quality audit, drafting, design, statistics, security, and engineering through the public skill-classification and specialist-selection functions. Real provider/model performance and final user outcomes require separate evaluation.
