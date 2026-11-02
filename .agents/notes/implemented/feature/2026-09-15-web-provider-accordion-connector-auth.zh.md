# Agent Note: Provider accordion, connector catalog, and OAuth popup

Status: implemented

[English](2026-09-15-web-provider-accordion-connector-auth.md) | 中文

## Problem

编写器里的模型选择器把每个供应商分组都完整展开，并带有吸顶标题。较长的目录会把靠前的行滚动到下一个分组的吸顶标题之下，造成视觉遮挡，整个目录也因此显得臃肿。设置 → 连接器目录缺少 Codex 与 OpenClaw 两个运行时的条目；而 OAuth 登录的授权窗口是在轮询定时器里打开的，常常被浏览器的弹窗拦截器吞掉，导致授权按钮看起来毫无反应。

## Decision

`ModelSelect` 把每个供应商渲染为可折叠分组：一个全宽的标题按钮用于切换分组，默认只展开包含当前模型的那个分组（当当前模型已不再被通告时回退到第一个分组），折叠的分组不渲染任何模型行。吸顶的组标题被替换为该标题按钮，从而消除了滚动遮挡。手动切换状态属于组件局部状态，并优先于默认行为。

连接器目录新增 `codex`（原生，OpenAI 家族）与 `openclaw`（原生）条目，使两个运行时都能在设置 → 连接器中连同其真实遥测一起呈现。`useAuthorizationAttempt.begin` 在点击手势内同步打开一个空白同源窗口，状态轮询在后端返回授权 URL 后把该窗口导航过去；当拦截器仍然拒绝时则回退为普通链接。

`workflow-worker-thread` 新增一个回归测试，断言非 OpenAI 的根任务继承父级路由（不附加 `agentOptions`），因此 `gpt-5.6-luna` 只会被强加给 `openai-codex` 根任务。`api-proxy.selectModel` 也会在同一个提交里把解析出的 provider、model 与 effort 写回到实时的 `agent.options`：委派方读取的是该对象，因此若缺少这次写入，从 `openai-codex` 切换走之后仍会保留旧路由，`childRoute` 也仍会强制使用 `gpt-5.6-luna`。一个宿主测试覆盖了「先切换、后委派」的路径。

## Alternatives considered

**保持所有分组展开。** 拒绝：它会保留遮挡问题以及手风琴所要消除的长而难以浏览的菜单。

**把展开状态持久化到声明的 store 中。** 拒绝：用户打开了哪个分组属于阅读手势、组件局部状态，主机或跨入口都没有利益关系。

**只在定时器内打开授权 URL。** 拒绝：那正是弹窗拦截器会拦截的场景；在点击手势内同步开窗是标准缓解手段，普通链接则始终作为回退保留。

## Consequences

模型菜单更短，每个供应商都可独立浏览；键盘焦点仍然只在可见的标题与行之间移动。连接器中心现在列出了 Codex 与 OpenClaw。OAuth 登录能从授权按钮可靠地打开授权窗口。非 OpenAI 的委派被一个测试固定下来，未来若回归到 Luna 路由将导致 CI 失败。
