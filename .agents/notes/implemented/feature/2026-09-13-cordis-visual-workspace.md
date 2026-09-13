# Agent Note: Cordis visual workspace

Status: implemented

## Problem

Phoenix already has an in-flow KIRA/subagent card beside the conversation, but Cordis-driven visual material had no coordinated presentation surface. Showing an image, video, page, or supporting text either replaced conversation context, opened an unrelated browser surface, or risked covering the chat. The missing coordination was especially visible when the KIRA/subagent card and Cordis content were active at the same time: both needed a predictable right-side area, Cordis needed to open below KIRA, and closing Cordis had to restore the user's prior shell state exactly.

## Decision

The layout service exposes named visual-workspace occupancy for `subagent` and `cordis`, but their geometry responsibilities are intentionally different. The expanded KIRA/subagent card already reserves its own width in the center flow, so `subagent` occupancy is metadata used only to coordinate stacking. It does not collapse navigation or take over the ordinary details column.

Cordis owns the temporary shell transition. `ui-workspace` provides `ctx.visualWorkspace`; the first `show()` snapshots the current sidebar and details preferences, marks the `cordis` occupant active, minimizes navigation to Phoenix's compact 56px rail, and closes the ordinary details column. Cordis itself is rendered through `shell.overlay` as a bounded in-flow rail beside the conversation, so the chat moves left instead of being covered. Replacing one Cordis item with another keeps the same active lease and therefore does not make the shell jump.

When Cordis is the only visual surface, it uses the full visual rail. When the expanded KIRA/subagent card is also active, the same overlay rail becomes a vertical stack: KIRA remains the upper occupant and Cordis uses the remaining lower area. On narrow screens the rail moves below the conversation instead of squeezing it horizontally. Closing Cordis releases only the `cordis` occupancy and restores the exact sidebar/details snapshot captured when Cordis opened; any still-active subagent occupancy remains intact.

The Cordis content contract accepts four presentation kinds: `image`, `video`, `page`, and `text`. Page URLs are limited to HTTP(S) and render in a sandboxed iframe with an explicit external-browser escape hatch. Video uses native controls and inline playback. The public controller is intentionally presentation-only: it does not execute page code outside the iframe sandbox or grant Cordis a new action channel.

The lightweight subagent header/catalog popup is not considered a visual-workspace occupant. Only the real expanded KIRA/subagent card reports `subagent` occupancy, preventing menus from accidentally forcing Cordis into a half-height layout.

## Alternatives considered

**Give Cordis its own unrelated modal.** This would avoid shell coordination, but it would cover the conversation and would not compose with KIRA/subagent content. It also creates a second window-management model inside Phoenix.

**Reuse the ordinary tool-details panel directly.** The details slot is session-scoped and semantically tied to selected tool calls. Cordis must be able to present visual material without a selected tool call, so taking over that slot would conflate two different lifecycles.

**Reserve a second fixed shell column for every visual occupant.** This was the first implementation direction, but it double-shrank the conversation because the KIRA card already occupies center-flow width. The final design keeps KIRA in-flow, closes ordinary details only while Cordis is active, and uses one shared overlay rail.

**Close one surface when the other opens.** This simplifies geometry but discards useful concurrent context. The explicit behavior is that Cordis can open beneath an already-open KIRA/subagent surface, so mutual exclusion is rejected.

**Restore a fixed default layout after Cordis closes.** That would destroy user-resized panel state. Cordis therefore restores the exact pre-Cordis sidebar and details preferences.

## Testing

`ui-layout` tests cover independent subagent occupancy, Cordis snapshot/restore, protected navigation/details behavior while Cordis is active, occupancy subscriptions, duplicate writes, and non-persistence. AppFrame tests verify that Cordis minimizes navigation while ordinary details remain closed and that subagent occupancy alone does not double-shrink the shell. `ui-workspace` tests cover Cordis activation, in-place content replacement, close/dispose release, image/video/page/text rendering, sandboxed HTTP(S) pages, invalid-URL rejection, and stacking beneath an active subagent surface. KIRA plugin tests verify that the real expanded card receives the layout face used to report occupancy.

## Consequences

Phoenix gains one coordinated visual workspace rather than ad-hoc overlays. Cordis can present pages, images, videos, and text while the conversation remains visible; an expanded KIRA/subagent card can coexist above it; Cordis temporarily minimizes navigation without stealing the ordinary details lifecycle; and closing Cordis restores the user's previous shell geometry exactly. The desktop visual rail is deliberately bounded rather than becoming a freely resizable fourth shell column. A future multi-pane workspace can add independent resizing without changing the named-occupant contract.