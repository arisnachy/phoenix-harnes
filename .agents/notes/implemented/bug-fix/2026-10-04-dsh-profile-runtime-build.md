# Agent Note: DSH profile runtime build completeness

Status: implemented

English | [中文](2026-10-04-dsh-profile-runtime-build.zh.md)

## Problem

The local DSH profile fallback correctly linked `@phoenix-ai/dsh-tool-google-workspace` from the Phoenix installation, but the package's compiled `lib/index.js` was never produced because the full Host build stopped earlier with TS7016 on the JavaScript-only `phoenix-git-safe-directory.mjs` helper. The resulting `.dsh/profiles/node_modules` junction therefore pointed at a real package directory whose declared runtime entry was absent, causing repeated `ERR_MODULE_NOT_FOUND` failures during loader startup.

## Decision

Ship an explicit `.d.mts` declaration for the shared Git safe-directory helper so the Host TypeScript build can complete. The full build now also verifies the compiled main artifact for the profile-critical Authorization, MCP client, MCP registry, Google Workspace tool, and Host plugin-inventory packages before it can be considered successful.

The CLI bundle resolves the emitted Git helper import to its source file through an explicit build alias. TypeScript preserves the source-relative JavaScript specifier in `lib/types`, where its directory depth differs; the bundler must resolve that import before shipping the CLI. The helper is included in the existing bundle rather than copied into `.dsh` profiles.

## Alternatives considered

**Copying the helper into generated directories** was rejected because it duplicates runtime files and couples the profile layout to source directory depth. The bundler alias keeps the shared helper in the existing CLI artifact. Suppressing TS7016 was rejected because it would remove the type contract without repairing missing runtime output.

## Consequences

A successful full build is now strong evidence that the lightweight `.dsh/profiles/node_modules` junction farm points at runnable packages rather than source-only package directories. Missing profile runtime output fails during preparation/build instead of surfacing later as a Host restart loop.
