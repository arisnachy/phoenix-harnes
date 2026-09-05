<p align="center">
  <img src="apps/web/public/phoenix-wordmark.png" alt="PHOENIX — Universal AI Harness" width="520">
</p>

# PHOENIX

[English](README.md) | 中文

**PHOENIX 是一个独立、通用、与模型提供方无关的 AI agent harness，面向 local-first 与自带 provider 的工作流。**

PHOENIX 围绕智能模型选择、持久连续性、仓库智能、工具、多 agent 执行、恢复、评估和有边界的自我改进构建。任何模型提供方都不定义或控制 PHOENIX 的产品身份；provider 是由操作者选择的可替换执行后端。

## 开发状态

PHOENIX 正在积极开发。仓库展示、Web UI、PWA 元数据、浏览器标题、安装器与视觉系统均以 PHOENIX 作为产品身份。

部分内部包名和 CLI 标识会在迁移期间暂时保留以维持运行时兼容性。它们属于实现细节，不代表产品身份或与任何 provider 的隶属关系。

## 信任与 provider 边界

PHOENIX 保持通用架构，同时在 provider 边界应用 provider-specific 规则。OpenAI/Codex 路由由专用 policy firewall 保护；其他 provider 继续遵循其各自的合同与配置。凭据按请求解析，生成上下文中的疑似有效 secret 会在 provider egress 之前被阻断，不相关 adapter 之间不会共享 adapter-private replay state，外部 telemetry 只有在操作者显式配置 OTLP endpoint 后才会启用。

旧的 browser-session **ChatGPT Web** transport 不再属于默认 base profile。ChatGPT subscription 使用原生官方 Codex app-server bridge；OpenAI API 仍保持独立 API-key 路径。

参见 [PHOENIX Provider Trust Boundaries](docs/security/PHOENIX_PROVIDER_TRUST_BOUNDARIES.md)。

## Run

### Windows 单行安装

打开 PowerShell 并执行：

```powershell
irm https://raw.githubusercontent.com/arisnachy/phoenix-harnes/main/install-phoenix.ps1 | iex
```

该引导程序会通过 `winget` 安装缺失的 Node.js/Git，克隆或快进专用 PHOENIX 安装目录，执行不可变依赖安装与构建，并在开始菜单、Windows 启动文件夹和任务栏快捷方式存储位置创建 **PHOENIX HARDNESS** 快捷方式。如果 Windows 版本没有本地化的固定到任务栏操作，仍会创建可用于任务栏的快捷方式；从快捷方式上下文菜单固定一次即可。使用 `-NoStartup` 或 `-NoTaskbar` 可选择退出。受管安装会在启动时检查已晋升的 `stable` branch，并且只应用干净且通过 preflight 的更新；带有管理标记的干净发布 checkout 也可以在保留 recovery ref 的前提下安全替换不相关的旧历史；设置 `PHOENIX_AUTO_UPDATE=0` 可以禁用该检查。本地修改会被保留而不是覆盖。此脚本不是已签名的 MSIX；在配置项目证书之前，代码签名仍是发布 gate。

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

自动安装要求官方 `origin`、`main` 或 `stable` branch、干净的 worktree、成功的隔离 preflight build，以及 recovery checkpoint。Fast-forward release 使用 `git merge --ff-only`；具有不相关旧历史的受管发布 checkout 会在 preflight 后使用受保护的 `git reset --hard`。实时更新失败时会 rollback 到之前的已知良好 commit。Development branches 和本地修改过的 checkout 永远不会被自动覆盖，而且 updater 永远不会修改 PHOENIX 用户数据、credentials、sessions、memories 或 projects。

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

## 项目身份与第三方声明

PHOENIX 作为独立、通用的 AI agent harness 开发与分发。依法需要保留的历史源码来源、版权声明和第三方许可证会继续保留；这些声明描述的是代码来源，并不代表任何模型 provider 对 PHOENIX 的隶属、赞助、控制或背书。

归属与 provenance 详情参见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
