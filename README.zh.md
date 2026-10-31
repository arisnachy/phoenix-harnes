<p align="center">
  <img src="apps/web/public/phoenix-emblem.png" alt="PHOENIX" width="300">
</p>

# PHOENIX

[English](README.md) | [Español](README.es.md) | 中文

**PHOENIX 是一个具有独立产品定位、以本地优先为设计原则的 AI 智能体平台，可连接不同模型提供方、工具和专业智能体。**

PHOENIX 拥有自己的产品身份、开发路线和用户体验。Kira 是平台的协调助手：目标是将对话转化为可追踪的工作，连接合适的能力，并在任务间保留有用的上下文。PHOENIX 仍在积极开发；功能出现在界面中，并不代表它已经达到生产就绪标准。

## 平台能力

- **Kira 与智能体团队：**在统一工作流中协调、委派、调用工具，并向用户展示进展。
- **灵活选择模型：**接入支持的远程或本地提供方，选择模型并管理账号连接，不依赖单一供应商。
- **实用工具：**在权限允许的范围内处理代码、代码仓库、文档、浏览器工作流和受支持的集成。
- **任务连续性：**通过会话、记忆、目标与恢复机制，尽可能延续单次模型响应之外的工作。
- **受控执行：**利用检查点、验证、权限管理和恢复路径，减少无声失败与意外修改。

## 专业工作流

- **研究与教育：**收集证据、开展结构化分析、准备学术材料。
- **临床辅助：**在临床专业人员主导下提供文书与决策支持，而非自主行医。
- **交易与市场：**处理市场数据、评估策略并使用模拟或测试环境；不承诺收益或自动执行能力。
- **体育与自动化：**在数据源、连接器及运行环境可用时，支持体育数据处理和定时任务。

这些领域的实现和验证程度各不相同。在关键任务中依赖某项能力前，请查阅对应模块与 CI 验证证据。

## 安装

### Windows 安装程序

打开 PowerShell，运行仓库提供的安装脚本：

```powershell
irm https://raw.githubusercontent.com/arisnachy/phoenix-harnes/main/install-phoenix.ps1 | iex
```

使用高权限运行脚本前请先检查其内容。安装程序需要受支持的 Windows 环境，可能会准备 Node.js、Git、依赖项和应用快捷方式。安装说明及平台限制请参阅 [Windows 上的 PHOENIX](docs/phoenix-windows.zh.md)。

### 从源码运行

安装 Node.js 22.19 或更高版本，然后执行：

```powershell
git clone https://github.com/arisnachy/phoenix-harnes.git
cd phoenix-harnes
.\phoenix-windows.cmd
```

启动脚本会准备依赖并打开本地界面。通过此 Windows 入口启动时，无须全局安装 `pnpm`。

### VS Code 与 Cursor

构建仓库中的 VSIX，然后在编辑器的**扩展 → 从 VSIX 安装**菜单中安装生成的扩展：

```powershell
pnpm --dir apps/vscode run package:vsix
```

目前的安装包文件名可能保留兼容性标识；它们只是实现细节，并非 PHOENIX 的产品名称。

## 连接模型

### OpenRouter

PHOENIX 可使用 `openrouter/free` 路由，但仍受提供方可用性与使用限制约束。

1. 在 [OpenRouter](https://openrouter.ai/settings/keys) 创建密钥。
2. 在 PHOENIX 中打开**设置 → 模型 → OpenRouter**，将密钥保存到凭据存储中。
3. 使用会话中的模型选择器选择可用模型。

### ChatGPT / Codex

安装并启用原生 Codex 桥接后，可使用官方 Codex 账号登录。ChatGPT 订阅认证与 OpenAI API 密钥互相独立；PHOENIX 不会要求提供 ChatGPT 密码。具体可用性取决于安装的桥接组件与账号权限。

## 更新与恢复

`main` 是开发分支，`stable` 是发布晋升通道。变更只有通过适用检查后才能进入稳定通道。受支持的托管安装会检查已验证更新，并保留本地修改，不会悄悄覆盖。完整说明见[自动更新与恢复约定](docs/evolution/PHOENIX_AUTO_UPDATE.zh.md)。

## 文档与社区

- 阅读[架构文档](docs/architecture.zh.md)和[开发指南](docs/development.zh.md)，了解当前系统。
- 修改代码前请阅读[贡献指南](CONTRIBUTING.zh.md)和[智能体说明](AGENTS.md)。
- 通过 [Issues](https://github.com/arisnachy/phoenix-harnes/issues) 或 [Discussions](https://github.com/arisnachy/phoenix-harnes/discussions) 反馈问题、交流想法或获取支持。

## 产品身份、署名与许可

**对外产品名称就是 PHOENIX。** 内部包路径、命令行接口或构建产物中保留的名称仅用于技术兼容，不代表产品身份。PHOENIX 不应被描述成其他公司的产品，也不是对其他智能体框架的简单改名。

本仓库采用 [MIT 许可证](LICENSE)，并保留依法应保留的既有版权声明。第三方组件及其许可信息另见[第三方许可声明](THIRD_PARTY_NOTICES.md)。署名是法律和技术义务，不是 PHOENIX 的产品介绍。
