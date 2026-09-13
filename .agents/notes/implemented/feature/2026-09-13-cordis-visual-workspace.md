# Agent Note: Cordis visual workspace

Status: implemented

## Problem

Phoenix already has transient subagent UI beside the conversation, but Cordis-driven visual material has no shared presentation surface. Showing an image, video, page, or supporting text either replaces conversation context, opens an unrelated browser surface, or overlays the chat without coordinating shell geometry. The missing coordination becomes especially visible when a subagent surface and Cordis content are active at the same time: both need a predictable right-side area, and closing either one must not destroy the other or leave the shell collapsed.

## Decision

The layout service owns a shared visual-workspace lease with two named occupants: `subagent` and `cordis`. The first occupant snapshots the current sidebar and details widths, collapses the navigation sidebar, and reserves the standard right-dock width. Additional occupants share that borrowed geometry without replacing the snapshot. The final occupant to close restores the saved geometry exactly.

`ui-subagent` announces its visual lifetime through `ctx.layout.setWorkspaceOccupant('subagent', active)`. `ui-workspace` provides `ctx.visualWorkspace`, whose `show()` and `close()` methods own the `cordis` lease. Replacing one Cordis item with another does not release and reacquire the lease, so the chat does not jump between presentations.

The Cordis surface registers in `shell.overlay` and renders against the reserved right-side width. With Cordis alone, it uses the full dock height. When the subagent occupant is also active, Cordis moves into the lower half so the existing subagent surface keeps the upper position. The shell continues to render the conversation rather than replacing it.

The Cordis content contract accepts four presentation kinds: `image`, `video`, `page`, and `text`. Page URLs are limited to HTTP(S) and render in a sandboxed iframe with an explicit external-browser escape hatch. Video uses native controls and inline playback. The public controller is intentionally presentation-only: it does not execute page code outside the iframe sandbox or grant Cordis a new tool/action channel.

The AppFrame reserves the visual-workspace dock even when no ordinary details session exists. While a visual lease is active, the details resize handle is hidden because the floating visual surface and the reserved grid track must stay aligned. Ordinary tool-details close requests cannot collapse the borrowed dock, and the sidebar toggle cannot expand navigation over it.

## Alternatives considered

**Give Cordis its own unrelated modal.** This would avoid touching layout state, but it would cover the conversation and would not compose with the existing subagent surface. It also creates a second window-management model inside Phoenix.

**Reuse the ordinary tool-details panel directly.** The details slot is session-scoped and is semantically tied to selected tool calls. Cordis must be able to present visual material without a selected tool call and even when the ordinary details panel was previously closed, so taking over that slot would conflate two different lifecycles.

**Close one surface when the other opens.** This simplifies geometry but discards useful concurrent context. The explicit requirement is that Cordis can open beneath an already-open subagent surface, so mutual exclusion is rejected.

**Restore a fixed default layout after closing.** That is simpler than snapshotting, but it destroys user-resized panel state. The lease therefore restores the exact pre-workspace sidebar and details preferences.

## Testing

`ui-layout` tests cover first-owner snapshotting, two-owner coexistence, last-owner restoration, protected sidebar/details behavior, occupancy subscriptions, duplicate writes, and non-persistence. `ui-workspace` tests cover Cordis lease acquisition, in-place content replacement, close/dispose release, and idempotent teardown. AppFrame behavior is additionally exercised by the existing layout component suite, including its details-column concession logic.

## Consequences

Phoenix gains one coordinated visual workspace instead of separate ad-hoc overlays. Cordis can present pages, images, videos, and text while the conversation remains visible; subagent and Cordis surfaces can coexist; and closing the last surface restores the user's previous shell geometry. The trade-off is that the visual dock uses a fixed contract width while leased and the sidebar remains collapsed for the lease lifetime. A future resizable multi-pane workspace can replace that fixed geometry without changing the named-occupant lifecycle contract.
