# Agent Note: Passive HTML image loading without script privileges

Status: implemented

English | [中文](2026-10-25-passive-html-external-images.zh.md)

## Problem

Generated landing pages and reports often contain external photographs but no JavaScript. The artifact renderer classified every HTML artifact marked executable as a script-capable application, so its default image Content Security Policy suppressed photographs and left alternative text visible. A previous image-network approval also persisted when the same viewer received different HTML.

## Decision

The conversation artifact renderer uses a script-disabled, same-origin sandbox for HTML without script tags, inline event handlers, or JavaScript URLs. Such documents may load remote images without granting author scripts execution rights. HTML with those executable constructs, and Game Studio previews, retain the opaque-origin script sandbox and require an explicit user action to load remote images. Image consent belongs to the exact HTML text displayed in that viewer and does not authorize different content. Protocol-relative remote images are recognized by the consent detector.

## Alternatives considered

**Enable remote images for every executable artifact by default.** Script-created image requests can transmit information even when `connect-src` is disabled, so automatic authorization would weaken the existing isolation.

**Require consent for every static marketing page.** This leaves common script-free HTML previews visibly incomplete even though their sandbox already prohibits script execution.

## Consequences

Script-free pages retain their photographs and Phoenix's restrictive script policy. Pages with JavaScript retain interaction but need an explicit image-loading action; third-party hosts can still refuse hotlinks or unavailable URLs. Component tests exercise both paths and verify that approval does not carry over to replaced HTML.
