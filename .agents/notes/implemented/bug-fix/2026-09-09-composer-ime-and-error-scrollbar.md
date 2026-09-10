# Agent Note: Composer IME and error scrollbar fixes

Status: implemented

English | [中文](2026-09-09-composer-ime-and-error-scrollbar.zh.md)

## Problem

Some Windows IMEs report an active composition only through the legacy native key code `229`. Pressing Enter in that state advanced the question flow. Raw JSON inside the elevated error surface also inherited page-level scrollbar colors with insufficient contrast.

## Decision

The question composer recognizes native key code `229` alongside the standard composition signals. Enter then confirms the IME candidate without changing question state. The raw JSON surface binds its scrollbar tokens to the elevated-level palette already used by that panel.

## Alternatives considered

**Use only the standard composition flag:** rejected because affected Windows browser and IME combinations do not set it reliably.

**Change global scrollbar colors:** rejected because the contrast defect belongs to the elevated error surface and a global change would alter unrelated UI.

## Verification

The focused client and assembled regression selection passes 168 tests. The question package README records the composition behavior, and the conversation README records the elevated scrollbar behavior.

## Consequences

Windows IME users keep their current question while confirming a candidate. Structured error details remain readable within the existing PHOENIX theme.
