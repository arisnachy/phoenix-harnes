# @phoenix-ai/dsh-client-ui-kira-teams

English | [中文](README.zh.md)

Browser mission-control overlay for the active KIRA subagents in the current session. A fixed-height activity strip shows the selected agent and real model-authored activity without growing as the team grows: at most three portraits are stacked in the strip and additional agents collapse into a `+N` count. A narrow right-side rail keeps every live agent directly selectable, while an optional flat detail list expands below the strip only on demand.

The overlay never reserves conversation width. Selecting an avatar changes the agent represented in the strip; activating that focused strip highlights the agent’s interventions in the existing main conversation. Settled or idle subagents disappear from both the strip and the rail.


Kira keeps her fixed portrait when models change. A small badge beside it identifies the actual output model: sun for Sol, moon for Luna, star for Astra, and lightning for other models. Its accessible label and tooltip carry the exact provider and model. Missing provenance produces no model badge, and historical badges follow each message source rather than the currently selected model.
## Team Studio

Settings now includes an **Equipo** section backed by the Agent Teams design namespace. The user can keep multiple team designs, choose the active one, rename the team or Kira, and edit every one of the twenty specialist slots. Each persona exposes display name, role, gender/self-reference, personality, voice description, enabled state, and an avatar chosen from the bundled portrait roster.

The editor reuses `ModelActivityAvatar`, so previews and the live rail retain the same lightweight reactive motion used during real work rather than introducing a static-avatar subsystem. Motion can be subtle, normal, or expressive and respects the browser's reduced-motion preference.

The AI prompt box does not generate a disposable mockup. It sends a governed request to the current Phoenix conversation; Kira applies the result through the Lead-only `design_team` tool, preserving stable runtime ids while changing visible identity. Franchise references are treated as creative direction for an original reinterpretation. Existing Phoenix image generation remains available from chat for new raster art; the settings picker itself intentionally uses durable bundled portraits until generated-attachment avatar storage has its own authorization contract.
## Main conversation

Kira and real child outputs display complete portraits at their actual chat size, with durable names and roles. Reactions belong to individual messages: Kira and teammates can react to user messages or to one another. Newly received reactions pulse briefly, respect reduced-motion preferences and do not replay the initial history. Reaction portraits remain fully visible, and user-message reactions align beneath the user message. Message actions provide grouped Unicode reactions, a searchable native emoji picker and removal of the user’s own reactions. Reply selects quoted context above the existing composer; `@Name` or `@"Name with spaces"` addresses one or several existing continuable agents. A retained request identity prevents duplicate admission after a lost RPC response, and reconnect retries pending submissions. Pending delivery remains visible in the original row. One-shot children retain readable history but cannot be resumed through these replies.
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

Inherited Team messages remain readable in an ordinary user fork. Controls for another mission are disabled; new replies and reactions stay owned by the current mission.
