# @phoenix-ai/dsh-client-ui-kira-teams

English | [中文](README.zh.md)

Browser mission-control overlay for the active KIRA subagents in the current session. A fixed-height activity strip shows the selected agent and real model-authored activity without growing as the team grows: at most three portraits are stacked in the strip and additional agents collapse into a `+N` count. A narrow right-side rail keeps every live agent directly selectable, while an optional flat detail list expands below the strip only on demand.

The overlay never reserves conversation width. Selecting an avatar changes the agent represented in the strip; activating that focused strip opens the corresponding continuable subagent session. Settled or idle subagents disappear from both the strip and the rail.

## Model Experience

### Team activity state

#### What the model sees

Nothing from this browser-only plugin enters the model request; the overlay renders host-published `KIRA` team state for the user.

#### Token effect

This package adds no model tokens because it registers no prompt, tool, or request field.

#### KV Cache effect

This package does not assemble or send provider requests, so it does not affect provider prefix reuse.

## Known Limitations and Deferred Work

- The rail can show only live subagents published by the current host session; settled, remote, or historical teams are not included.
