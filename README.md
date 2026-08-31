<p align="center">
  <img src="docs/phoenix-logo.svg" alt="PHOENIX — Universal AI Harness" width="520">
</p>

# PHOENIX

English | [中文](README.zh.md)

**PHOENIX is a universal, provider-agnostic AI agent harness for local-first and bring-your-own-provider workflows.**

It is being built around intelligent model selection, durable continuity, repository intelligence, tools, multi-agent execution, recovery, evaluation, and bounded self-improvement. Capabilities land incrementally and are not presented as complete until their repository gates are green.

## Development status

PHOENIX is under active development. Its product identity is PHOENIX across the repository presentation, Web UI, PWA metadata, browser title, and visual system.

Some internal package and CLI identifiers are intentionally retained for compatibility with the upstream runtime while PHOENIX evolves through isolated, testable downstream layers. Those implementation details do not define the product identity.

## Run

### One-line Windows install

Open PowerShell and run:

```powershell
irm https://raw.githubusercontent.com/arisnachy/phoenix-harnes/main/install-phoenix.ps1 | iex
```

The bootstrap installs missing Node.js/Git through `winget`, clones or fast-forwards the dedicated PHOENIX installation, performs an immutable dependency install and build, and creates **PHOENIX HARDNESS** shortcuts in the Start menu, Windows startup, and the taskbar shortcut store. Windows versions without a localized pin action still receive a taskbar-ready shortcut; pin it once from the shortcut context menu. Use `-NoStartup` or `-NoTaskbar` to opt out. Managed installations check `origin/main` at launch and apply only clean fast-forward updates; set `PHOENIX_AUTO_UPDATE=0` to disable that check. Local changes are preserved instead of overwritten. The script is not a signed MSIX; code signing remains a release gate until a project certificate is configured.

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

Automatic installation requires an official `origin`, branch `main`, a clean worktree, fast-forward history, a successful isolated preflight build, and a recovery checkpoint. A failed live update rolls back to the previous known-good commit. Development branches and locally modified checkouts are never overwritten automatically, and the updater never mutates PHOENIX user data, credentials, sessions, memories, or projects.

Set `PHOENIX_UPDATE_MODE=notify` for notifications without installation or `PHOENIX_UPDATE_MODE=off` to disable checking. See [PHOENIX Stable Auto-Update](docs/evolution/PHOENIX_AUTO_UPDATE.md) for the complete release, recovery, and trust contract.

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

## Upstream foundation and attribution

PHOENIX is a downstream evolution built on [DeepSeek Harness](https://github.com/arisnachy/phoenix-harnes), the MIT-licensed open-source agent harness developed by [DeepSeek AI](https://deepseek.com). Its plugin architecture is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

PHOENIX does not claim authorship of upstream code. Upstream attribution and license notices are preserved while PHOENIX-specific work remains clearly separated as downstream evolution.

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
