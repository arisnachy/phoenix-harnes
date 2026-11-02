# dsh-authorization

[English](README.md) | 中文

授权 Service Definition（`ctx.authorization`）。有些凭据无法配置，只能获取：拿到它意味着与人对话——打开这个页面、粘贴那个码、选一个账号。本 seam 拥有这段对话及其生命周期，但从不拥有协议本身。

**flow 是某个插件“如何取得自己那份凭据”的知识。** 它以自己写入的 [`CredentialKey`](../credentials/README.zh.md#two-key-spaces-two-questions) 注册，因此 flow 声明了自己产出哪条记录，并通过该键的 scope 声明由哪个插件为记录内部的格式负责。第二种授权协议以另一个 flow 的形式到来，而不是另一个 seam。

**写入由 flow 拥有。** `run()` 返回即表示记录已经通过 `ctx.credentials` 提交；seam 核实的是它在本次尝试期间观察到的提交——只看记录存在与否，会让重新授权把陈旧记录冒充成新鲜的——并拒绝那些返回时没提交记录的 flow。让提交发生在 flow 内部，才能使一个通过自有 store 适配器持久化的库保持为唯一写入方，而不是把凭据复制出来再写第二遍。

**交互随请求传入，而非注册表。** 发起授权的一方才是能与人对话的一方，因此提示恰好抵达发问的那个界面，无头调用方则传入一个直接拒绝的交互实现。这样既不存在“环境提供方缺席”的问题，也不会出现某个提示该归两个已打开页面中哪一个的疑问。

## 接口

```ts
import type { Context } from '@phoenix-ai/cordis'
import { AuthorizationDeclinedError, type AuthorizationSession } from '@phoenix-ai/dsh-authorization'
import { credentialKey } from '@phoenix-ai/dsh-credentials'

declare const ctx: Context
declare const exchange: (signal: AbortSignal) => Promise<void>

const key = credentialKey('llm-pi-ai', 'openai-codex')

const dispose = ctx.authorization.registerFlow({
  key,
  label: 'ChatGPT (Codex)',
  methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
  async run(session: AuthorizationSession) {
    session.notify({ message: 'Continue in your browser', url: 'https://auth.example/start' })
    const code = await session.prompt({ kind: 'text', message: 'Paste the code' })
    // Commits the record through ctx.credentials before resolving.
    await exchange(session.signal)
    void code
  },
})

ctx.authorization.list()                    // [{ key, label, methods, inFlight }]
ctx.authorization.describe(key)             // the same entry, or undefined
await ctx.authorization.begin({             // { status: 'authorized' | 'cancelled' }
  key,
  interaction: { notify: () => {}, prompt: () => Promise.reject(new AuthorizationDeclinedError()) },
})
ctx.authorization.cancel(key)               // withdraw whatever is running for the key
dispose()
```

同一个键同时只允许一次尝试。第二个调用方会收到 `ALREADY_IN_FLIGHT` 拒绝而不是被并入：否则两者会通过同一个 flow 向不同的人发问，而第二个人回答的是问给第一个人的问题。`inFlight` 放在 entry 上，界面据此把按钮渲染为禁用，而不是靠报错才发现。

`cancel(key)` 与请求自带的 signal 并存，是因为请求/响应式传输要用第二次调用来响应“取消”按钮，而它拿不到第一次调用的 signal。注册在尝试进行中被 dispose 的 flow 也以同样方式撤销：它的执行体属于一个正在离开的插件。

调用方在发起前就已撤销的尝试，既不占用该键也不启动 flow——若指望每个 flow 都在首个 await 之前检查自己的 signal，那么没有检查的那个就会占着键一直挂起。校验仍然先执行，因此调用方给出的键或方法不存在时，无论它是否已经放弃都会收到报错。

人的“不”是一种结果，不是故障。选择拒绝的交互实现让 prompt 以 `AuthorizationDeclinedError` 拒绝，在提示被拒之后才失败的尝试以 `cancelled` 结算，与 signal 撤销完全一致；其余任何 prompt 拒绝仍是抵达调用方的 flow 故障。notice 依同一原则即发即忘，并由 seam 兜底：渲染不了 notice 的界面丢掉的是那条 notice，而不是整次尝试。

`authorization/settled (key, settlement)` 在键释放之后触发，覆盖每一种终态。`settlement` 在 `begin()` 能返回的两种状态之外增加了 `failed`：失败以抛出的错误抵达其调用方，因此事件流是未发起该尝试的旁观者唯一能区分“被拒绝”与“出故障”的地方。监听器故障被就地遏制：每个监听器都会执行，抛错或拒绝只记录日志、不改变已结束尝试的结果，仅 `INVARIANT` 编码的故障在其余监听器执行完后重抛。

## 交互词汇

notice 是单向的，且从不携带机密：一条消息，以及可选的“人需要打开的页面”和“需要在该页面输入的码”。prompt 是 flow 无法自答的问题——`text`、`secret` 或 `select`——其中 `secret` 与 `text` 的差别仅在呈现方式。prompt 自带 `signal`，使得一个让手输码与浏览器回调赛跑的 flow 可以在尝试继续的同时撤下落败的那个问题；撤销整次尝试则用请求的 signal。

这套词汇刻意小于任何单个 provider 的词汇：它描述的是界面必须渲染什么，因此能渲染一个 flow 的界面就能渲染全部 flow。

## Google Workspace Host broker

`@phoenix-ai/dsh-authorization/google` 是位于中立 seam 旁边、由协议所有者实现的 Host Service。它注册一个 `Google Workspace` flow，并采用 Google Desktop 应用的授权码流程：随机 loopback listener、PKCE S256 与 `state`。配置中的 `clientId` 只标识 OAuth 应用，并不是用户密码或 OAuth token；发布组合从 `PHOENIX_GOOGLE_OAUTH_CLIENT_ID` 读取它。

Google 的 access token 与 refresh token 被明确限制为**仅当前进程可用**。授权成功后，broker 只把它们保存在 Host Service 的私有内存中，并在 `authorization-google/account` 下提交一个不含机密的 `{ kind: 'api-key' }` marker，让中立 authorization seam 能确认人工授权已经提交。面向浏览器的 `list()`、`describe()`、`inspect()`、credential metadata、配置、环境变量以及 marker 本身都不包含 OAuth token、authorization code 或 PKCE verifier。PHOENIX 重启后必须重新进行 Google 授权；这是有意设计，直到 PHOENIX 拥有一个能够隔离同 UID 工具进程的 credential backend。`credentials-local` 明确不是这种边界。

Host integration 通过 `ctx.get('googleApi')` 显式取得 broker，再调用 `request({ service, path, ... })`；这个 submodule 刻意不扩大全局 `Context` API。调用方不能提供任意 URL 再自行声明 scope。`service` 只能是 `gmail`、`calendar`、`drive`、`docs`、`sheets`、`slides` 或 `contacts`；每个 service 的 API root 与所需 OAuth scope 都由 broker 固定。path 必须保持在该 service root 下，credential/cookie header 会被拒绝，携带凭据的请求强制使用 `redirect: 'error'`，Bearer token 只在最后的 Google `fetch` 边界注入。结果只返回 status、media type 与 body，不返回 access/refresh token。`disconnect()` 即使 Google 的 best-effort revoke 失败，也会清空 Host 内存并删除 marker。

Google installed application 不支持 incremental authorization，因此挂载的 provider 会在一次浏览器授权中请求配置的 suite scope 集合。但它会在 Host 内存中保留 Google **实际** 返回的 scopes，而不是假设用户同意了全部权限。未获授权 scope 对应的能力会以 `GOOGLE_SCOPE_DENIED` fail closed；如果用户希望更改授权范围，可以明确重新连接。在同一个 PHOENIX 进程内，接近过期的 access token 会由 Host broker 刷新；refresh-token rotation 只存在于 Host 内存中，绝不持久化。使用 sensitive/restricted scopes 的部署仍必须满足 Google 的 OAuth verification 要求。

当前 Windows restricted-token sandbox 限制写操作，但不限制读操作，因此不能把 `$DSH_HOME/.credentials.yaml` 变成 secret vault。不得在 `credentials-local` 上重新启用 durable Google refresh token。要实现安全的持久化，必须使用独立 credential broker，其存储与 IPC 对任意同 UID 的模型/工具进程不可访问。

## Model Experience

没有直接影响：授权是配置期与人的对话，flow、notice、prompt、OAuth token、credential payload 与 broker authentication header 都不会进入模型请求。面向模型的 Google 工具只能看到其所属 integration 明确选择返回的 Google API 数据。

#### KV Cache effect

不失效；任何授权状态都不会进入请求前缀。

## Known Limitations and Deferred Work

- **flow 不可恢复** —— 一次尝试只存活于发起它的进程中，因此登录途中刷新浏览器会丢弃它，人需要重来。可持久的尝试需要一个本 seam 并不具备的存储。
- **Google 登录按设计只在当前进程有效** —— 重启后需要重新授权。把 refresh token 持久化到 `credentials-local` 会暴露给刻意恶意的同 UID 进程，因此在 OS-isolated broker 可用之前，durable Google session 保持禁用。
- **authorization seam 没有通用 revoke 操作** —— provider 可以像 Google broker 一样拥有协议专属的 revocation，但 `ctx.authorization` 本身不提供跨 provider 的统一登出方法。
- **没有 flow 的键是惰性的** —— seam 只报告已注册的内容，因此被卸载插件遗留的记录可以删除但无法重新授权。识别这种孤儿记录由调用方自行 join，与 [`listRecords()`](../credentials/README.zh.md#surface) 的情况相同。