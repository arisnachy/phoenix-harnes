# @phoenix-ai/dsh-code-runtime-python

English | [中文](README.zh.md)

CPython-subprocess implementation of the [`@phoenix-ai/dsh-code-runtime`](../code-runtime/README.md) seam. Companion to [`@phoenix-ai/dsh-code-runtime-worker-thread`](../code-runtime-worker-thread/README.md); trades the Node worker thread for a fresh CPython subprocess so model code is Python instead of TypeScript.

The package owns the wire protocol and the production provider for that seam: the host-side frame codec, the Python-side mirror of the same message vocabulary, and `PythonCodeRuntime`, which registers as `ctx.pythonCodeRuntime`.

## Provider

`PythonCodeRuntime` starts a fresh CPython process for every run. It supports `return`, `await tools.name(args)`, streamed stdout/stderr capture, typed binding errors, abort, wall-clock timeout, output limits, and POSIX CPU/address-space limits where the host exposes them. The process receives an empty environment and uses two private protocol pipes: fd 3 carries host-to-child requests and fd 4 carries child-to-host responses; stdout and stderr remain separate capture streams. It is containment, not a security boundary; consumers must still apply the product sandbox and approval policy.

## Wire protocol

The host writes a versionless, JSON-lines request stream to the child's fd 3 and reads the child-to-host response stream from fd 4 — one JSON object per line, leaving stdout/stderr free for the program's own output. `src/protocol.ts` is the host side; `py/protocol.py` mirrors its message shapes, descriptor constants, and shared truncation-marker text on the Python side.

- **Separate protocol pipes, not stdout** — Node pins five positional pipes with `stdio: ['pipe','pipe','pipe','pipe','pipe']`; `PROTOCOL_READ_FD = 3` is the child's request input and `PROTOCOL_WRITE_FD = 4` is its response output. The separate directions avoid synchronous Python reads and writes contending on one Windows pipe. JSON-lines framing remains unchanged.
- **Host treats every child response as hostile** — model code can write forged frames through the child's fd 4, so `validateChildFrame` shape-validates and REBUILDS each response before the host handles it: forged extra fields never ride along, a non-number call id can never be echoed into a reply, and junk drops to `undefined` rather than throwing in the host's message handler. The child reads host requests from fd 3 and trusts that host-owned stream.
- **Lossless-JSON crossing** — completion values and binding arguments cross as exact JSON. `encodeJsonPlain` serializes a `JSON.parse`-produced value without recursion, so a deep value below the byte budget crosses intact instead of dying on `JSON.stringify`'s stack limit; `checkDoneValue` meters a forged completion value's byte length AND number losslessness in one traversal that rejects an over-budget payload before the incremental work it would add (the enqueued children; strings and keys are metered by a non-allocating escaped-size scan, so the escaped copy is never materialized) — the frame's own width is already parsed and capped upstream by the host's fd-4 receive buffer, not re-bounded here; `hasUnsafeIntegerToken` reads the raw frame text to catch an integer token that `JSON.parse` would silently round; `hasNonLosslessNumber` rejects a non-finite or negative-zero number in unbounded `call.args`. Beyond-safe-range integral doubles serialize through `BigInt` digits so the exact integer crosses, not the rounded `String()` form.
- **Shared truncation marker** — `logTruncationMarker(maxBytes)` produces byte-identical text on both sides, so a truncated log run reads the same however the cap was hit. The `log` frame's `truncated` flag distinguishes the child ledger's own marker from program output.

## Model Experience

Indirectly, through Code Mode in [`dsh-tools`](../../core/tools/README.md), which renders this backend's exact completion value when it fits (or an explicit `invalid-output` / `output-limit` failure), plus the exact `[dsh-code-runtime-python] log capture truncated at <maxLogBytes> bytes` log marker, into a retained `run_code` result.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **The cross-language guard covers the runtime-executed surfaces and the frame field shapes** — `tests/protocol-mirror.e2e.ts` starts a real CPython interpreter and asserts, against `src/protocol.ts`, both protocol descriptor constants, the log truncation marker text, and each `TypedDict`'s required/optional wire field set in `py/protocol.py`. What it does not compare is the field *types* (e.g. that `cpuSeconds` is an `int` on both sides): comparing type declarations across TypeScript and Python has no mechanical equivalent here, so a type-level drift is still caught by review plus the backend's real-subprocess suite rather than this package's tests.
- **The Python provider depends on a CPython executable being installed** — `pythonCommand` is configurable and defaults to `python` on Windows and `python3` elsewhere. If no interpreter is available, the provider reports a child-process failure; it does not silently fall back to TypeScript.
- **The child process is containment, not a security boundary** — model code can still use Python's standard library and must be governed by the product sandbox and approval policy before execution.
