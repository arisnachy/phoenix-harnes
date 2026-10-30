<p align="center">
  <img src="apps/web/public/phoenix-emblem.png" alt="PHOENIX — Universal AI Harness" width="300">
</p>

# PHOENIX

English | [Español](README.es.md) | [中文](README.zh.md)

**PHOENIX is a local-first cognitive AI workspace: one environment to think, coordinate, act, verify, and recover across models, tools, and projects.**

**Kira** is the orchestration experience at its center. PHOENIX is designed to connect a user's goals with specialized agents and capabilities, while preserving context, showing evidence of real work, and keeping the human in control. It is **not defined by any single model, provider, or earlier project**.

> **One mission. The right intelligence. Verifiable execution.**

## What makes PHOENIX different

| Pillar | What it means |
| --- | --- |
| **Kira and coordinated agents** | A primary assistant can organize work, route tasks to specialists, and keep user-facing updates distinct from internal team coordination. |
| **Freedom to choose models** | Provider-agnostic adapters and model selection, with OpenRouter and an optional native ChatGPT / Codex connection documented below. |
| **Continuity by design** | Local session history, replayable events, and checkpoints underpin work that can resume and be audited; broader cognitive memory is an evolving capability. |
| **Real tools, real receipts** | Tools, browser and filesystem integrations, permissions, and result evidence are part of the workflow—not a simulated list of actions. |
| **A workspace, not only a chat** | A Web UI, Windows launch paths, IDE integration, and a composable plugin architecture bring capabilities together. |
| **Failure-aware execution** | Guarded releases, isolated preflight checks, recovery points, and rollback aim to keep updates from destroying a working installation. |

## Specialized workspaces

PHOENIX is being extended for **scientific research and publishing**, **clinical copilot workflows**, **market analysis and trading**, **sports intelligence**, **business operations**, and **scheduled automation**. These are development tracks—not a promise that every feature is installed, production-ready, autonomous, or authorized for real-world actions. Each integration must pass its own operational and safety checks.

## Development status

PHOENIX is an actively developed product with its **own identity, architecture, roadmap, and direction**. Features are shipped incrementally, and a design document or open pull request is not evidence that a capability works in `main` or `stable`.

Some internal package names and CLI identifiers remain for runtime compatibility. They are implementation details, not PHOENIX branding; changes to them must preserve existing installations and workflows.

For the implementation model and evidence boundaries, read the [architecture](docs/architecture.md), [development guide](docs/development.md), and [capability interfaces](docs/capability-seams.md).

## Run

### One-line Windows install

Open PowerShell and run:

```powershell
irm https://raw.githubusercontent.com/arisnachy/phoenix-harnes/main/install-phoenix.ps1 | iex
```

The bootstrap installs missing Node.js/Git through `winget`, clones or fast-forwards the dedicated PHOENIX installation, performs an immutable dependency install and build, and creates **PHOENIX HARDNESS** shortcuts in the Start menu, Windows startup, and the taskbar shortcut store. Windows versions without a localized pin action still receive a taskbar-ready shortcut; pin it once from the shortcut context menu. Use `-NoStartup` or `-NoTaskbar` to opt out. Managed installations check the promoted `stable` branch at launch and apply only clean, preflighted updates; a clean managed release checkout may also safely replace unrelated legacy history while retaining a recovery ref. Set `PHOENIX_AUTO_UPDATE=0` to disable that check. Local changes are preserved instead of overwritten. The script is not a signed MSIX; code signing remains a release gate until a project certificate is configured.

### VS Code and Cursor

Build the installable extension with `pnpm --dir apps/vscode run package:vsix`, then install `dist/phoenix-hardness-vscode.vsix` from **Extensions → Install from VSIX**. Its Explorer panel starts the local PHOENIX runtime and opens the Web UI without reading model credentials.

### Run from source

Install Node.js 22.19 or newer, then:

```powershell
git clone https://github.com/arisnachy/phoenix-harnes.git
cd phoenix-harnes
.\phoenix-windows.cmd
```

`phoenix-windows.cmd` changes to its own repository directory, uses the Corepack copy included with Node.js to prepare dependencies, builds PHOENIX when needed, and starts the local Web UI. A global `pnpm` installation is not required.

### Stable automatic updates

PHOENIX source installations follow the repository's stable update channel. A new `main` commit is published to clients only after the current `main` CI succeeds. Running installations detect the new stable commit and, by default, install it after the active PHOENIX session closes; Windows also checks the stable channel before the next launch.

Automatic installation requires an official `origin`, branch `main` or `stable`, a clean worktree, a successful isolated preflight build, and a recovery checkpoint. A locally modified checkout may still prepare and validate a candidate in detached staging, but it is never overwritten or activated until clean. Fast-forward releases use `git merge --ff-only`; managed release checkouts with unrelated legacy history use a guarded `git reset --hard` after preflight. A failed live update rolls back to the previous known-good commit. Development branches and locally modified checkouts are never overwritten automatically, and the updater never mutates PHOENIX user data, credentials, sessions, memories, or projects.

Set `PHOENIX_UPDATE_MODE=notify` for notifications without installation or `PHOENIX_UPDATE_MODE=off` to disable checking. See [PHOENIX Stable Auto-Update](docs/evolution/PHOENIX_AUTO_UPDATE.md) for the complete release, recovery, and trust contract.

Codex plugin and OpenClaw skill updates use the isolated [upstream intake](docs/evolution/PHOENIX_UPSTREAM_INTAKE.md), which stages and verifies candidates before changing initialized bridges.

### Configure OpenRouter on Windows

PHOENIX starts with the `openrouter/free` model route selected. Create an [OpenRouter API key](https://openrouter.ai/settings/keys), then configure it inside PHOENIX:

1. Open **Settings → Models → OpenRouter**.
2. Paste the key and save it. The key is written to the local PHOENIX credential store and is not committed to Git.
3. Use the model selector in the composer to switch from `openrouter/free` to another OpenRouter model.

The provider, key, endpoint, model catalog, and active model are managed from the Web UI. Free models are intended for testing and remain subject to OpenRouter availability and rate limits.

### Connect ChatGPT / Codex

PHOENIX keeps OpenAI API-key authentication separate from ChatGPT subscription authentication. The native Codex bridge uses the official Codex app-server managed ChatGPT login, so Codex owns OAuth persistence and token refresh. PHOENIX does not ask for a ChatGPT password and does not parse, copy, or persist ChatGPT OAuth tokens.

When the native Codex bridge is mounted, **Settings → Models → Account connections** offers **ChatGPT / Codex** sign-in. The same native account plane can read the active ChatGPT plan, Codex rate-limit windows, reset times, and account token-activity data without routing the subscription through the generic `pi-ai` OAuth adapter.

## Community and support

Use this repository's [Issues](https://github.com/arisnachy/phoenix-harnes/issues) and [Discussions](https://github.com/arisnachy/phoenix-harnes/discussions) for PHOENIX feedback, bugs, design discussion, and support.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md). PHOENIX capabilities are integrated through staged, independently verified branches and pull requests so the stable base stays auditable.

Windows installation, IDE packaging, native sandbox boundaries, and continuity status are documented in [PHOENIX on Windows](docs/phoenix-windows.md).

For agents, follow [AGENTS.md](AGENTS.md).

## Open-source components and attribution

PHOENIX has its own product identity and development direction. The repository also includes open-source components authored by other projects. Their authorship, license notices, vendored source origins, and local changes remain documented in [LICENSE](LICENSE), [vendored package provenance](vendor/README.md), and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Acknowledging code provenance does **not** make PHOENIX a rebrand or an evolution of another product.

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
