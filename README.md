<p align="center">
  <img src="docs/phoenix-logo.svg" alt="PHOENIX — Universal AI Harness" width="520">
</p>

# PHOENIX

English | [中文](README.zh.md)

**PHOENIX is a universal, provider-agnostic AI agent harness built as a downstream evolution of DeepSeek Harness.** It preserves the mature plugin architecture and runtime seams of its upstream foundation while adding PHOENIX capabilities through isolated, testable layers instead of rewriting the core.

The project is designed around local-first and bring-your-own-provider operation, intelligent model selection, durable continuity, repository intelligence, tools, multi-agent execution, recovery, evaluation, and bounded self-improvement. Capabilities land incrementally and are not presented as complete until their repository gates are green.

## Development status

PHOENIX is under active development. The repository intentionally keeps internal `@deepseek-ai/dsh-*` package names and the `dsh` CLI where doing so preserves upstream compatibility. Those are implementation identities; the user-visible product, Web UI, PWA, favicon, and repository presentation are PHOENIX.

The architecture follows one rule: **prefer an existing DeepSeek Harness service or hook over a parallel implementation**. PHOENIX replaces or extends a component only when the downstream behavior is explicit, bounded, and evidence-backed.

## Run from source

Install Node.js and pnpm, then:

```sh
git clone https://github.com/arisnachy/phoenix-harnes.git
cd phoenix-harnes
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` starts the local PHOENIX Web UI using the compatible upstream CLI surface.

## Upstream foundation and attribution

PHOENIX is built downstream from [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), the open-source agent harness developed by [DeepSeek AI](https://deepseek.com). DeepSeek Harness uses an **everything-is-a-plugin** architecture powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

PHOENIX does not claim authorship of upstream DeepSeek Harness code. Upstream attribution and license notices are preserved while PHOENIX-specific work remains clearly separated as downstream evolution.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md), [architecture documentation](docs/architecture.md), and the PHOENIX package group under [`packages/phoenix/`](packages/phoenix/).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
