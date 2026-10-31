<p align="center">
  <img src="apps/web/public/phoenix-emblem.png" alt="PHOENIX" width="300">
</p>

# PHOENIX

English | [Español](README.es.md) | [中文](README.zh.md)

**PHOENIX is a distinct, local-first AI agent platform designed to work with multiple model providers, tools and specialized agents.**

PHOENIX has its own product identity, development roadmap and user experience. Kira is its coordinating assistant: the goal is to turn conversations into traceable work, connect the right capabilities and preserve useful context across tasks. PHOENIX is under active development; a feature is not considered production-ready merely because it appears in the interface.

## The platform

- **Kira and agent teams:** coordination, delegation, tool use and user-facing progress within a shared workflow.
- **Flexible models:** connect supported remote or local providers, select models and manage account connections without tying the product to one vendor.
- **Practical tools:** work with code, repositories, documents, browser workflows and supported integrations, subject to available permissions.
- **Continuity:** sessions, memories, goals and recovery mechanisms intended to preserve work beyond a single model response.
- **Controlled execution:** checkpoints, verification, permissions and recovery paths to reduce silent failures and unintended changes.

## Specialized workflows

- **Research and education:** evidence gathering, structured analysis and preparation of academic work.
- **Clinical assistance:** clinician-directed documentation and decision support, with professional oversight rather than autonomous medical practice.
- **Trading and markets:** market data, strategy evaluation and paper/test environments; no return or autonomous-execution guarantee is implied.
- **Sports and automation:** sports-data workflows and scheduled operations where their sources, connectors and runtime are available.

These areas have different levels of implementation and verification. See the relevant module and CI evidence before relying on one for critical work.

## Install

### Windows installer

Open PowerShell and run the repository installer:

```powershell
irm https://raw.githubusercontent.com/arisnachy/phoenix-harnes/main/install-phoenix.ps1 | iex
```

Review scripts before running them with elevated privileges. The installer requires a supported Windows environment and may prepare Node.js, Git, dependencies and application shortcuts. See [PHOENIX on Windows](docs/phoenix-windows.md) for installation and platform limitations.

### Run from source

Install Node.js 22.19 or newer, then:

```powershell
git clone https://github.com/arisnachy/phoenix-harnes.git
cd phoenix-harnes
.\phoenix-windows.cmd
```

The launcher prepares dependencies and starts the local interface. A global `pnpm` installation is not required for this Windows entry point.

### VS Code and Cursor

Build the repository's VSIX and install the generated extension through the editor's **Extensions → Install from VSIX** menu:

```powershell
pnpm --dir apps/vscode run package:vsix
```

The current package filename may retain compatibility identifiers; those are implementation details, not PHOENIX's product name.

## Connect models

### OpenRouter

PHOENIX can use the `openrouter/free` route, subject to the provider's availability and limits.

1. Create a key at [OpenRouter](https://openrouter.ai/settings/keys).
2. In PHOENIX, open **Settings → Models → OpenRouter** and save the key in its credential store.
3. Select an available model from the conversation model selector.

### ChatGPT / Codex

The native Codex connection uses the official Codex account login when that bridge is installed and available. ChatGPT subscription authentication and OpenAI API keys are separate; PHOENIX does not ask for your ChatGPT password. Availability depends on the installed bridge and account permissions.

## Updates and recovery

`main` is the development branch; `stable` is the promotion channel. A change should reach the stable channel only after the applicable checks pass. Supported managed installations check for validated updates and preserve local changes rather than silently overwriting them. See the [auto-update and recovery contract](docs/evolution/PHOENIX_AUTO_UPDATE.md).

## Documentation and community

- Read the [architecture](docs/architecture.md) and [development guide](docs/development.md) to understand the current system.
- See [Contributing](CONTRIBUTING.md) and [agent instructions](AGENTS.md) before making changes.
- Open [Issues](https://github.com/arisnachy/phoenix-harnes/issues) or [Discussions](https://github.com/arisnachy/phoenix-harnes/discussions) for bugs, ideas and support.

## Identity, credits and license

**The public product is PHOENIX.** Names retained in internal package paths, command-line interfaces or build artifacts exist for technical compatibility and do not define its identity. PHOENIX is not presented as another company's product or as a renaming of another harness.

The repository uses the [MIT license](LICENSE) and preserves applicable existing copyright notices. Third-party components and their licensing information are documented separately in [Third-Party Notices](THIRD_PARTY_NOTICES.md). Attribution is a legal and technical obligation, not the PHOENIX product description.
