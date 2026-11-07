# Agent Note: Celebration-aware transparent PHOENIX marks

Status: implemented

English | [中文](2026-11-07-celebration-aware-transparent-phoenix-marks.zh.md)

## Problem

The PHOENIX welcome hero uses a recognized silver phoenix image. Changing the brand image to an AI-redrawn holiday logo damages fidelity, and a generic circular emblem makes distinct celebrations appear identical. A global calendar without jurisdiction and consent rules also risks greeting someone for an unrelated national holiday or personal identity.

## Decision

The canonical transparent `apps/web/public/phoenix-emblem.png` stays unchanged. The new calendar in `packages/client/ui-conversation/src/client/skeleton/celebrations.ts` chooses the locally relevant national and international commemoration, including movable dates, professional days only with a consented profession and birthdays only with a consented date of birth.

There are 143 individually named transparent decorative SVGs in `apps/web/public/assets/celebrations/`. Each is a self-contained ornament, not a replacement phoenix drawing. `EmptyHero.tsx` layers the selected SVG above the existing official image. `scripts/generate-phoenix-celebration-icons.mjs` regenerates the ornaments from the curated calendar. Unknown Nager.Holidays v4 entries use a themed fallback artwork; public holiday discovery passes only the country and year, never personal fields.

The hero changes automatically at local midnight, with quiet styles and no recurring model calls. Commemorations never receive an unconditional celebratory greeting, and Mother's/Father's Days do not assume the user is personally a parent.

## Alternatives considered

**Redraw the complete phoenix for every event.** Rejected because generated copies drift from the approved official mark, and PNG duplication across hundreds of dates would enlarge the product.

**Use emoji badges or the same colored ring on every date.** Rejected because the result is visually repetitive and insufficiently specific for celebrations and remembrances.

**Download an AI-generated image for every opening of PHOENIX.** Rejected due to latency, unreliable offline behavior, cost, nondeterministic artwork and loss of control over the original emblem.

**Send the user profile to a public holiday service.** Rejected as unnecessary. The only network parameters are country code and year.

## Consequences

The mark retains pixel-for-pixel fidelity because the base image is never edited. SVG decorations have alpha transparency, varied geometry and low payloads and can be regenerated without an image model. The curated offline layer renders immediately, while international v4 holidays are a best-effort enhancement. The first-level regional feed requires a user-selected state to expose state-specific holidays; exact origins and dates require explicit profile settings. Unit tests verify holiday dates, no inappropriate greetings, individual SVG coverage and fallback rendering. Cross-browser and deployment smoke checks remain release verification obligations.
