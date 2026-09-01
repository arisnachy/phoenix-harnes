# @phoenix-ai/dsh-secret-vault

[English](README.md) | 中文

secret vault 在 `ctx.credentials` 之上提供仅供人工使用的 `/secret` 命令。可在编辑器中使用 `/secret set NAME VALUE`、`/secret status NAME` 或 `/secret delete NAME`。值会直接交给凭据提供方；`command/run` 会省略原始输入，确认消息只包含脱敏状态。命令不会发送给模型。

像 LLM 适配器这样的消费者仍会在提供方操作内部解析指定的 `CredentialRef`。vault 不提供读取秘密的工具，也不会把秘密值放入模型上下文。

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
