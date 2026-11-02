# PHOENIX 中的 OpenClaw 技能

[English](openclaw-skills.md) | 中文

PHOENIX 通过 `dsh openclaw-skills` 桥接官方 [`openclaw/openclaw/skills`](https://github.com/openclaw/openclaw/tree/main/skills) 目录。审计的来源使用 MIT 许可证（commit `629a47e3cc20a9f8b6d19c105f840b8a693ec4aa`）。许可证允许免费下载指令和资源，但不代表某些 skill 描述的账户、API、设备、CLI 或外部服务免费。

## 安装与更新

```text
dsh openclaw-skills sync
dsh openclaw-skills list
dsh openclaw-skills verify
dsh openclaw-skills doctor
dsh openclaw-skills inspect openclaw-weather
```

同步将 checkout 保存在 `$DSH_HOME/openclaw-skills/openclaw`，将 bundle 安装到 `$DSH_HOME/skills/openclaw-<nombre>`，并将状态保存到 `$DSH_HOME/openclaw-skills/arsenal.json`。它只删除或替换桥接器登记的 `openclaw-*` 项，不触碰其他提供方的 skill。相对资源（`references/`、`scripts/`、`bin/` 等）会保留。

## 在 harness 中调用

目录由 `dsh-skill-filesystem` 发现，PHOENIX 使用 `skill` 工具并通过准确别名加载：

```text
skill({ name: "openclaw-weather" })
skill({ name: "openclaw-diagram-maker" })
```

加载 skill 只能证明其指令可用，不等于执行了它描述的 CLI、API、设备或服务。执行真实操作前，必须检查相应信号并具备所需 runtime 或凭据。`doctor` 将这些条件报告为警告，且从不保存秘密值。

**信号图例：** `network` = 指南记录了 HTTP、`curl`、`fetch` 或 Web 工具；`external-runtime` = 记录了额外 CLI、解释器或二进制文件；`credentials` = 记录了认证、token、API key 或 OAuth；`platform-specific` = 提到具体平台或设备；`local/offline` = 文本中未检测到这些信号。这些是审计标记，不是可用性证明。

## 单项审查

以下 51 个 bundle 均已安装、公布，并通过 `ctx.skills.get()` 加载；每一行对应一项单独审查。`资源`统计 `SKILL.md` 之外的附加文件。

| PHOENIX 别名 | 来源 | 文档功能 | 信号 | 资源 |
|---|---|---|---|---:|
| `openclaw-1password` | `1password` | 使用 1Password CLI 配置和执行登录、桌面集成与秘密管理。 | network, external-runtime, credentials, platform-specific | 2 |
| `openclaw-apple-notes` | `apple-notes` | 使用 `memo` 创建、查询、编辑、删除、搜索、移动或导出 Apple Notes。 | network, external-runtime, platform-specific | 0 |
| `openclaw-apple-reminders` | `apple-reminders` | 使用 `remindctl` 管理 Apple Reminders 及其列表。 | network, external-runtime, platform-specific | 0 |
| `openclaw-bear-notes` | `bear-notes` | 使用 `grizzly` 创建、搜索和管理 Bear 笔记。 | network, external-runtime, credentials, platform-specific | 0 |
| `openclaw-blogwatcher` | `blogwatcher` | 使用 `blogwatcher` 监测博客及 RSS/Atom feed。 | network, external-runtime | 0 |
| `openclaw-blucli` | `blucli` | 发现、播放、分组并调整 BluOS 音量。 | network, external-runtime | 0 |
| `openclaw-camsnap` | `camsnap` | 捕获 RTSP/ONVIF 摄像头和 webcam 的画面或片段。 | network, external-runtime, platform-specific | 0 |
| `openclaw-clawhub` | `clawhub` | 搜索、安装、验证、更新、卸载、发布或同步 ClawHub skill。 | network, external-runtime | 0 |
| `openclaw-coding-agent` | `coding-agent` | 将代码工作委派给 Codex、Claude Code 或 OpenCode。 | external-runtime, credentials | 0 |
| `openclaw-diagram-maker` | `diagram-maker` | 为概念、架构和流程创建 SVG/HTML 或 Excalidraw 图表。 | local/offline | 2 |
| `openclaw-eightctl` | `eightctl` | 控制 Eight Sleep pod 的状态、温度、警报和计划。 | network, credentials | 0 |
| `openclaw-gemini` | `gemini` | 使用 Gemini CLI 处理提示、摘要、生成、skill、hook 和 MCP。 | network, external-runtime | 0 |
| `openclaw-gh-issues` | `gh-issues` | 查询 GitHub issue、选择候选项、启动 agent 并创建 PR。 | network, external-runtime, credentials | 0 |
| `openclaw-gifgrep` | `gifgrep` | 搜索 GIF、下载结果并提取画面或图板。 | network, external-runtime, credentials | 0 |
| `openclaw-github` | `github` | 使用 GitHub CLI 处理 issue、PR、CI、评论、release 和 API。 | network, external-runtime, credentials | 0 |
| `openclaw-gog` | `gog` | 使用 Google Workspace CLI 处理 Gmail、Calendar、Drive、Contacts、Sheets 和 Docs。 | network, external-runtime, credentials | 0 |
| `openclaw-goplaces` | `goplaces` | 查询 Google Places，包括搜索、详情、解析和评论。 | network, external-runtime, credentials | 0 |
| `openclaw-healthcheck` | `healthcheck` | 审计并加固 OpenClaw 主机，包括 SSH、防火墙、更新、暴露面和备份。 | credentials, platform-specific | 0 |
| `openclaw-himalaya` | `himalaya` | 管理 IMAP/SMTP 邮件，包括列出、读取、搜索、撰写、回复和移动。 | network, external-runtime, credentials | 2 |
| `openclaw-mcporter` | `mcporter` | 列出、配置、认证、调用和检查 MCP 服务器及工具。 | network, external-runtime, credentials | 0 |
| `openclaw-meme-maker` | `meme-maker` | 搜索模板、建议格式并生成本地或托管 meme。 | external-runtime, credentials | 2 |
| `openclaw-model-usage` | `model-usage` | 按模型汇总 Codex 或 Claude 的本地成本日志。 | network, external-runtime, platform-specific | 3 |
| `openclaw-nano-pdf` | `nano-pdf` | 使用自然语言通过 `nano-pdf` 编辑 PDF。 | network, external-runtime | 0 |
| `openclaw-node-connect` | `node-connect` | 诊断 Web 与 Android/iOS/macOS 节点连接，包括路径、认证、配对和重连。 | external-runtime, credentials, platform-specific | 0 |
| `openclaw-node-inspect-debugger` | `node-inspect-debugger` | 使用 inspect、CDP、断点、heap 和 CPU profile 调试 Node.js。 | network, external-runtime | 0 |
| `openclaw-notion` | `notion` | 使用 Notion CLI/API 处理页面、Markdown、数据源、文件、评论和搜索。 | network, external-runtime, credentials | 0 |
| `openclaw-obsidian` | `obsidian` | 读取、搜索和编辑 Obsidian 笔记、任务、链接、属性和插件。 | network, external-runtime, platform-specific | 0 |
| `openclaw-openai-whisper` | `openai-whisper` | 使用 Whisper CLI 在本地转录音频。 | network, external-runtime | 0 |
| `openclaw-openai-whisper-api` | `openai-whisper-api` | 使用 `curl` 调用 Audio Transcriptions API。 | network, external-runtime, credentials | 1 |
| `openclaw-openhue` | `openhue` | 使用 OpenHue CLI 控制 Philips Hue 灯光和场景。 | network, external-runtime | 0 |
| `openclaw-oracle` | `oracle` | 使用 Oracle CLI 进行审查、调试、重构或设计。 | network, external-runtime, credentials | 0 |
| `openclaw-ordercli` | `ordercli` | 查询 Foodora 的历史与当前订单（Deliveroo WIP）。 | network, external-runtime, platform-specific | 0 |
| `openclaw-peekaboo` | `peekaboo` | 使用 Peekaboo CLI 捕获并自动化 macOS 界面。 | network, external-runtime, credentials, platform-specific | 0 |
| `openclaw-python-debugpy` | `python-debugpy` | 使用 `pdb`、post-mortem、断点和远程 debugpy 调试 Python。 | external-runtime, platform-specific | 0 |
| `openclaw-sag` | `sag` | 使用 ElevenLabs 和 macOS 的 `say` 体验生成语音。 | network, external-runtime, credentials | 0 |
| `openclaw-session-logs` | `session-logs` | 使用 `jq` 搜索和分析自身 session 日志。 | local/offline | 0 |
| `openclaw-sherpa-onnx-tts` | `sherpa-onnx-tts` | 使用 sherpa-onnx 在本地离线转语音。 | network, external-runtime, platform-specific | 1 |
| `openclaw-skill-creator` | `skill-creator` | 创建、修复、验证或重构 `SKILL.md` 及其资源。 | external-runtime | 5 |
| `openclaw-songsee` | `songsee` | 生成音频频谱图和特征面板。 | network, external-runtime | 0 |
| `openclaw-sonoscli` | `sonoscli` | 发现和控制 Sonos 音箱、播放、音量与分组。 | network, external-runtime, credentials | 0 |
| `openclaw-spike` | `spike` | 运行一次性原型、比较方案并给出结论。 | external-runtime | 0 |
| `openclaw-spotify-player` | `spotify-player` | 使用 `spogo` 或 `spotify_player` 从终端播放和搜索 Spotify。 | network, external-runtime, credentials | 0 |
| `openclaw-summarize` | `summarize` | 总结或转录 URL、YouTube、podcast、文章、PDF 和本地文件。 | network, external-runtime, credentials | 0 |
| `openclaw-taskflow` | `taskflow` | 使用持久 job 状态、等待和子任务协调独立任务。 | credentials | 2 |
| `openclaw-taskflow-inbox-triage` | `taskflow-inbox-triage` | TaskFlow 的收件箱 triage、路由和等待示例。 | local/offline | 0 |
| `openclaw-things-mac` | `things-mac` | 管理 Things 3 的任务、收件箱、今日、项目、区域和标签。 | network, external-runtime, credentials, platform-specific | 0 |
| `openclaw-tmux` | `tmux` | 控制 tmux session 和 pane，捕获输出并发送按键。 | platform-specific | 2 |
| `openclaw-trello` | `trello` | 使用 REST API 管理 Trello board、list 和 card。 | network, external-runtime, credentials | 0 |
| `openclaw-video-frames` | `video-frames` | 使用 `ffmpeg` 提取视频画面或短片段。 | network, external-runtime | 1 |
| `openclaw-weather` | `weather` | 使用 `web_fetch` 或 `wttr.in`/`curl` 查询天气和预报。 | network, external-runtime | 0 |
| `openclaw-xurl` | `xurl` | 使用 X API v2 发布、读取、搜索、发送 DM。 | network, external-runtime, credentials | 0 |

## 证据

- `pnpm run verify:openclaw-skills`：通过 `ctx.skills.list()` + `ctx.skills.get()` 成功加载 51/51。
- `dsh openclaw-skills verify`：51/51 个正文和 23/23 个资源均已安装。
- `dsh openclaw-skills doctor`：Git、upstream checkout、状态和原生桥接正确；可选依赖的警告单独列出。
- 不含正文和秘密的报告：`docs/superpowers/evidence/openclaw-skills-verification.json`。
