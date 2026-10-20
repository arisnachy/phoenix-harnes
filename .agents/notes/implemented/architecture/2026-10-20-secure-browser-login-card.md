# Agent Note: Secure browser login card and shared vault access

Status: implemented

English | [中文](2026-10-20-secure-browser-login-card.zh.md)

## Problem

Website credentials entered in Secure Ask could fail before persistence because Windows PowerShell did not load the DPAPI assembly. The manual browser entrypoint omitted detected page fields, the protected form replaced live chat activity, and Computer still resolved only legacy credentials.

## Decision

Secure Ask remains a human-only form, rendered as a compact card below the browser. Manual entry inspects the actual page fields, and live chat remains independent. Windows storage explicitly loads System.Security before encryption and confirms read-back before reporting a saved login.

The credential seam exposes internal serial status and resolution events for the selected exact-origin identity. Explicit denial is authoritative, and only absent records permit legacy lookup. Private values reach the current-user native browser pipe, never model arguments or session events. Native login scopes additional fields to the selected form and refuses missing required extras or cross-origin actions.

Chrome operations resolve their endpoint once and execute independent DOM, vault-presence, and remembered-layout reads concurrently. They do not cache consent or weaken navigation verification.

Manual Windows builds bound restart-bridge ancestry discovery by visited PIDs, depth, and time. Recycled system PIDs can form a cycle; an unverified ancestry ends discovery without restarting the Host.

## Alternatives considered

**Use the ordinary Ask input.** Its answers enter the model-visible conversation, so it cannot carry website secrets. The protected form shares its visual structure while retaining its direct host route.

**Copy DPAPI values into the legacy store.** That duplicates sensitive data and creates competing consent states. The browser instead resolves the selected identity through the existing credential seam.

## Consequences

Saving, selecting an identity, and using credentials share one authoritative encrypted record. Site authentication still requires observable browser evidence; submitting a form alone does not confirm login. MFA, CAPTCHA, ambiguous forms, and unsupported fields remain human-attention states. Verification uses synthetic credentials and isolated storage.
