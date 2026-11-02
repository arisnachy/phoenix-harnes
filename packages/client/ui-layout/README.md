# @phoenix-ai/dsh-client-ui-layout

English | [中文](README.zh.md)

Shell plugin: three-column AppFrame (drag handles and concession chain) plus the `ctx.layout` panel-geometry service; it registers into the runtime-owned `root` slot and declares `sidebar`, `conversation`, `details`, and `shell.overlay`. The sidebar resize boundary is an invisible hit strip, while the details boundary retains its floating pill; only details shrinks during concession and then auto-closes. A closed sidebar retains a 56px control rail while details closes to zero width. The package also seats the theme presenter: it consumes resolved `ctx.theme` snapshots and projects them onto the document (`html { color-scheme }` for native UA chrome, `body[data-ds-dark-theme]` from the active color scheme, the theme's alias tokens as inline variables on body, and one owned `<meta name="theme-color">` whose content follows the computed body background). Measuring after palette and token application keeps the rendered background as the single color authority; disposing the presenter removes its metadata node with its other global writes.

AppFrame always mounts the conversation and details columns; a connected Session renders through `SessionProvider`. The transient layout store starts the sidebar at its default width and details closed, and it never reads or writes `localStorage`. Hero and other unselected states also derive a zero rendered details width without changing that stored preference. AppFrame retains the last non-blank Session id across those states: the first Session remains closed, an explicit details action opens the contract default width, returning to the same Session restores its unchanged width, and selecting a different Session closes details before paint. The conversation owner share is empty, while the sidebar owner share contains only `collapsed` and `width`; registrants obtain business data from standard hooks and actions from their own inject faces.

`ctx.layout` also coordinates named `subagent` and `cordis` visual-workspace occupancy. The expanded KIRA/subagent card reports its occupancy only for stacking; it already reserves its own center-flow width and therefore does not rewrite sidebar/details geometry. Cordis is different: opening Cordis snapshots the user's current sidebar and details preferences, minimizes navigation to the compact 56px rail, closes the ordinary details column, and renders Cordis inside `shell.overlay` as a bounded in-flow rail beside the conversation. That moves the chat left without covering it. If the KIRA/subagent card is already expanded, KIRA occupies the upper portion of the same rail and Cordis occupies the remaining lower portion. Closing Cordis restores the exact pre-Cordis sidebar/details snapshot while preserving any still-active subagent occupancy. On narrow screens the shared visual rail stacks below the conversation instead of squeezing it horizontally.

The `/client` exports are the plugin body (`apply`/`inject`), `LayoutController`, `ILayout`, `WorkspaceOccupancy`, `WorkspaceOccupant`, and the owner-share interfaces. AppFrame, the panel store, and the concession solver remain package-internal.

## Model Experience

None, as the layout shell manages browser viewing state; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Panel geometry is transient** — reload restores the sidebar default and details closed; switching between distinct Session ids also closes details and forgets its dragged width, while unselected surfaces render details at zero width without modifying geometry.
- **The desktop visual rail is intentionally bounded** — Cordis uses a compact right-side rail rather than a freely resizable fourth shell column; a future multi-pane workspace may add independent resizing without changing the named-occupant lifecycle.
- **Concession-chain auto-close derives a zero width without touching the preferred width** — the panel restores itself when the window widens; consumers must not read the stored details width as the rendered truth.
- **No scroll anchoring during squeeze reflow** — layout changes may move the reader's viewport.