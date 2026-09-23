# Agent Note: Windows Credential Manager broker

Status: implemented

English | [中文](2026-09-23-windows-credential-manager-broker.zh.md)

## Problem

The desktop login flow needs to request and reuse credentials without putting them in model-visible Computer requests, results, or session data. The earlier AppContainer file design could not persist under its private SID ACL and failed with `0x80070005`.

## Decision

The desktop credential broker runs as a normal process under the current Windows user and stores remembered entries with `CredWriteW`, reads them with `CredReadW`, and removes them with `CredDeleteW`. Each target combines a stable Phoenix namespace with a SHA-256 hash of the canonical HTTPS origin, so the origin is not present in the Credential Manager target.

`remember=false` remains process memory only. Remembered generic credentials use the Windows 512-byte credential blob limit; the host and broker reject larger UTF-8 secrets before a successful response can be emitted. The broker keeps the private named pipe, host PID check, nonce replay check, origin-bound capability, and one-use capability consumption. A kill-on-close job ends the broker when the desktop host exits.

Credential Manager is current-user storage. This design does not claim isolation from another process with the same Windows permissions. Account and secret values are absent from process arguments, logs, and the general Computer protocol; secret fields cross only the private broker pipe and appear in a successful `FillOnce` response to the native host.

## Alternatives considered

**Store secrets in the desktop profile files.** Rejected because ordinary application files do not provide Windows Credential Manager protection and would add another secret-bearing format to maintain.

**Send credentials through the general Computer protocol or session history.** Rejected because those values can reach model requests, tool results, and durable session records.

**Keep the store inside AppContainer isolation.** Rejected because the private AppContainer SID could not use the current-user Credential Manager and the ACL-protected file write failed.

## Consequences

Remembered credentials use the current user's Windows Credential Manager and are available only to the same Windows account. This does not isolate them from another process with that user's permissions. Persistent generic credentials are limited to 512 UTF-8 bytes; credentials not marked for saving last only until the broker consumes them or exits.

## Evidence

The local Windows integration probe passed 15 synthetic-data checks covering store, restart read, fill, forget, transient non-persistence, different-origin absence, one-use capability replay rejection, oversized-secret rejection, and redacted diagnostics. The Windows workflow runs this probe after publishing the broker. A separate host-kill probe reported `BROKER_EXITED_AFTER_HOST_KILL=True`.

Credential material is absent from the general Computer protocol, tool result, session learning projection, process arguments, and broker diagnostics. Only synthetic credentials were used for the integration probe.
