# Agent Note: Live OpenAI-Codex model discovery

Status: implemented

## Problem

“模型”设置界面将操作标记为获取可用模型，但 `openai-codex` 路由此前会被 `llm-pi-ai` 的通用已安装目录快捷路径截获。因此，选择器返回的是已安装 pi-ai 依赖中捆绑的模型快照，而不是当前用户已认证 Codex 账户实际可见的模型。新启用或账户范围内的 Codex 模型可能缺失，而过时的捆绑条目仍可能被显示为可用。

## Decision

`openai-codex` 是已安装目录发现快捷路径的账户范围例外。`discoverModels()` 会把它路由到一个短生命周期的本地 Codex app-server，并通过 stdio 按 app-server 协议完成握手（`initialize`、`initialized`），然后读取完整的分页 `model/list` 响应，同时排除隐藏条目。

app-server 模型的 `model` 字段作为 Phoenix 中可选择的模型 id；仅为兼容较旧响应形状时才回退到 `id`。`displayName` 保留用于界面展示。分页结果按模型 id 去重；如果页数异常过多，发现流程会失败，而不是静默返回不完整目录。

该路径复用 Codex CLI 现有的 ChatGPT 身份验证，不解析 Phoenix API key。在 Windows 上，Phoenix 通过 `ComSpec` 启动固定的 `codex app-server` 命令，以兼容 npm 的 `codex.cmd` shim；在 POSIX 上直接启动 `codex`。只向子进程传递可执行文件查找、Codex 配置、平台运行、区域设置、代理和 TLS 信任所需的环境变量。

Codex 发现失败会直接作为发现失败暴露。Phoenix 不会回退到捆绑的 pi-ai Codex 目录，因为那会重新引入原始缺陷，并把过时结果伪装成实时结果。

## Alternatives considered

**继续把 pi-ai 目录作为权威来源。** 被拒绝，因为该目录只是依赖版本的快照，而 Codex 模型可用性具有账户范围属性，并且可以独立于 Phoenix 发布周期发生变化。

**调用 OpenAI 兼容的 `/v1/models` 端点。** 被拒绝，因为 Codex 路由通过 Codex/ChatGPT 而不是普通供应商 API key 进行身份验证，账户感知的模型目录属于 Codex app-server 协议。

**app-server 发现失败时回退到静态目录。** 被拒绝，因为这样“模型”界面又无法区分真实的账户可见列表和过时的本地元数据。显式失败更安全，也更容易诊断。

**在 Phoenix 中硬编码新发现的 Codex 模型 id。** 被拒绝，因为之后每次 Codex 发布都会再次产生同样的维护竞态，并且仍然无法表达每个账户的实际可用性。

## Consequences

设置中的模型选择器现在反映用户自己的已认证 Codex 安装所报告的模型，包括 Phoenix 依赖快照未知的模型。回归测试固定了实时传输分支，禁止静默静态回退，验证取消信号转发，并检查 `model/list` 映射和隐藏条目过滤。

实时发现现在依赖可工作的本地 Codex CLI 及其身份验证状态。如果 Codex 不存在、无法启动、无法认证或无法取得模型目录，选择器会报告失败，而不是显示虚构或过时的答案。短生命周期 app-server 的进程启动成本只发生在用户明确触发的设置操作中，不影响普通模型执行。
