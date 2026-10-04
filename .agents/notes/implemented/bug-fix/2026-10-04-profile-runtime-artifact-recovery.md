# Agent Note: Profile runtime artifact recovery

Status: implemented

## Problem

The Windows supervisor already detected missing compiled modules under the shared profile fallback and knew how to run a full Phoenix rebuild, but it trusted the `web --dump-config` preflight before starting that repair. That preflight can succeed without importing every configured plugin, so a package such as `@phoenix-ai/dsh-tool-google-workspace` could have a valid package manifest but no compiled `lib/index.js`. The real Host then failed with `ERR_MODULE_NOT_FOUND`, while the supervisor restarted it and the updater repeatedly prepared the same stable revision.

## Decision

A profile fallback link whose package manifest exists but whose declared `main` artifact is missing is authoritative evidence that the local installation is incomplete. The Windows supervisor performs one full `scripts/build.ts` repair even when `--dump-config` succeeds. After the build, it verifies both the profile fallback and the boot preflight; if a linked package still lacks its declared main artifact, recovery fails closed instead of entering another restart loop. Dangling links whose package manifest no longer exists remain ignored because the profile fallback deliberately tolerates stale links from packages removed from the current installation.

The same rule applies during initial supervisor startup and after an unexpected Host exit. The crash path combines direct fallback inspection with the existing error-text detection so a real `/profiles/node_modules/.../lib/...` import failure still triggers repair even when the preliminary profile scan did not observe it.

## Alternatives considered

**Trust `web --dump-config` as the only recovery gate.** This is cheaper, but it does not guarantee that every loader entry has been imported and is the condition that allowed the restart loop.

**Rebuild only `build:lib:host`.** The missing package is a runtime artifact problem and future incidents may involve browser or generated artifacts as well; the updater repair uses the same full build path that prepares a normal runnable Phoenix checkout.

**Delete the whole profile fallback and recreate it.** The missing artifact is in the linked installation package, not in the link itself. Recreating links would point to the same incomplete package and would also disturb intentionally tolerated stale links.

## Consequences

A newly introduced in-box package can no longer leave Phoenix trapped in a Host restart loop merely because its ignored compiled output is absent in the live checkout. Recovery is slightly more expensive when it is needed because it runs the full build, but it runs only after concrete missing-artifact evidence and verifies that the condition is actually gone before relaunching.
