# Agent Note: Phoenix local mail assistant and durable attention receipts

Status: implemented

English | [中文](2026-10-02-phoenix-local-mail-assistant.zh.md)

## Problem

Phoenix needs to accept owner email requests while the chat is closed, finish real work with Kira and show current suggestions without repeating handled results. The owner has no cloud deployment and requires an included-domain free mailbox.

## Decision

The hardness-adapters host owns AgentMail enrollment, outbound wake notifications, polling, a durable job journal and an immutable reply outbox. The credential service owns keys. Owner verification and provider authentication plus the explicit sender allowlist are enforced before model execution; automatic mail and self-mail cannot create work. Reply-To and CC cannot redirect the completion reply. Enrollment ambiguity is durable and never automatically retried.

Mail work uses a dedicated persisted root session copied from the selected coordinator's model, preset and workspace. Normal tools, approval boundaries and turn finalization remain authoritative. The scoped `phoenix_mail_complete` proposal requires a useful summary and concrete evidence; sending waits for a normal completed turn and durable cleanup. Owned shutdown preserves progress; resumption asks Kira to inspect effects before repeating actions. A blocked mission remains visible for owner review.

The receiver isolates per-message read failures so they cannot starve pending work. Polling retries failed reads. WebSocket closure clears its owner and the next poll reconnects. Outbox retries retain one key and exact content; uncertainty beyond AgentMail's 24-hour idempotency window becomes a visible blocker. No universal exactly-once guarantee is claimed across expired provider keys.

Home receipts identify the item and material revision. Filtering precedes the eight-row limit, so acknowledged top-ranked items do not starve new suggestions. New successful delivery supersedes an old failure. Results and blockers reuse the existing home layout; team avatars and reactions keep their existing contracts.

Windows login startup is an explicit local setting backed by one owned shortcut. The supervisor passes the durable installation root separately from disposable runtime checkouts. The PC must be running; startup catches up missed mail rather than pretending to execute offline.

## Alternatives considered

A hosted public webhook would require deployment and expose another ingress, contrary to the PC-only requirement. An SDK would not remove validation or enrollment recovery; native fetch implements the pinned provider operations behind a transport interface. Sending directly from a model would bypass durable completion and destination checks. Retrying indefinitely would outlive provider idempotency and risk duplicate mail. Rendering another dashboard would change the approved layout.

## Consequences

Empty polling does not call a model. The included provider domain avoids paid provisioning, but free quotas and normal model costs remain. Live mailbox activation requires the owner's verification; keyless acceptance cannot prove provider availability. Linux verification covers literal startup arguments and supervisor behavior; actual Windows shortcut execution requires a Windows installation. Incoming text is bounded and attachments are not automatically executed. Failed message reads are retried rather than discarded, costing additional provider reads until repaired.

## Testing

Focused tests cover admission denial, durable deduplication, ambiguous signup/send handling, verification attempt bounds, malformed-message isolation, owned shutdown, socket closure and attention receipts. The runnable Web composition with deterministic external mail/model providers records a committed session transcript and tests real Chromium enrollment, work with the browser closed, one reply and receipt persistence. Live provider signup and Windows login execution remain activation checks on the owner's PC.
