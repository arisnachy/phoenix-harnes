# Agent Note: Native universal diagram publishing in the conversation

Status: implemented

English | [中文](2026-10-20-native-universal-diagrams.zh.md)

## Problem

A model can report that it published a family genogram or relationship diagram while the chat displays no renderable object. Scene and geographic maps already have native renderers and tool publishers, but their data models do not represent arbitrary entities and relationships.

## Decision

A separate `phoenix_diagram` model tool admits bounded, script-free node-and-edge specifications, returns an actual `application/vnd.phoenix.diagram+json` artifact through the existing output pipeline, and records emission without claiming an inspected client render. `DiagramSurface` presents the same specification from the artifact path or a typed `generative-ui` block. It renders semantic selectable nodes and edge waypoints in accessible SVG, supports SVG export and a composer-only follow-up, and rejects unsupported or off-screen data before accepting publication. Graph kinds include genograms, flowcharts, mind maps and networks; these are specializations of one generalized renderer rather than changes to the agent loop. The system prompt routes graph requests to the publisher. A diagram-specific assistant-text guard flags unsupported text-only publication claims.

## Alternatives considered

**Treat every diagram as HTML in MiniBrowser.** Rejected: it delegates display to an unrelated session browser, cannot guarantee an in-chat artifact and permits silently broken scripts or external resources.

**Render every relationship as a fictional/geographic map.** Rejected: spatial landmarks and geographic coordinates are not a model for family relations, junctions or directed process edges.

**Treat the tool's receipt as proof of a user-visible render.** Rejected: the server confirms an artifact event, not browser mount, layout or input behavior.

## Consequences

The renderer is offline, reusable and backward-compatible with the existing artifact and UI transports, but the model currently provides node positions and may need to revise crowded layouts. The first iteration does not auto-layout arbitrary graphs, implement clinical pedigree notation beyond conventional basic square/circle shapes, or audit genealogical truth. Family and clinical details must come from the user. Automated DOM tests cover mounts and actions; client visual acceptance still requires an actual browser test.
