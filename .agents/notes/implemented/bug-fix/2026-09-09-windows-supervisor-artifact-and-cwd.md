# Agent Note: Windows supervisor preserves artifact and launch directory

Status: implemented

English | [中文](2026-09-09-windows-supervisor-artifact-and-cwd.zh.md)

## Problem

The Windows update supervisor always restarted the Web Host from TypeScript source and changed its working directory to the repository root. A user who launched the built CLI from a project directory could therefore restart into a different artifact and lose project-relative configuration after an update.

## Decision

The CLI records whether the current entry is `src` or built `lib` and records the absolute launch directory before it enters the supervisor. The supervisor validates both values, restarts the same artifact, and preserves the launch directory for the child Host. Missing entries, relative directories, and unknown artifact values fail before spawning a mismatched process.

Browser-open tests pass their loader hook through `NODE_OPTIONS`, so the hook remains active when the Windows supervisor starts the real child process. Tests also disable automatic updates to isolate browser-open behavior.

## Alternatives considered

**Always restart from source:** rejected because installed builds may not ship source and would change the artifact selected by the user.

**Always restart from the repository root:** rejected because project-relative configuration belongs to the original launch directory.

## Verification

The CLI build passes. The focused supervisor suite passes 4 tests and the assembled browser-open snapshot passes 4 tests, including local launch, browser failure, SSH suppression, and project-relative browser configuration.

## Consequences

Source development stays source-based, installed builds stay built, and update restarts retain the directory the user selected. The update supervisor no longer changes which PHOENIX runtime artifact or project configuration is active.
