# Agent Note: ChatGPT Web persisted toggle

Status: implemented

English | [中文](2026-09-17-chatgpt-web-persisted-toggle.zh.md)

## Problem

Phoenix already had a `chatgpt-web` model profile and a CLI controller for the loopback `codex-chatgpt-web` bridge, but Settings could not control the bridge. A configured model route could therefore outlive its bridge, while a manually started bridge could run without any visible product state. Restart also had no durable user choice telling the Host whether the bridge belonged on or off.

## Decision

The Host plugin inventory owns one shared ChatGPT Web lifecycle implementation used by both the CLI facade and Settings. The lifecycle keeps browser authentication outside Phoenix, accepts only loopback endpoints, records process ownership separately from a small persisted enabled preference, and restores the bridge on Host startup only when that preference is ON.

Settings → Connectors exposes a ChatGPT Web switch through the typed Host Remote. Enabling starts the bridge and requires a healthy `/v1/models` response before `llm-pi-ai.providers.chatgpt-web` is written. If the settings write fails, the bridge is disabled again. Disabling removes the provider route before stopping the owned bridge process, so the model picker never advertises a route that Phoenix intentionally turned off.

The existing `llm-pi-ai` ChatGPT Web defaults remain the routing authority: the provider profile keeps the loopback Responses endpoint and its non-secret local authorization marker, while the bridge remains the authority for browser-session eligibility and live model availability.

## Alternatives considered

**Make the browser UI spawn the bridge directly.** Rejected because subprocess ownership belongs to the Host and a browser surface cannot safely own restart, cleanup, or machine paths.

**Keep CLI and Settings lifecycle implementations separate.** Rejected because two process controllers could disagree about ownership state, health, and stop behavior.

**Expose the model route immediately and start the bridge afterward.** Rejected because a selectable provider backed by an unreachable loopback endpoint fails after the user has already chosen it.

## Consequences

ChatGPT Web is an explicit opt-in integration with a durable ON/OFF state. ON survives a Phoenix restart, OFF does not start the bridge in the background, missing Browser-only setup is reported without exposing the provider route, and failed health checks leave no persisted enabled state. The CLI remains available for diagnostics and manual lifecycle commands but uses the same controller as Settings.
