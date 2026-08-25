# Agent Note：Google OAuth token 留在 Host broker 内

Status: implemented

[English](2026-08-25-google-oauth-host-broker.md) | 中文

## 问题

PHOENIX 需要让用户只通过一次明确的 Google 登录来授权其 Google Workspace 能力，同时不能把用户的 OAuth access token 或 refresh token 放进模型上下文、日志、配置，或模型工具进程能够读取的文件。现有 `credentials-local` store 无法提供这种安全属性：它的仅所有者文件权限可以防其他 OS 用户，却不能阻止以同一 UID 运行的 bash 与文件系统工具主动读取凭据文档。把 Google `grant` 持久化到那里，会把实现便利变成凭据泄露路径。

通用的 `ctx.authorization` 还必须保持协议中立。若把 Google endpoint、PKCE、refresh 或 scope 行为放进 seam，每个授权界面都会依赖某个 provider 的协议，重新制造 flow registry 原本要消除的耦合。

## 决策

`@deepseek-ai/dsh-authorization/google` 是位于中立 authorization service 旁边的 Host Service。它拥有 Google installed-application Authorization Code flow，并注册一个 `Google Workspace` authorization flow。provider 使用随机 `127.0.0.1` loopback 端口、高熵 `state`、PKCE S256，以及 Google 的 HTTPS authorization/token endpoints。配置的 Desktop OAuth client id 是应用身份，不是用户凭据。

Google OAuth access token 与 refresh token 只存在于 Host Service 的私有字段。授权成功后，flow 通过 `ctx.credentials` 仅写入不含机密的 `authorization-google/account` marker，从而满足 authorization seam 的 commit 要求，而无需把 provider credential 复制进本地凭据文档。token 在进程退出时消失；在 PHOENIX 拥有同 UID 工具进程无法读取的 secret backend 之前，每次重启后都需要重新进行 Google 授权。

consumer 不会解析或取得 token。它们调用 `ctx.googleApi.request()`，传入 HTTPS Google API URL 与该操作需要的 scopes。broker 会拒绝非 Google 目标、OAuth token endpoint、调用方提供的 authorization/cookie header、重复或空 required scope，以及实际 grant 中不存在的 scope。只有所有检查通过后，才在 `fetch` 前一刻注入 `Authorization: Bearer ...`。返回值只包含 API status、media type 与 body，不包含 token 或完整响应 headers。

refresh 在 broker 内串行化，因此并发过期不会放大 refresh-token 使用。`disconnect()` 会先清除内存 grant，再尝试 best-effort Google revocation，并且无论 revocation 是否成功都删除 marker，因此 provider outage 不会让 PHOENIX 在本地继续显示为已认证。

## Scope 组合

Google 明确说明 installed application 不支持 incremental authorization。因此发布的 row 会列出已挂载 Workspace 能力需要的 scopes，并在一次明确的人工 consent 中申请它们。该列表属于配置，并不是隐式的万能授权：部署若移除某些能力，应缩小完整 row；使用 sensitive 或 restricted scopes 的部署仍需满足 Google OAuth consent 与 verification 要求。

初始 suite 覆盖账号身份、Gmail modify、Calendar、Drive、Docs、Sheets、Slides 与 Contacts。`gmail.modify` 已包含读取、撰写与发送邮件能力，因此不再额外添加重复的 Gmail send scope。

## 考虑过的替代方案

**把普通 `grant` record 持久化到 `.credentials.yaml`。** 拒绝，因为仓库文档明确指出该文件权限并不是对同一 OS 用户下模型工具的安全边界。若加密密钥仍可被同一进程树读取，加密只会移动可读的 secret。

**把 Google OAuth 放进 `ctx.authorization`。** 拒绝，因为 authorization seam 拥有人机交互和生命周期，provider 才拥有协议。Google 专属 endpoint 与 refresh 行为会把通用 service 变成协议实现。

**把短期 access token 返回给 connector plugin。** 拒绝，因为每一次返回 token 都会增加新的内存、日志或工具边界。broker 可以直接执行 API request，并只返回用户请求的 Google 结果。

**为重启便利持久化 refresh token。** 延后到 PHOENIX 拥有 OS keychain、external vault 或同等强度、agent tool process 无法读取的 provider。重新授权是一项明确的安全/体验权衡，而不是隐藏削弱。

## 后果

- 模型和通用 PHOENIX 授权界面只得到账号状态与 Google API 结果，不得到 OAuth token。
- 本地凭据文档只包含 Google authorization marker。
- PHOENIX 重启后需要再次 Google sign-in。
- 每个 Google API consumer 都必须在 broker request 中声明 required scopes；权限不足会在访问目标 API 之前失败。
- 浏览器授权使用系统 Google 页面与 loopback callback；密码和 authorization code 都不会粘贴到 PHOENIX prompt。
- 将来可以把 token persistence 移到更强的 credential backend，而无需改变 `ctx.googleApi` consumer。

### 接受的风险

Host 进程本身必然持有 live token，并能够使用已授权的 Google APIs。本设计保护的是模型/工具平面不获得凭据，而不是防御已被攻陷的 PHOENIX Host 进程。广泛的 Google Workspace scopes 也可能需要 provider verification；PHOENIX 不能绕过 Google 的 consent 或 verification policy。
