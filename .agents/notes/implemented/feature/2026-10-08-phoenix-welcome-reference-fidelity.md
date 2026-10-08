# 2026-10-08 — Phoenix welcome reference fidelity

The first quick-actions implementation reproduced the cards but omitted the surrounding navigation, top bar, and content alignment from the approved third-image reference. This change extends the actual application instead of adding a static illustration.

The expanded sidebar now shows Inicio, Descubrir, Conectores, Equipo, and Biblioteca. Inicio reuses `startSession`; the next three open existing registered Settings sections through an in-browser navigation event; Biblioteca and the welcome search open the existing workspace-session search, including the narrow-sidebar expansion path. The existing collapsed rail and workspaces stay mounted.

The welcome toolbar renders the real model selector in a hero slot. It shares the exact session model directory and selection path with the composer, which moves its own selector to the left only during a blank hero phase. The avatar's profile button navigates to Profile. No second textarea, fabricated model label, or replacement agent action is created.

The hero column no longer inherits the Kira floating-team counter-offset, which moved the approved centered layout toward the sidebar by about 112px at the default 280px sidebar width. Active session geometry is unchanged. The original official monochrome phoenix logo is retained rather than inventing a new brand asset; the profile button uses initials rather than an unsupported portrait.

Verification: compile and focused UI tests on the exact SHA, inspect actual browser at desktop and mobile widths, and check model menu, Settings section navigation, workspace search, and composer before claiming full fidelity. Preserve accessibility and dark-mode behavior.
