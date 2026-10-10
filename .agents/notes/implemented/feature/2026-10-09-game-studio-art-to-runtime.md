# Agent Note: Bind approved game art to executable characters

Status: implemented

English | [中文](2026-10-09-game-studio-art-to-runtime.zh.md)

## Problem

A character's generated reference image could look polished while the playable game used unrelated boxes or generic placeholder drawing. The Game Studio publisher previously checked only basic JSON metadata and presence of JavaScript. It did not detect whether the approved hero atlas, its animations and scene art were actually embedded or rendered. A missing JSON manifest also triggered confusing error explanations unrelated to the actual startup cause.

## Decision

The real `phoenix_game` publisher now enforces an explicit art-production state for representational action games. `prototype` is accepted as an honest playable interim result, with a non-final publication receipt; `production` requires an actual inline transparent-capable PNG hero atlas, consistent frame grid and distinct run poses, provenance reference, scene background PNGs and concrete `drawImage` references to each. These are structural checks only and never claim that the character artist's design is visually faithful. Abstract/puzzle genres need no artificial hero. The existing procedural Jungle Echo example is explicitly labeled a prototype.

A local asset packer copies verified PNG bytes into `<img>` data URI elements before script execution, avoiding external CDN and the common bug where JavaScript reads unmounted art. A local manuscript preparation tool inserts a single, truthful JSON game manifest and rejects mismatches or malformed data. The client distinguishes missing metadata from JavaScript runtime failures and displays game exceptions inside the isolated preview. The standard/code Game Development skills and canonical Game Studio skill require Kira to compare the approved design to actual gameplay frames and never close a premium game request on a sprite concept alone.

## Alternatives considered

**Trust a manifest declaration without checking image usage.** Rejected because the mismatched playable character can coexist with an unused high-quality image.

**Run image recognition in the isolated browser to certify likeness.** Rejected as a hidden expensive/non-deterministic capability; real screenshots inspected against the user's approved design remain the necessary evidence.

**Require a hero sprite in every puzzle or racing game.** Rejected because abstract games need no character and may have excellent geometric art.

## Consequences

The publisher no longer silently classifies representational box art as professional. Authors must supply real atlases and backgrounds, and transparent/prototype classification remains honest. The checks constrain the supported inline game HTML authoring pattern; native engines need their own import verification. The gate does not prove visual identity, smooth animation, correct alpha pixels, sound fidelity or real-device performance.