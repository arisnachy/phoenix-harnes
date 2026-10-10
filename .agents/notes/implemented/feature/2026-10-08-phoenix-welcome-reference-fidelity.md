# Agent Note: Phoenix welcome reference fidelity

Status: implemented

## Problem

An earlier quick-action implementation reproduced cards but omitted navigation, the top bar and the content alignment of the approved reference.

## Decision

The real expanded sidebar contains Inicio, Descubrir, Conectores, Equipo and Biblioteca. Inicio reuses `startSession`; the next three open registered destinations, and Biblioteca or welcome search invokes the existing workspace-session search. Collapsing the sidebar preserves the workspace and navigation paths.

The welcome toolbar mounts the actual model selector from the existing session model directory. The active composer moves its selector only during the blank hero phase; no second textarea or fabricated model action is introduced. The avatar opens the real Profile section.

The centered hero no longer inherits the floating team counter-offset (roughly 112px with a 280px sidebar). The real monochrome Phoenix emblem and initials-only avatar are retained.

## Alternatives considered

**Add static navigation illustrations.** Rejected because they cannot open actual destinations and would imply nonfunctional controls.

**Duplicate the model selector and composer logic.** Rejected because that would create competing sources of truth for session state and available models.

**Use an invented portrait in the Profile control.** Rejected in favor of the actual supported initials avatar.

## Consequences

The welcome screen more closely follows the approved reference without introducing shadow navigation or session state. Final confidence still depends on exact-SHA builds and real desktop/mobile testing of model menus, Settings navigation, workspace search, focus behavior and both light and dark themes.
