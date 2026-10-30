<p align="center">
  <img src="docs/phoenix-logo.svg" alt="PHOENIX — Universal AI Harness" width="520">
</p>

# PHOENIX

[English](README.md) | 中文

**PHOENIX 是一个以本地优先（local-first）为核心的认知式 AI 工作空间：在同一环境中跨模型、工具与项目完成思考、协调、执行、验证和恢复。**

**Kira** 是其中的协调体验核心。PHOENIX 旨在连接用户目标、专业智能体和各种能力，同时保留上下文、展示真实执行的证据，并让用户始终掌握控制权。**它不由任何单一模型、提供商或过去的项目来定义。**

> **一个任务。合适的智能。可验证的执行。**

## PHOENIX 的核心特点

| 支柱 | 含义 |
| --- | --- |
| **Kira 与多智能体协作** | 主助手组织工作，将任务交给专业智能体，并区分面向用户的进展报告与团队内部沟通。 |
| **自由选择模型** | 提供与模型提供商无关的适配和模型选择，支持下文介绍的 OpenRouter 以及可选的原生 ChatGPT / Codex 连接。 |
| **以连续性为设计核心** | 本地会话历史、可重放事件和检查点为恢复与审计提供基础；更广泛的认知记忆仍在持续开发。 |
| **真实工具与执行凭据** | 工具、浏览器与文件系统集成、权限及结果证据是工作流的一部分，而不是模拟的操作清单。 |
| **不仅仅是聊天** | Web UI、Windows 启动方式、IDE 集成和可组合插件架构把能力集中在一个工作空间中。 |
| **面向故障的执行机制** | 受控发布、隔离预检、恢复点和回滚机制旨在避免更新破坏正常运行的安装。 |

## 专业工作空间

PHOENIX 正逐步扩展至**科研与出版**、**临床辅助工作流**、**市场分析与交易**、**体育情报**、**商业运营**和**任务自动化**。这些是开发方向，不意味着所有功能都已安装、达到生产级、可以自主运行，或已获得执行真实操作的授权。各项集成都需要通过自身的运行和安全验证。

## 开发状态

PHOENIX 是一个持续开发、拥有**独立产品身份、架构、路线图和发展方向**的产品。功能逐步交付；设计文档或尚未合并的 pull request 并不证明 `main` 或 `stable` 已具备该功能。

部分内部包名与 CLI 标识为了运行时兼容暂时保留。它们是实现细节，不属于 PHOENIX 的品牌标识；修改时必须确保现有安装和工作流正常运行。

实现架构和验证边界请参阅[架构文档](docs/architecture.zh.md)、[开发指南](docs/development.zh.md)和[能力接口](docs/capability-seams.zh.md)。

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

## 开源组件与署名

PHOENIX 拥有独立的产品身份与开发方向。仓库也包含由其他项目作者开发的开源组件。其作者署名、许可证声明、引入源码的来源及本地修改仍记录在 [LICENSE](LICENSE)、[引入软件包来源](vendor/README.md)和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

对代码来源的致谢**不意味着** PHOENIX 是其他产品的换名版本或衍生演进产品。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
