# @phoenix-ai/dsh-client-ui-kira-teams

English | [中文](README.zh.md)

Browser dock for the active KIRA subagents in the current session. It projects the host-owned roster into a compact, refreshable panel, removes settled agents from the visible team, and shows each active agent's model name beside its task label.

## Model Experience

### Team dock state

#### What the model sees

Nothing from this browser-only plugin enters the model request; the dock renders host-published `KIRA` team state for the user.

#### Token effect

This package adds no model tokens because it registers no prompt, tool, or request field.

#### KV Cache effect

This package does not assemble or send provider requests, so it does not affect provider prefix reuse.

## Known Limitations and Deferred Work

- The dock can show only active subagents published by the current host session; settled, remote, or historical teams are not included.
