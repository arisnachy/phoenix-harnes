# Human output hygiene

## Problem

Conversation models, especially smaller ones, could copy model-visible implementation details or irrelevant remembered personal context into ordinary user-facing replies. A capability question could therefore expose internal instruction filenames, tool method names, or privacy boilerplate even though none of that was needed to answer the user.

## Fix

The host HARDNESS adapter now installs one response-hygiene interceptor at the `llm/stream` seam. Ordinary session responses are buffered through the complete text block, sanitized before any visible text is emitted, and then forwarded with the same non-text chunks, tool calls, usage, and finish information. Auxiliary model calls and non-session calls are unchanged.

The sanitizer uses the latest direct human prompt to preserve explicit transparency. Requests that explicitly debug Phoenix internals may name implementation details, and requests explicitly about memory or personal context may discuss those topics. Otherwise internal instruction files, hidden-prompt terminology, method-like tool names, and irrelevant private-context boilerplate are removed. Simple capability questions are reduced to the first useful user-facing sentence after sanitation.

The HARDNESS model-facing protocol also states the corresponding behavior: memory personalizes silently, implementation details stay internal unless debugging is requested, clear executable requests are acted on without unnecessary clarification, and replies use human capability language rather than API narration.

## Verification

Regression coverage includes the Gmail capability-response failure, an ordinary action response that must remain unchanged, explicit Phoenix-internals debugging, explicit personal-memory questions, and English/Spanish protocol assertions. The initial regression was observed failing before the sanitizer existed; the final branch is gated by the repository build and CI before promotion.
