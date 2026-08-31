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

## Run

### Windows 单行安装

打开 PowerShell 并执行：

```powershell
irm https://raw.githubusercontent.com/arisnachy/phoenix-harnes/main/install-phoenix.ps1 | iex
```

该引导程序会通过 `winget` 安装缺失的 Node.js/Git，克隆或快进专用 PHOENIX 安装目录，执行不可变依赖安装与构建，并在开始菜单、Windows 启动文件夹和任务栏快捷方式存储位置创建 **PHOENIX HARDNESS** 快捷方式。如果 Windows 版本没有本地化的固定到任务栏操作，仍会创建可用于任务栏的快捷方式；从快捷方式上下文菜单固定一次即可。使用 `-NoStartup` 或 `-NoTaskbar` 可选择退出。受管安装会在启动时检查 `origin/main`，并且只在工作区干净时应用快进更新；设置 `PHOENIX_AUTO_UPDATE=0` 可以禁用该检查。本地修改会被保留而不是覆盖。此脚本不是已签名的 MSIX；在配置项目证书之前，代码签名仍是发布 gate。

### VS Code 与 Cursor

使用 `pnpm --dir apps/vscode run package:vsix` 构建可安装扩展，然后在**扩展 → 从 VSIX 安装**中安装 `dist/phoenix-hardness-vscode.vsix`。其 Explorer 面板可以启动本地 PHOENIX 运行时并打开 Web UI，而且不会读取模型凭据。

### Run from source

安装 Node.js 22.19 或更高版本，然后执行：

```powershell
git clone https://github.com/arisnachy/phoenix-harnes.git
cd phoenix-harnes
.\phoenix-windows.cmd
```

`phoenix-windows.cmd` 会自动进入自身所在的仓库目录，使用 Node.js 内置的 Corepack 准备依赖，在需要时构建 PHOENIX，并启动本地 Web UI。不需要全局安装 `pnpm`。

### 稳定自动更新

PHOENIX 源码安装遵循仓库的稳定更新通道。新的 `main` commit 只有在当前 `main` 的 CI 成功后才会发布给客户端。运行中的安装会检测新的稳定 commit，并默认在活跃的 PHOENIX session 关闭后安装；Windows 也会在下一次启动前检查稳定通道。

自动安装要求官方 `origin`、`main` branch、干净的 worktree、fast-forward history、成功的隔离 preflight build，以及 recovery checkpoint。实时更新失败时会 rollback 到之前的已知良好 commit。Development branches 和本地修改过的 checkout 永远不会被自动覆盖，而且 updater 永远不会修改 PHOENIX 用户数据、credentials、sessions、memories 或 projects。

设置 `PHOENIX_UPDATE_MODE=notify` 可只接收通知而不安装，设置 `PHOENIX_UPDATE_MODE=off` 可禁用检查。完整的 release、recovery 与 trust contract 参见 [PHOENIX 稳定自动更新](docs/evolution/PHOENIX_AUTO_UPDATE.zh.md)。

Codex plugin 与 OpenClaw skill 更新使用隔离的 [upstream intake](docs/evolution/PHOENIX_UPSTREAM_INTAKE.zh.md)，在修改已初始化的 bridges 前会先暂存并验证 candidate。

### 在 Windows 上配置 OpenRouter

PHOENIX 默认选择 `openrouter/free` 模型路由。创建一个 [OpenRouter API 密钥](https://openrouter.ai/settings/keys)，然后在 PHOENIX 内完成配置：

1. 打开**设置 → 模型 → OpenRouter**。
2. 粘贴密钥并保存。密钥写入 PHOENIX 的本地凭据存储，不会提交到 Git。
3. 使用输入框中的模型选择器，从 `openrouter/free` 切换到其他 OpenRouter 模型。

提供方、密钥、端点、模型目录和当前模型都通过 Web UI 管理。免费模型适合测试，但仍受 OpenRouter 的可用性与速率限制约束。

### 连接 ChatGPT / Codex

PHOENIX 将 OpenAI API-key 身份验证与 ChatGPT subscription 身份验证严格分开。原生 Codex bridge 使用官方 Codex app-server 管理的 ChatGPT login，因此 OAuth persistence 与 token refresh 由 Codex 自己负责。PHOENIX 不会索取 ChatGPT password，也不会解析、复制或持久化 ChatGPT OAuth tokens。

挂载原生 Codex bridge 后，**设置 → 模型 → 账户连接**会提供 **ChatGPT / Codex** 登录。同一个原生 account plane 可以读取当前 ChatGPT plan、Codex rate-limit windows、reset times 与 account token-activity data，而无需通过通用 `pi-ai` OAuth adapter 路由 subscription。

## 社区与支持

PHOENIX 的反馈、缺陷、设计讨论和支持请使用本仓库的 [Issues](https://github.com/arisnachy/phoenix-harnes/issues) 与 [Discussions](https://github.com/arisnachy/phoenix-harnes/discussions)。

## 参与贡献

参见 [CONTRIBUTING.zh.md](CONTRIBUTING.zh.md)。

## 开发

请先阅读[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)。PHOENIX 能力会通过分阶段、独立验证的 branch 与 pull request 集成，使稳定基础始终保持可审计。

Windows 安装、IDE 打包、原生 sandbox 边界与 continuity 状态参见 [Windows 上的 PHOENIX](docs/phoenix-windows.zh.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 上游基础与署名

PHOENIX 是基于 [DeepSeek Harness](https://github.com/arisnachy/phoenix-harnes) 构建的下游演进项目；该项目是由 [DeepSeek AI](https://deepseek.com) 开发并采用 MIT 许可证的开源 agent harness。其插件架构由 [Cordis](https://github.com/cordiverse/cordis) 驱动，设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。

PHOENIX 不声称拥有上游代码的作者身份。上游署名与许可证声明会被保留，同时 PHOENIX 专属工作会明确作为下游演进进行区分。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
