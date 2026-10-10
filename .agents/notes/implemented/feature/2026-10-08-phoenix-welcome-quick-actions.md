# Agent Note: Warm functional Phoenix welcome

Status: implemented

## Problem

The previous new-session screen did not match the approved warm, spacious visual reference, and a quick-action widget risked bypassing the real workspace and composer state.

## Decision

Phoenix displays the centered brand, greeting, two-row quick-action cards, suggestion chips and a wider composer on the welcome screen. Quick actions and suggestions write drafts into the existing InputHub; they never submit a message, change model selection, or invoke tools. When no workspace exists, Phoenix opens its resident picker and preserves the draft until a real session is available. The same textarea stays mounted across welcome and active-chat phases.

The welcome layout can grow to 1000px only in its hero phase; the active transcript retains its 768px content width. Sidebar changes are limited to spacing and the existing New Session control.

## Alternatives considered

**Introduce a second welcome composer.** Rejected because duplicated textareas would diverge from the real input session and could lose drafts.

**Have the quick actions submit immediately.** Rejected because suggestion chips must remain user-controlled drafts rather than invoke unapproved actions.

## Consequences

The introductory screen gains the approved layout while ordinary chat state, workspace selection and model choice remain authoritative. Verification requires focused UI tests for draft reuse, missing-workspace behavior, responsive 3/2/1-column cards and keyboard focus. Dark mode, active-chat geometry and actual browser rendering also require independent review; committing source files alone is not visual proof.
