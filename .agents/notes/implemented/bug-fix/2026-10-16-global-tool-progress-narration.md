# Agent Note: Throttle tool-chain narration across Phoenix tasks

Status: implemented

English | [中文](2026-10-16-global-tool-progress-narration.zh.md)

## Problem

In an ordinary browser form test, thirteen browser calls consumed about ten seconds, while the model took over four minutes and produced repeated progress commentary across roughly twenty steps. The problem was not specific to forms: the global system prompt asked for narration every two or three tools, and the AgentLoop inserted a new model-visible progress reminder after every silent tool-only step. Both behaviors can turn any otherwise productive tool chain into repeated model conversation.

## Decision

The harness identity now requests concise updates at a material finding, blocker, changed plan, or roughly twenty seconds of silent work rather than every few tool calls. The concrete AgentLoop tracks its last visible progress within an execution interval, and injects its logged reminder only after a twenty-second quiet interval when additional tools remain. Visible model output resets the interval. The automatic continuation message directs agents to reuse verified work and finish instead of restarting plans. The Kira Max persona carries the same general rule for work of any domain, and explicitly stops continuation once the actual acceptance requirements are fulfilled.

## Alternatives considered

**Silence all progress updates.** A long running operation would become opaque to the human and it would be harder to explain a real blocker.

**Only optimize browser actions.** The measured tool duration was a small fraction of total latency, while the repeated narration instructions are shared across every tool domain.

**Force a fixed number of model steps for every task.** Complex legitimate work cannot be bounded by a universal count without making results incomplete. The existing goal evidence fences and tool budgets retain domain-appropriate authority.

## Consequences

Short tool-only sequences can now continue without a forced progress message or its added transcript tokens. Long silent execution continues to receive an occasional status reminder. Explicit user input, tool approvals, existing session events, goal completion gates and verification semantics remain unchanged. A model may still choose to narrate excessively; these changes remove specific system-level incentives and make Kira's instructions consistent but do not guarantee a reduction in every provider or task.

## Testing

Focused AgentLoop tests cover no reminder on an immediate tool continuation and the twenty-second decision threshold. TypeScript and Windows build checks run in GitHub CI; end-to-end model latency must still be measured in the user environment.
