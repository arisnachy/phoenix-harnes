# Agent Note: Nemotron 3 Nano input context was underestimated on OpenRouter

Status: implemented

## Problem
Phoenix rejected a request for `nvidia/nemotron-3-nano-30b-a3b` because the computed safe input budget was 122,880 tokens after reserving 4,096 for safety and 4,096 for output. Therefore the resolved model `contextWindow` was 131,072, while the outgoing input was estimated at 187,208 tokens.

## Decision
OpenRouter's public model page documents a 262,144 token context window for exactly this route: https://openrouter.ai/nvidia/nemotron-3-nano-30b-a3b

Restore the documented context when an inherited catalog capacity is stale on the official OpenRouter endpoint. The effective safe budget then becomes 253,952 tokens and this particular 187,208-token request is admissible.

Never increase an explicit user model context override or a private gateway whose actual capacity may be lower. Do not silence true CONTEXT_WINDOW_EXCEEDED failures; retain request-only catalog/tool fitting and the durable compaction recovery path. Model/provider upstream endpoints may enforce stricter limits than the public directory. Those remain real, recoverable context errors or blocks, not permission to fabricate success.

## Regression
Catalog tests verify official-route correction, non-OpenRouter isolation, override precedence, and the example 187,208-token request. Context-fitting tests ensure the original user content remains intact when the chosen route cannot fit it.

## Consequences

The corrected public route remains subject to upstream limits and normal context recovery.

## Alternatives considered

Increase every model context window, including user overrides and private gateways. Rejected because their real limits cannot be inferred from the public catalog.
