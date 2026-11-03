# Agent Note: KIRA activity strip and agent rail

Status: implemented

English | [中文](2026-09-29-kira-activity-strip-agent-rail.zh.md)

## Problem

The live KIRA team UI rendered each subagent as a large floating card. That presentation made parallel work visually heavy, competed with the conversation, and grew in visual complexity as more agents became active. A multi-agent session needs stable geometry so adding workers does not continuously enlarge the primary control surface.

## Decision

KIRA now uses a fixed-height activity strip and a narrow right-side agent rail. The strip remains 44 px tall regardless of team size, stacks at most three live portraits, and represents additional agents with a `+N` overflow count. Its center shows the selected agent, current state, specialty, and only the activity text authored by that child model when such text exists.

The right rail is the persistent selector for all live agents and scrolls independently when the team is large. Selecting a rail portrait changes the agent represented in the activity strip without navigating away. Activating the focused strip opens that continuable child session. An optional flat details list can be expanded below the strip; it is closed by default and does not introduce per-agent cards.

The whole feature remains registered in `shell.overlay` and continues to publish `setWorkspaceOccupant('subagent', false)`, so neither the strip nor the rail reserves conversation width. When the last active or waiting subagent settles, the complete overlay disappears.

## Alternatives considered

**Keep the floating team card and reduce its padding.** Rejected because the nested-card hierarchy still grows with agent count and remains visually detached from the main workspace.

**Add one horizontal chip for every active agent.** Rejected because the top surface would expand or wrap as the team grows, violating stable geometry.

**Show only one agent and hide the rest in a menu.** Rejected because parallel work should remain glanceable and directly selectable without opening another menu.

## Consequences

Multi-agent activity now occupies a predictable amount of primary screen space while preserving direct access to every live worker. The strip is a status surface rather than a collection of cards, the rail owns agent selection, and the detail list appears only on demand. On narrow mobile layouts the rail is hidden and the strip remains the primary live-team surface.
