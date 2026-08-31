# PHOENIX Stable Auto-Update

English | [中文](PHOENIX_AUTO_UPDATE.zh.md)

PHOENIX source installations use a reviewed stable channel instead of blindly pulling every GitHub branch.

Codex plugin and OpenClaw skill updates use the separate staged intake described in [PHOENIX Codex and OpenClaw Update Intake](PHOENIX_UPSTREAM_INTAKE.md); they never modify PHOENIX source files.

## Release path

```text
upstream / labs / feature branches
            |
            v
phoenix/evolution-inbox
            |
      KIRA + CI gates
            |
            v
          main
            |
       CI succeeds
            |
            v
 phoenix/update-channel
            |
            v
     PHOENIX installs
```

`main` is the stable source of truth, but a new `main` commit is not distributed until the repository's `CI` workflow succeeds for the current `main` head. `.github/workflows/phoenix-stable-update-channel.yml` then publishes the exact 40-character commit SHA to `.phoenix/channel/stable.json` on the isolated `phoenix/update-channel` branch.

The update channel contains metadata only. Experimental source is never copied into it and clients never install from `phoenix/evolution-inbox`, Codex branches, Claude branches, DeepSeek upstream branches, or a laboratory branch.

## Client behavior

Source checkouts run `scripts/phoenix-auto-update.mjs`.

Default policy is `PHOENIX_UPDATE_MODE=auto`:

1. verify that `origin` is the official PHOENIX repository;
2. require the checkout to be on `main`;
3. fetch the stable-channel manifest;
4. verify the nominated commit is reachable from `origin/main`;
5. refuse downgrade or divergent history;
6. refuse automatic mutation when the worktree contains local changes;
7. create a detached temporary Git worktree at the candidate commit;
8. run a frozen dependency install, full build, and CLI smoke test there;
9. record the current commit at `refs/phoenix/recovery/last-good`;
10. advance live `main` using `git merge --ff-only` only;
11. install, rebuild, and smoke-test the live tree;
12. if the live step fails, reset to the recovery commit and rebuild the last known-good version.

The updater does not read, copy, reset, delete, or migrate `$DSH_HOME`, credential stores, sessions, user projects, memories, or other user data.

## While PHOENIX is open

The CLI starts a low-frequency update watcher. The default poll is ten minutes. When a new stable SHA appears, the running harness prints an update notice but does not replace its own files while a session is active. In `auto` mode installation is deferred until that PHOENIX process exits, then the candidate is re-fetched and revalidated before installation.

The next Windows launch also performs an update check before boot. Ordinary network/channel failures leave the last-known-good PHOENIX available. Only the exceptional condition where both a live update and its rollback fail uses fatal updater exit code `12`.

## Policy controls

- `PHOENIX_UPDATE_MODE=auto` — default; notify and install stable updates safely.
- `PHOENIX_UPDATE_MODE=notify` — announce availability but do not mutate the checkout.
- `PHOENIX_UPDATE_MODE=off` — disable stable-channel checks.
- `PHOENIX_UPDATE_POLL_MS=<milliseconds>` — watcher interval, clamped to at least one minute.

Development branches are never auto-updated. A developer can therefore work on `phoenix/*`, `codex/*`, or another branch without the stable updater rewriting that branch.

## Recovery and audit

The last pre-update source commit is retained at:

```text
refs/phoenix/recovery/last-good
```

The latest updater outcome is written inside the repository Git metadata:

```text
.git/phoenix-update-state.json
```

This state records source/target SHAs and outcome, not credentials or user content.

## Trust boundary

This mechanism distributes only commits that have already crossed the PHOENIX stable boundary. It is deliberately not a peer-to-peer self-modification system. A local PHOENIX may invent tools, specialists, strategies, experiments, or candidate source changes inside its laboratory/evolution boundary, but executable evolution must still become reviewed source and pass the repository gates before it reaches `main` and therefore before it can reach other PHOENIX installations.
