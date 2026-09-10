# Agent Note: Contextual details workspace

Status: implemented

## Problem

Tool output already had a details column and structured renderers, but the chat timeline did not expose a direct, low-friction way to send a specific tool call into that workspace. Visual tool output such as a Computer Use screenshot also fell back to text when no specialized card matched, which prevented the details column from acting as the persistent contextual surface intended by the premium UI.

## Decision

The chat node owner carries the existing `openDetails` presentation action from the conversation view to tool-call rendering. Each tool row exposes a localized details control that selects that call and opens the existing right-side workspace. The action changes only UI selection and layout state; it does not alter input submission, cancellation, session events, tool execution, or agent-loop behavior.

Settled tool results may expose an image artifact in `meta.artifact`. The generic details renderer displays only complete browser-loadable `data:image/...` artifacts with a non-empty title; terminal, read, diff, search, web, running, and raw-text paths keep their existing precedence after that visual check. This gives Computer Use and future visual tools a safe generic preview without importing another plugin's implementation component.

## Alternatives considered

**Build a second artifact panel.** Rejected because the conversation package already owns selection, details width, close behavior, and the `conversation.details.tool` slot; duplicating that state would create competing panel lifecycles and more opportunities to interfere with the composer.

**Route tool-row clicks through the trajectory inspector.** Rejected because trajectory inspection changes views and serves a different debugging task. UI-4 keeps the chat visible while the selected tool output stays beside it.

**Import the existing artifact component across plugin packages.** Rejected because client plugins compose through slots and plain owner data rather than cross-package implementation imports. The generic image preview therefore remains local to the tool details renderer.

## Testing

The UI-tool component specification verifies that the details control sends the selected turn/call/tool identity to `openDetails` and that an image artifact renders as an accessible image. Repository CI continues to own exhaustive coverage, static gates, snapshots, Windows lanes, package consumers, and build verification.

## Consequences

UI-4 reuses one details workspace instead of adding a parallel viewer, so opening or closing contextual output remains independent from mission execution and composer state. The generic visual fallback is deliberately narrow: unsupported or incomplete artifacts continue to use the established structured or raw-text paths until a dedicated renderer owns them.
