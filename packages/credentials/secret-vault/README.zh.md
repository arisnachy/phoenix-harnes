# @phoenix-ai/dsh-secret-vault

[English](README.md) | 中文

secret vault 在 `ctx.credentials` 之上提供仅供人工使用的 `/secret` 命令。提供方机密使用 `/secret set NAME VALUE`、`/secret status NAME` 或 `/secret delete NAME` 管理。网站凭据在浏览器下方受保护的 Secure Ask 卡片输入和管理；`login-set` 拒绝凭据消息。网站记录采用 Windows DPAPI CurrentUser 加密，并按 origin 明确授权自动使用。命令值直接交给提供方，`command/run` 省略原始输入，确认信息只包含安全状态。

像 LLM 适配器这样的消费者仍会在提供方操作内部解析指定的 `CredentialRef`。Windows 浏览器 broker 会根据规范化页面 origin 派生登录引用，在 DOM 注入前再次核对实时 origin，并且登录值只进入受信任执行路径。vault 不提供读取秘密的工具，也不会把秘密值放入模型上下文。

vault 还会为 Windows 浏览器消费者注册仅限主机使用的 `credentials/web-login-status` 和 `credentials/web-login-resolve` 监听器。消费者使用规范化的实时 origin 调用这些事件；状态只返回是否存在记录和授权元数据，账户、秘密以及有界的 `extra:0` 到 `extra:3` 值只留在受信任的主机进程中。已有但未授予自动使用权的 DPAPI 记录会明确拒绝访问；只有不存在 DPAPI 记录时，消费者才可使用其独立负责的旧版迁移路径。

默认本地提供方把值存储在仅所有者可访问的凭据文档中。在 Windows 上，文件系统 ACL 仍由账户和部署负责；本包保证命令值不会进入模型请求或持久化命令输入。

## Model Experience

### Provider-backed credential use

模型可以通过 provider 支持的集成使用已配置的凭据，但无法读取 vault 中的值或原始 `/secret` 命令。使用该能力时，模型只会收到安全的已配置或不可用状态。

#### What the model sees

模型只会看到使用方能力提供的安全配置或不可用状态。模型无法读取 vault 中的值或原始 `/secret` 命令；provider 会在授权操作中内部解析指定的凭据。

#### Token effect

秘密值不会增加模型 token。使用方公开安全状态时，只会使用有界的描述信息。

#### KV Cache effect

轮换凭据不会改变模型请求前缀。使用方 provider 可以在下一次请求中使用新值，而不将其暴露到上下文中。

## Known Limitations and Deferred Work

- **vault 不替代主机存储保护** — 在 Windows 上，部署必须将 credentials 文档放在具有适当文件系统 ACL 的账户下。
- **命令是受支持的秘密输入方式** — 任意秘密都应通过 `/secret` 输入，而不是普通 prompt。
