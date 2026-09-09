# Agent Note: the code-runtime-python duplex frame protocol

Status: implemented

English | [中文](2026-07-31-code-runtime-python-fd3-protocol.zh.md)

## Problem

The CPython code-runtime backend (`@phoenix-ai/dsh-code-runtime-python`) runs each model program in a fresh isolated CPython subprocess and bridges binding calls and completion values over private child descriptors. The protocol needs explicit directions because a synchronous reader and writer sharing one Windows pipe can block each other. The host also cannot trust child responses: model code can forge any response frame, so every inbound frame must be validated and rebuilt before the host handles it. The protocol carries lossless JSON without relying on recursive `JSON.stringify` or `json.dumps` depth.

## Decision

`src/protocol.ts` is the host side of the wire vocabulary and its hostile-frame codec:

- **`validateChildFrame`** shape-validates and REBUILDS every inbound child response from fd 4. The compile-time union does not constrain a runtime frame: a forged frame can carry `null`, poisoned fields, or omit required ones, so each accepted frame is reconstructed field by field. Forged extras never ride along, a non-finite call id can never be echoed into a reply, and junk returns `undefined` to be dropped rather than throwing in the host's message handler.
- **`encodeJsonPlain` / `checkDoneValue` / `hasUnsafeIntegerToken` / `hasNonLosslessNumber`** are the lossless-JSON codec and meters. They traverse iteratively (an explicit stack, not recursion) so a deep value below the byte budget crosses intact; `checkDoneValue` folds byte-metering and number-losslessness into one walk that rejects an over-budget payload before the incremental work it would otherwise add — the enqueued children; strings and keys are metered by a non-allocating escaped-size scan (`jsonStringBytesUpTo`), so the escaped copy is never materialized. It does not re-bound the frame's own width: `done.value` is already `JSON.parse`'d when the check runs, so the payload's size is paid upstream and capped there by the host's fixed fd-4 receive buffer. Beyond-safe-range integral doubles serialize through `BigInt` digits so the exact integer crosses, not `String()`'s rounded form.
- **`logTruncationMarker`** produces the in-band marker text a log ledger emits when it exhausts its byte budget.

`py/protocol.py` mirrors the message shapes and re-declares the two descriptors both sides execute against: `PROTOCOL_READ_FD = 3` for host-to-child requests and `PROTOCOL_WRITE_FD = 4` for child-to-host responses. The shared truncation-marker text remains byte-identical.

## Wire contract

The host writes JSON-lines requests to child fd 3 and reads JSON-lines responses from child fd 4, one object per line; stdout and stderr remain separate capture streams. Host → child frames are `boot` (first), `run` (after `boot-ack`), and one `reply` per `call`. Child → host frames are `boot-ack`, `call`, `log`, and `done`. The `log` frame's `truncated` flag marks the frame that is the child ledger's own truncation marker, so the host stops capturing at the same point the child did instead of inferring it from its own budget. `done.error.kind` is one of `exception`, `invalid-output`, `output-limit`; wall/CPU budgets, aborts, and substrate death are observed host-side, not carried as frames.

Node allocates five positional pipes with `stdio: ['pipe','pipe','pipe','pipe','pipe']`: stdin, stdout, stderr, fd 3, and fd 4. Keeping protocol directions on separate pipes avoids the synchronous CPython reader and writer contending on one Windows pipe while preserving the existing stdout/stderr capture streams.

## Mirror alignment

`tests/protocol-mirror.e2e.ts` starts a real CPython interpreter and compares the two descriptor constants and truncation-marker text with `src/protocol.ts`. It also compares every `TypedDict`'s required and optional wire field set with the TypeScript frame definitions, so a renamed or dropped field, or a required/optional mismatch, fails the test. Field types are not compared across the language boundary; that residue stays with review and the backend's real-subprocess suite.

## Alternatives considered

**Keep one bidirectional fd 3 for requests and responses.** Rejected. A synchronous Python `send()`/`flush()` can block while the host's reply reader is active; separate fd 3 and fd 4 pipes give each direction independent progress and preserve the original wall-clock budget.

**Move the Python JSON codec (`_encode_json_plain` / `_decode_json_plain`) into `py/protocol.py` for cross-side symmetry with `protocol.ts`.** Rejected. The host-side codec validates hostile input and is self-contained. The Python codec produces output on the trusted side and is coupled to bootstrap-internal helpers (`_Emit`, `_dump_scalar`/`_dump_string`/`_dump_float`, `LogBuffer`'s cost accounting, `_check_done_value`, `_lossless_json_violation`); lifting only the two entry points would drag that web into `protocol.py` or create a `bootstrap.py` ↔ `protocol.py` import cycle. The real cross-side parallel is host validation of fd-4 responses versus child trust of host-owned fd-3 requests.

## Consequences

The protocol has two named descriptors and a five-pipe spawn layout. The host validates and rebuilds every child response from fd 4, while the child reads host requests from fd 3 and trusts that host-owned stream. stdout and stderr remain available for program output capture. The mirror guard compares descriptor values, marker text, and field names plus required/optional status, but not field types; that residue stays with review and the backend's real-subprocess suite.
