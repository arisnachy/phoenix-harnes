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

`@phoenix-ai/dsh-authorization/google` 是位于中立授权层旁、由协议所有者实现的 Host Service。它注册 `Google Workspace` 授权流程，使用 Google 桌面应用授权码模式，包括随机的 loopback 回调监听器、PKCE S256 与 `state`。配置中的 `clientId` 只代表 OAuth 应用标识，而不是用户密码或 OAuth token；发行组合从 `PHOENIX_GOOGLE_OAUTH_CLIENT_ID` 读取它。

Google access token 和 refresh token 由 Host 独占管理，并作为带版本的持久化 `grant` 记录保存在 `authorization-google/account` 下。下次启动 PHOENIX 时，broker 会恢复该授权；只要 Google 仍接受 refresh 凭据，就能静默更新已过期的 access token。面向浏览器的 `list()`、`describe()`、`inspect()`、配置、环境和工具结果都不能包含秘密；OAuth token、authorization code 和 PKCE verifier 不会进入模型可见内容。默认本地凭据提供方将 grant 存于仅所有者可访问的凭据文件；需要防御恶意同 UID 进程的部署应改用操作系统隔离的凭据提供方。

Host 集成使用 `ctx.get('googleApi')` 显式获取 broker，然后调用 `request({ service, path, ... })`；该子模块不会扩大全局 `Context` API。调用方不能同时提供任意 URL 与自称的 scope。`service` 只能是 `gmail`、`calendar`、`drive`、`docs`、`sheets`、`slides` 或 `contacts`，每个服务的 API 根路径和必要 OAuth scope 都由 broker 确定。路径必须保持相对形式；禁止自带凭据或 cookie header；带凭据的请求设置 `redirect: 'error'`，仅在最终 Google `fetch` 边界添加 Bearer token。结果只能返回 status、media type 和 body，不得包含 access 或 refresh token。即使向 Google 撤销授权的尽力请求失败，`disconnect()` 也会清空 Host 内存并删除持久 grant。

Google 桌面应用不支持增量授权，因此 provider 在一次浏览器授权流程中请求配置好的全部 Workspace scope，但只保留 Google **实际授予**的 scope，绝不假设用户同意全部权限。缺失权限的功能会以 `GOOGLE_SCOPE_DENIED` 拒绝运行，用户可明确重新连接以调整同意范围。即将到期的 access token 在 Host broker 内刷新；refresh token 轮换则原子地写回持久 grant，使正常重启不必反复授权。使用敏感或受限 scope 的部署仍需满足 Google OAuth 验证要求。

当前 Windows restricted-token sandbox 限制写入而非读取，所以 `$DSH_HOME/.credentials.yaml` 是仅所有者可访问的本地凭据存储，**不是**操作系统隔离的保险库。Google 持久 grant 现在使用与其他提供方 grant 相同、已有文档说明的凭据边界。若必须防范恶意同 UID 进程，仍须使用独立的 OS keychain 或 credential broker。

## Model Experience

没有直接影响：授权是配置期与人的对话，flow、notice、prompt、OAuth token、credential payload 与 broker authentication header 都不会进入模型请求。面向模型的 Google 工具只能看到其所属 integration 明确选择返回的 Google API 数据。

#### KV Cache effect

不失效；任何授权状态都不会进入请求前缀。

## Known Limitations and Deferred Work

- **flow 不可恢复** —— 一次尝试只存活于发起它的进程中，因此登录途中刷新浏览器会丢弃它，人需要重来。可持久的尝试需要一个本 seam 并不具备的存储。
- **Google 登录按设计只在当前进程有效** —— 重启后需要重新授权。把 refresh token 持久化到 `credentials-local` 会暴露给刻意恶意的同 UID 进程，因此在 OS-isolated broker 可用之前，durable Google session 保持禁用。
- **authorization seam 没有通用 revoke 操作** —— provider 可以像 Google broker 一样拥有协议专属的 revocation，但 `ctx.authorization` 本身不提供跨 provider 的统一登出方法。
- **没有 flow 的键是惰性的** —— seam 只报告已注册的内容，因此被卸载插件遗留的记录可以删除但无法重新授权。识别这种孤儿记录由调用方自行 join，与 [`listRecords()`](../credentials/README.zh.md#surface) 的情况相同。