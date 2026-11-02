# Agent Note: ChatGPT Web discovers the complete Windows runtime

Status: implemented

English | [中文](2026-09-03-chatgpt-web-runtime-discovery.zh.md)

## Problem

The `chatgpt-web` route pointed at the correct loopback port, but Phoenix required a manually supplied command and could not distinguish the complete Codex Web GPT installation from an incomplete runtime. The result was an unreachable bridge and a `TRANSPORT` failure.

## Decision

On Windows, Phoenix discovers the packaged Codex Web GPT runtime in the standard installation locations only when Bun, the CLI entrypoint, and `playwright-core` are all present. It starts the runtime with an argv array and an application working directory; an explicit `PHOENIX_CHATGPT_WEB_COMMAND` still takes precedence.

## Alternatives considered

**Always require `PHOENIX_CHATGPT_WEB_COMMAND`.** Rejected because the supported Windows launcher already provides a complete runtime and the extra manual path was the direct cause of the unreachable bridge.

**Select any matching runtime directory.** Rejected because the user's versioned installation was missing `playwright-core`; starting it only produced a dead process and a misleading transport failure.

## Consequences

After the launcher completes `Setup > Browser-only`, `dsh chatgpt-web start` can manage the local bridge without an API key or shell command. A browser session and an eligible ChatGPT account remain required, and `dsh chatgpt-web status` must report `ready` before the model route can serve requests.
