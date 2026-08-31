# Agent Note: ChatGPT Web bridge lifecycle

Status: implemented

English | [中文](2026-08-30-chatgpt-web-lifecycle.zh.md)

## Problem

PHOENIX had a named `chatgpt-web` model route and a health check, but users still had to manage the local bridge process separately. A bridge that was installed but not running therefore required undocumented manual steps.

## Decision

`dsh chatgpt-web start|status|stop` now manages an explicitly configured local bridge. `PHOENIX_CHATGPT_WEB_COMMAND` is parsed as a JSON argv array and is spawned without a shell. `PHOENIX_CHATGPT_WEB_URL` defaults to `http://127.0.0.1:17841/v1` and rejects non-loopback hosts, embedded credentials, and unsupported schemes. The controller writes an owner-only state record atomically after spawn and removes it on stop or process failure.

The state record contains only schema, process id, and loopback endpoint. Browser profiles, cookies, passwords, authorization headers, and command output remain owned by the external bridge and are never copied into PHOENIX state. Status queries `/v1/models` and expose only a bounded ready/unavailable result.

## Consequences

The route has an explicit local lifecycle and can be diagnosed or resumed after the launcher exits. The command does not bundle an unofficial ChatGPT login or claim that the external bridge is available when it is not. A user must install and authenticate the bridge separately, then configure its argv.

## Alternatives considered

Starting an arbitrary shell command would make quoting and credential leakage harder to control, so the command is an explicit argv array. Persisting the full command would risk copying secrets into state, so ownership stores only the process id and endpoint.

## Testing

`apps/cli/tests/chatgpt-web-bridge.spec.ts` covers loopback configuration, malformed command rejection, atomic ownership state, model health, and owned-process stop. `apps/cli/tests/doctor.spec.ts` continues to cover bounded health parsing. The focused run passes 2 files and 9 tests.
