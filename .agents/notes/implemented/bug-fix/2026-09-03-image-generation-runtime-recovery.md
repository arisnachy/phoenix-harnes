# Agent Note: Image generation runtime recovery

Status: implemented

English | [中文](2026-09-03-image-generation-runtime-recovery.zh.md)

## Problem

PHOENIX exposed `image_generation`, but four independent checks could prevent a real image from being attempted or accepted. The Codex bridge treated the current `doctor --json` representation as authoritative and rejected newer or unrecognized diagnostic output before `codex exec` ran. HARDNESS projected every registered tool under the generic `tool` kind, so a semantic need such as `image_generation` could not select `tool:image_generation`. Acquisition then reported an external dependency even though the tool already existed locally. Finally, a need requiring `verified` status could not execute a newly prepared `testing` capability to create the evidence required for promotion, and the production artifact runtime had no raster renderer.

## Decision

The real Codex image-worker execution is authoritative for image availability. `codex doctor --json` remains an advisory probe only; PHOENIX attempts `codex exec --enable image_generation` and classifies authentication, capability, quota, and runtime failures from that execution. The bridge still refuses separately billed API fallback and still requires a fresh raster before reporting success.

HARDNESS treats an exact registered tool id `tool:<need.kind>` as a semantic provider for that need. Exact-name tool routes use the tool's JSON schema as the argument/output authority rather than interpreting free-form mission descriptions as ATLAS input/output tags. The acquisition registry can prepare an already indexed exact-name tool as `testing` instead of declaring `WAITING_EXTERNAL`.

When acquisition has just produced a `testing` capability for a need whose final required status is `verified`, the mission may execute that testing candidate once. Successful artifact verification, independent judging, and recorded passed evidence remain mandatory before promotion to `verified`; the requested status is not weakened at completion. Generated image tools publish attachment-backed HARDNESS artifact metadata, and the production runtime renders PNG, JPEG, WebP, and GIF artifacts as `hardness-image` presentations.

## Alternatives considered

**Keep `codex doctor --json` as a hard gate.** Rejected because diagnostic schemas can change independently of the executable image capability and therefore create false negatives before the authoritative operation runs.

**Promote acquired capabilities to `verified` before execution.** Rejected because it would fabricate trust without passed evidence and bypass the lifecycle rule that verification is earned by real execution and independent judging.

**Add a separately billed OpenAI API fallback.** Rejected because this path is explicitly intended to reuse the user's Codex/ChatGPT-authenticated image capability and must not silently change billing behavior.

**Use Chrome/CDP as the primary recovery route.** Rejected because browser automation is a separate optional transport with its own startup/session failure modes; it should not be required when the installed Codex image worker is available.

## Consequences

Image requests can now proceed across benign changes in Codex doctor diagnostics, and HARDNESS no longer mistakes an already registered exact-name image tool for a missing external provider. Verification remains fail-closed: a testing capability becomes verified only after a real successful artifact, renderer acceptance, evidence recording, and judge pass. The image tool now carries artifact metadata usable by governed missions, while raster rendering is limited to the image MIME types explicitly supported by the attachment pipeline. Real authentication, feature disablement, quota exhaustion, or absence of a generated raster still blocks completion with a classified error rather than a fabricated result.