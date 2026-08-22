<p align="center">
  <img src="docs/phoenix-logo.svg" alt="PHOENIX — Universal AI Harness" width="520">
</p>

# PHOENIX

[English](README.md) | 中文

**PHOENIX 是一个通用、与模型提供方无关的 AI agent harness，作为 DeepSeek Harness 的下游演进而构建。** 它保留上游成熟的插件架构与运行时能力 seam，并通过彼此隔离、可测试的 PHOENIX 层增加新能力，而不是重写核心。

项目面向 local-first 与自带 provider 的运行方式，设计方向包括智能模型选择、持久连续性、仓库智能、工具、多 agent 执行、恢复、评估和有边界的自我改进。各项能力会逐步落地；在仓库 gate 真正通过之前，不会把它们描述成已完成。

## 开发状态

PHOENIX 正在积极开发。为了保持与上游同步兼容，本仓库会有意保留内部 `@deepseek-ai/dsh-*` 包名以及 `dsh` CLI。这些属于实现身份；用户看到的产品、Web UI、PWA、favicon 与仓库展示均为 PHOENIX。

架构遵循一条原则：**优先复用现有 DeepSeek Harness 服务或 hook，而不是创建平行实现。** 只有当下游行为明确、有边界且有证据支持时，PHOENIX 才替换或扩展组件。

## 从源码运行

安装 Node.js 与 pnpm，然后执行：

```sh
git clone https://github.com/arisnachy/phoenix-harnes.git
cd phoenix-harnes
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` 会准备仓库产物。`pnpm dsh web` 使用兼容的上游 CLI 接口启动本地 PHOENIX Web UI。

## 上游基础与署名

PHOENIX 基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 下游构建；DeepSeek Harness 是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness。DeepSeek Harness 采用**一切皆插件**的架构，并由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。

PHOENIX 不声称拥有上游 DeepSeek Harness 代码的作者身份。上游署名与许可证声明会被保留，同时 PHOENIX 专属工作会明确作为下游演进进行区分。

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.zh.md)。

## 开发

请先阅读[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)。PHOENIX 能力会通过分阶段、独立验证的 branch 与 pull request 集成，使稳定的下游基础始终保持可审计。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
