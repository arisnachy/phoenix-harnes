# `@phoenix-ai/dsh`

English | [中文](README.zh.md)

The `dsh` command is the product launcher for profiles: ordered stacks of plugin-bundle patch layers under the user's own overrides. [`src/args.ts`](src/args.ts) owns the command grammar, and [`src/bin.ts`](src/bin.ts) loads only the selected runner. Invalid commands, options from another mode, configuration errors, and boot failures exit nonzero.

## Entry modes

| Command | Purpose |
|---|---|
| `dsh --profile <name>` | Boot the named profile under `$DSH_HOME/profiles/<name>`. |
| `dsh --profile headless "job"` | Run one fresh persisted session, print the final answer, and exit. |
| `dsh web` | Alias of `--profile web`. |
| `dsh plugin --profile <name> <pnpm args>` | Manage a profile's plugins by forwarding to pnpm in the profile directory. |
| `dsh chatgpt-web <start\|status\|stop>` | Start, inspect, or stop an explicitly configured local ChatGPT Web Responses bridge. |
| `dsh upstream-update --check` / `--apply` / `--doctor` | Check or safely receive initialized Codex plugin and OpenClaw skill bridge updates. |

The invoking directory is the default workspace root. The `web` and `headless` profiles auto-initialize on first use from shipped templates; any other profile must be created through `dsh plugin`.

## ChatGPT Web bridge

PHOENIX can use the local [codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web) bridge as the `chatgpt-web` model route. The bridge owns browser login and cookies; PHOENIX never imports or stores them. On Windows, complete `Setup > Browser-only` in the installed Codex Web GPT launcher; `dsh chatgpt-web start` then discovers the complete packaged runtime automatically. An incomplete runtime is ignored. A manual JSON argv configuration remains available for other installations:

```powershell
$env:PHOENIX_CHATGPT_WEB_COMMAND = '["node","C:\\path\\to\\codex-chatgpt-web\\server.mjs"]'
$env:PHOENIX_CHATGPT_WEB_URL = 'http://127.0.0.1:17841/v1'
dsh chatgpt-web start
dsh chatgpt-web status
```

Browser-only uses the signed-in ChatGPT Web session and does not require a paid model API key. It still requires an eligible ChatGPT account, browser sign-in, and the local bridge to be running; `dsh chatgpt-web status` must report `ready` before selecting the route.

Only loopback endpoints are accepted. The lifecycle record stores the process id and endpoint, never command-line secrets. `dsh doctor` checks a configured bridge without starting or modifying it.

## Codex and OpenClaw upstream intake

The intake watcher compares initialized bridge states with the official `main` heads, stages candidates in a separate DSH home, runs native bridge verification, and activates only a journaled transaction that passes. `PHOENIX_UPSTREAM_UPDATE_MODE=auto` applies verified candidates, `notify` records availability, and `off` disables the watcher. An unconfigured bridge remains idle. See [the upstream intake reference](../../docs/evolution/PHOENIX_UPSTREAM_INTAKE.md).

## App arguments

The launcher parses only its own flags and hands everything after them to the booted profile, where any injected app plugin may parse the shared immutable snapshot ([`dsh-cmdline`](../../packages/boot/cmdline/README.md)). Launcher flags therefore come first, and the first token the launcher does not recognize starts the app's arguments:

```sh
dsh --profile web --port 8080       # --port belongs to the web app
dsh --profile tui --resume <id>     # example, assuming the tui profile is installed; --resume belongs to the terminal app
dsh --profile headless "run the tests"
dsh --profile web --help            # the web app's flags, not the launcher's
dsh --help                          # the launcher's own help
```

## Profiles

A profile directory holds a `package.json` (out-of-tree plugin dependencies plus the profile manifest `dsh.profile` with its ordered `bundles` list) and a `cordis.patch.yml` (the user's own patch layer).

The tree composes over an empty root:
- each bundle's patch in `dsh.profile.bundles` order
- then the profile's `cordis.patch.yml`, then the home-level `$DSH_HOME/cordis.patch.yml`
- then `--patch` overlays

Bundles named in `dsh.profile.bundles` resolve from the dsh installation first (`@phoenix-ai/dsh-base`, `@phoenix-ai/dsh-web-app`, `@phoenix-ai/dsh-headless`), then from the profile's own `node_modules`, where pnpm installs out-of-tree plugins.

Use `--dump-default-config` and `--dump-config` to inspect the composed tree without booting it.

The [CLI behavior reference](reference/README.md) owns exact layer precedence, flags, shutdown behavior, deployment defaults, and source execution.

## Development

Production runs require built package and frontend artifacts. From the repository root, run `pnpm run build` separately, then use `pnpm dsh <args...>` to run the TypeScript entry and forward every argument; the [source-execution reference](reference/README.md#source-execution) owns the module-resolution contract.
