# @phoenix-ai/dsh-client-ui-kira-teams

English | [中文](README.zh.md)

Browser mission-control overlay for the active KIRA subagents in the current session. A fixed-height activity strip shows the selected agent and real model-authored activity without growing as the team grows: at most three portraits are stacked in the strip and additional agents collapse into a `+N` count. A narrow right-side rail keeps every live agent directly selectable, while an optional flat detail list expands below the strip only on demand.

The overlay never reserves conversation width. Selecting an avatar changes the agent represented in the strip; activating that focused strip highlights the agent’s interventions in the existing main conversation. Settled or idle subagents disappear from both the strip and the rail.

## Main conversation

Real child outputs carry their durable name, avatar and role in the main transcript. Message actions provide grouped Unicode reactions, a searchable native emoji picker and removal of the user’s own reactions. Reply selects quoted context above the existing composer; `@Name` or `@"Name with spaces"` addresses one or several existing continuable agents. A retained request identity prevents duplicate admission after a lost RPC response, and reconnect retries pending submissions. Pending delivery remains visible in the original row. One-shot children retain readable history but cannot be resumed through these replies.
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
