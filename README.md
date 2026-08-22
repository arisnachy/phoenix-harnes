<p align="center">
  <img src="docs/phoenix-logo.svg" alt="PHOENIX — Universal AI Harness" width="520">
</p>

# PHOENIX

English |

**PHOENIX is a universal, provider-agnostic AI agent harness for local-first and bring-your-own-provider workflows.**

It is being built around intelligent model selection, durable continuity, repository intelligence, tools, multi-agent execution, recovery, evaluation, and bounded self-improvement. Capabilities land incrementally and are not presented as complete until their repository gates are green.

## Development status

PHOENIX is under active development. Its product identity is PHOENIX across the repository presentation, Web UI, PWA metadata, browser title, and visual system.

Some internal package and CLI identifiers are intentionally retained for compatibility with the upstream runtime while PHOENIX evolves through isolated, testable downstream layers. Those implementation details do not define the product identity.

## Run from source

Install Node.js and pnpm, then:

```sh
git clone https://github.com/arisnachy/phoenix-harnes.git
cd phoenix-harnes
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` starts the local PHOENIX Web UI. The `dsh` command is currently retained as an internal compatibility surface; a PHOENIX-specific CLI name is not claimed until it actually exists.

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
