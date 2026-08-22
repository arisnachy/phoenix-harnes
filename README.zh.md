<p align="center">
  <img src="docs/phoenix-logo.svg" alt="PHOENIX — Universal AI Harness" width="520">
</p>

# PHOENIX

[English](README.md) | 中文

**PHOENIX 是一个通用、与模型提供方无关的 AI agent harness，面向 local-first 与自带 provider 的工作流。**

项目围绕智能模型选择、持久连续性、仓库智能、工具、多 agent 执行、恢复、评估和有边界的自我改进构建。各项能力会逐步落地；在仓库 gate 真正通过之前，不会把它们描述成已完成。

## 开发状态

PHOENIX 正在积极开发。仓库展示、Web UI、PWA 元数据、浏览器标题和视觉系统均以 PHOENIX 作为产品身份。

为保持与上游运行时兼容，部分内部包名和 CLI 标识会暂时保留；PHOENIX 则通过彼此隔离、可测试的下游层持续演进。这些实现细节不定义产品身份。

## 从源码运行

安装 Node.js 与 pnpm，然后执行：

```sh
git clone https://github.com/arisnachy/phoenix-harnes.git
cd phoenix-harnes
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` 会准备仓库产物。`pnpm dsh web` 启动本地 PHOENIX Web UI。`dsh` 命令目前仅作为内部兼容接口保留；在真正存在 PHOENIX 专属 CLI 之前，项目不会虚构一个名称。

## 社区与支持

PHOENIX 的反馈、缺陷、设计讨论和支持请使用本仓库的 [Issues](https://github.com/arisnachy/phoenix-harnes/issues) 与 [Discussions](https://github.com/arisnachy/phoenix-harnes/discussions)。

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.zh.md)。

## 开发

请先阅读[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)。PHOENIX 能力会通过分阶段、独立验证的 branch 与 pull request 集成，使稳定基础始终保持可审计。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 上游基础与署名

PHOENIX 是基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 构建的下游演进项目；该项目是由 [DeepSeek AI](https://deepseek.com) 开发并采用 MIT 许可证的开源 agent harness。其插件架构由 [Cordis](https://github.com/cordiverse/cordis) 驱动，设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。

PHOENIX 不声称拥有上游代码的作者身份。上游署名与许可证声明会被保留，同时 PHOENIX 专属工作会明确作为下游演进进行区分。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
