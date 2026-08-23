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

### Run from source

Install Node.js 22.19 or newer, then:

```powershell
git clone https://github.com/arisnachy/phoenix-harnes.git
cd phoenix-harnes
.\phoenix-windows.cmd
```

`phoenix-windows.cmd` changes to its own repository directory, uses the Corepack copy included with Node.js to prepare dependencies, builds PHOENIX when needed, and starts the local Web UI. A global `pnpm` installation is not required.

### Configure OpenRouter on Windows

PHOENIX starts with the `openrouter/free` model route selected. Create an [OpenRouter API key](https://openrouter.ai/settings/keys), then configure it inside PHOENIX:

1. Open **Settings → Models → OpenRouter**.
2. Paste the key and save it. The key is written to the local PHOENIX credential store and is not committed to Git.
3. Use the model selector in the composer to switch from `openrouter/free` to another OpenRouter model.

The provider, key, endpoint, model catalog, and active model are managed from the Web UI. Free models are intended for testing and remain subject to OpenRouter availability and rate limits.

## Community and support

Use this repository's [Issues](https://github.com/arisnachy/phoenix-harnes/issues) and [Discussions](https://github.com/arisnachy/phoenix-harnes/discussions) for PHOENIX feedback, bugs, design discussion, and support.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md). PHOENIX capabilities are integrated through staged, independently verified branches and pull requests so the stable base stays auditable.

For agents, follow [AGENTS.md](AGENTS.md).

## Upstream foundation and attribution

PHOENIX is a downstream evolution built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), the MIT-licensed open-source agent harness developed by [DeepSeek AI](https://deepseek.com). Its plugin architecture is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

PHOENIX does not claim authorship of upstream code. Upstream attribution and license notices are preserved while PHOENIX-specific work remains clearly separated as downstream evolution.

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
