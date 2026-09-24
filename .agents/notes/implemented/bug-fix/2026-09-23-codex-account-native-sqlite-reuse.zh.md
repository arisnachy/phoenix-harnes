# Agent Note: Codex 账户 probe 复用原生 SQLite 状态

Status: implemented

[English](2026-09-23-codex-account-native-sqlite-reuse.md) | 中文

## Problem

Codex 账户桥接器为了复用 ChatGPT 身份验证保留了用户真实的 `CODEX_HOME`，但会强制仅用于元数据的账户 probe 使用 `CODEX_HOME/phoenix-runtime/sqlite/account`。Codex 会把每个全新的 SQLite 状态库视为 `CODEX_HOME` 下 rollout 历史的索引，因此第一次读取配额之前必须先对用户完整 Codex 会话历史执行 backfill，app-server 才能完成初始化。Codex 的启动 gate 有时间上限，所以较大的历史可能让这个私有账户数据库一直处于 `running`，随后 app-server 退出，而 Phoenix 又不断重试同一个冷 backfill。在此期间，`account/rateLimits/read` 始终无法返回，5h/7d 配额 UI 也收不到新的遥测。

## Decision

账户、配额、用量和 connector probe 现在继续保留 `CODEX_HOME`，并用两层机制强制把 SQLite fallback 指向同一个路径：子进程环境设置 `CODEX_SQLITE_HOME=CODEX_HOME`，元数据 app-server 同时收到最高优先级的 CLI `sqlite_home=CODEX_HOME` override。元数据 probe 会忽略继承／Profile 提供的 `CODEX_SQLITE_HOME` 与 `PHOENIX_CODEX_SQLITE_HOME`。第二层保护在 Windows 上尤其重要，因为 replacement Host 即使源代码已停止生成旧值，也可能从被替换进程继承旧的 `.../phoenix-runtime/sqlite/account`。CLI override 还会阻止陈旧 Codex config layer 再次选择已退役的 Phoenix account 数据库。

账户检查失败后的冷却时间从 30 秒增加到 120 秒。一次原生启动失败本身就可能已经耗尽 Codex 的完整 state-backfill 等待时间，因此立即再次启动元数据 app-server 可能持续刷新同一个失败循环并刷屏 Host 日志。成功 probe 仍使用现有的一分钟遥测 TTL。

此前已经加入的客户端持久化配额快照继续作为原生刷新短暂失败时的 UI fallback。本次修改恢复负责提供新百分比和重置时间戳的后端通路，而不是永久依赖 fallback。

## Alternatives considered

**保留私有账户 SQLite 数据库，只提高 Phoenix probe 超时。** 拒绝：启动 backfill gate 由 Codex 自己控制；当 Codex 已退出后，更长的外层超时并不能让元数据 app-server 完成。

**自动删除或修改 Codex backfill 状态。** 拒绝：Phoenix 不拥有用户的原生 Codex 数据库，也不应改写 provider 内部恢复元数据。

**复用私有单次 subagent 数据库。** 拒绝：账户读取不需要线程执行状态，把元数据轮询与 subagent 历史耦合只会增加不必要的竞争和 backfill 工作。

## Consequences

正常 Phoenix 启动不再为配额 probe 选择已退役的 `phoenix-runtime/sqlite/account` 数据库，即使陈旧 Windows 环境或 Codex config 仍然指向它。现有 Phoenix 私有账户 SQLite 文件会原样保留在磁盘上。如果用户 `CODEX_HOME` 下的原生 Codex 状态本身也不健康，账户遥测仍可能不可用；Phoenix 会退避而不是反复启动新的失败 app-server，同时 UI 会保留最近可信配额快照或明确的 5h/7d 加载位置。

## Testing
## Testing

包级回归测试现在检查陈旧的 ambient 与显式 Phoenix SQLite 路径都会被丢弃、元数据子进程会收到 `CODEX_SQLITE_HOME=CODEX_HOME`，并且 app-server 命令携带匹配的 CLI `sqlite_home` override。包级与组装浏览器 gate 仍由 CI 负责。
