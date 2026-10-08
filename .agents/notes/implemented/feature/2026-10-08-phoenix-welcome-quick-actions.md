# 2026-10-08 — Warm, functional Phoenix welcome

The October 8 approved visual moves Phoenix's new-session surface toward a spacious warm-neutral assistant interface: centered brand and greeting, six two-row action cards, suggestion chips, and a wider composer. The current session/workspace tree and active transcript remain authoritative.

The quick actions and suggestions feed ordinary draft text to the existing InputHub; they never submit, change model selection, or invoke an unapproved tool. A missing workspace opens the resident picker, retaining the requested draft until an actual session is available. This preserves the one-textarea DOM lifetime across blank and active phases.

CSS limits the 1000px welcome width to the hero phase, retaining the 768px active transcript. Sidebar adjustments only affect spacing and the New Session control; no parallel navigation system is introduced.

Verification paths: the existing conversation skeleton tests exercise welcome selection and no-workspace behavior. Review the 3/2/1-column responsive card grid, keyboard focus outlines, dark mode, and active transcript independently. Full browser screenshots and workspace build require a checked-out runtime; do not equate a successful Git object write with visual QA.
