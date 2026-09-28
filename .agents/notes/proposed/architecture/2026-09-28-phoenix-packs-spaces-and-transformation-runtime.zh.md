# Agent Note: Phoenix Packs、Spaces 与变形运行时

Status: proposed

[English](2026-09-28-phoenix-packs-spaces-and-transformation-runtime.md) | 中文

## 问题

PHOENIX 已经能通过 agent preset 为不同 session 组合不同 agent，也能通过 bundle 在启动时装配不同 profile，但这两个抽象都不能表达我们现在需要的产品行为：同一个正在运行的 PHOENIX 应该能在不重启进程、不改写当前 agent 组合、也不混合不同业务数据的前提下，快速变成 HealthIA、药房、诊所、超市、会计系统或其它领域环境。

agent preset 刻意是 session-scoped 且面向模型的；profile bundle 刻意是 boot-scoped 的；Workspace 刻意表示一个持久化文件系统目录及其 session 归属。把其中任意一个直接扩成新的“应用模式”，都会破坏已经保护 session 重建、启动组合和文件系统所有权的边界。

缺少的是：

- 一个可分发的领域定义，说明某种 PHOENIX 环境提供什么；
- 该定义的一个本地持久化实例，拥有自己的标题、配置、状态，并在未来拥有 federation 连接；
- 一条快速激活路径，可以改变可见的操作环境，而不重新安装或重启 PHOENIX；
- 一个离线本地缓存，使已安装环境打开时不依赖 Store；
- 一个安全边界，防止 Store 条目在下载后自动变成任意可信可执行代码。

## 方案

引入两个一等概念和一层激活机制。

### Pack

**Pack** 是一个带版本、可安装的领域定义。它不保存用户业务记录。它声明领域元数据、导航、UI 贡献、所需 capability、可选模块、数据 namespace、默认 automation/workflow 描述以及兼容性要求。

Pack 不是 agent preset，也不是 profile bundle。Pack 可以声明某个 Space 中创建的新 session 应优先使用某个已有 agent preset；安装器未来也可以解析经过独立信任的 plugin/bundle 依赖。但激活 Pack 永远不会改写一个已经产生历史的非空 session 的 agent 组合。

首个 manifest 版本应为声明式并 fail-closed。远程 Store 内容不会因为被下载就直接获得任意可执行权限。未来若 Pack 需要可执行依赖，必须经过单独、显式的安装/信任步骤，并继续作为普通 PHOENIX plugin/bundle 受现有 loader 与 trust 边界约束。

概念 manifest：

```yaml
schemaVersion: 1
id: healthia
version: 1.0.0
name: HealthIA
category: healthcare

navigation:
  - dashboard
  - patients
  - consultations
  - laboratories
  - medications

modules:
  - healthia-clinical
  - healthia-devices

requirements:
  capabilities:
    - scheduler
    - vault
    - multimodal

sessionDefaults:
  agentPreset: healthia
```

最终 wire/on-disk schema 由 Pack package 负责，并与 Store 传输协议独立版本化。

### Space

**Space** 是一个持久化的本地实例：一个 base Pack 加零个或多个启用的 module Pack。用户真正切换的是 Space。

Space 拥有某个业务环境的身份与配置，但具体业务数据仍由对应领域 package 自己拥有；Federation 负责连接记录。因此 Space record 只保存引用和生命周期元数据，而不是一个巨大的任意业务数据 blob。

初始概念 record：

```ts
interface SpaceRecord {
  id: SpaceId
  title: string
  basePack: PackRef
  modules: readonly PackRef[]
  workspaceId?: WorkspaceId
  createdAt: string
  updatedAt: string
}
```

当某个环境确实对应文件项目时，Space 可以引用已有 Workspace，但两者不会互相包含或替代。删除 Workspace 不删除 Space；删除 Space 也不删除文件目录。

系统内置一个不可移除的 **Phoenix General** Space，由 General Pack 支持。即使 Store 不存在、也没有安装任何可选 Pack，干净安装仍然始终有一个可返回的有效环境。

### 激活

激活表示为某一个 client surface 选择一个 Space，并把该 Space 的 Pack 描述投影到 shell。它不会重启 PHOENIX 进程、重新运行 package 安装，也不会全局改变所有已连接 client。

host 负责持久化 Space/Pack registry；client 负责自己当前激活的 Space，并在需要领域操作时显式发送 `spaceId`。这样一个浏览器的导航选择不会成为 process-global 状态，也为未来同一 host 上多个 client 同时使用不同 Space 留出空间。

激活只解析本地已安装 Pack 数据。网络发现与 Store 更新检查绝不进入激活关键路径。

第一批产品入口：

- sidebar/header 中紧凑的 Space switcher，例如 `Phoenix General ▾`；
- `Ctrl+K` 搜索本地已安装 Spaces；
- `/space <name>` 作为确定性的无模型命令；
- 为该 client 恢复上次激活的 Space；
- 之后，自然语言如 “Kira, abre HealthIA” 可以触发显式的 Space 切换动作，但 PHOENIX 不会因为分类器猜测某个领域就静默切换。

### Pack Store 与本地缓存

Store 是发现与分发服务，不是运行时真相源。

```text
Phoenix Store
    |
    | discover / install / update
    v
Local Pack Registry + Versioned Cache
    |
    | resolve locally
    v
Space
    |
    | activate
    v
Phoenix Shell
```

已安装 Pack 离线仍可使用。当仍有 Space 引用旧版本时，本地保留该 Pack 版本；更新先并排 staging，新版本通过兼容性与迁移检查后才成为 Space 选中的版本。因此 rollback 不需要重新下载旧 Pack。

本地根路径由 owning package 从 Harness home 派生，调用方不自行拼绝对路径；本 proposal 不把某个 Windows 路径硬编码进契约。

### Package 拓扑

预期 ownership：

| Package | 职责 |
| --- | --- |
| `packages/pack/pack/` | Pack 类型、manifest 校验、兼容性词汇、registry service definition |
| `packages/pack/pack-local/` | 可信本地 installed-Pack provider/cache |
| `packages/space/space/` | 基于 `storage-domain` 的持久化 Space registry |
| `packages/client/ui-space-switcher/` | switcher / search / manage 产品入口 |
| `packages/client/ui-space-shell/` | 将 active Pack 投影到现有 navigation/layout slot |
| `packages/pack/pack-store/` | 后续 Store discovery/install/update provider |
| `packages/federation/*` | 后续 node identity、pairing、capability、event mesh、audit；关系属于单一 Space 时以 `SpaceId` 为 key |

实现期间如果现有 package 明显已经拥有某项职责，名称可以调整；但以下 ownership 边界不变：Pack 定义、Space 持久化、client 激活、Store 传输、Federation 必须是独立 seam。

### 与现有 PHOENIX 抽象的关系

- **Agent preset：** 选择某 session 的模型侧组合。Space 可为新/空 session 推荐一个 preset，但不会替代 preset 系统。
- **Profile/bundle：** 决定进程启动组合和安装的 plugin 代码。Pack 激活不会替代 boot composition。
- **Workspace：** 拥有一个文件目录和 session 分组。Space 只可引用它。
- **Settings：** 保存用户偏好；可保存 switcher 偏好，但不是 Space 数据库。
- **Client module loader：** 继续是浏览器代码加载机制。Space UI 必须通过现有 slot system 组合，不能另造第二套组件框架。
- **Living/HARDNESS：** Pack 可声明需要哪些 capability，但 capability 是否真实存在并可用，仍由这些现有 registry 负责。

### 存储与隔离

`dsh-space` 使用专属、版本化的 `storage-domain` domain。删除 Space 只删除 Space record 及 Space 自己拥有的 presentation/config 状态；领域业务记录只能由所属领域的显式 lifecycle 删除。

Pack 不得直接取得另一个 Space 的业务记录路径。凡是 Space-scoped 的领域操作，都在 owning boundary 显式接收 branded `SpaceId`，而不是依赖 process-global 的“当前 Space”。

这也成为 Federation 的基础：诊所与实验室、患者与医生之间的连接都可归属于某个 Space，并能在不授予其它 Space 权限的情况下单独撤销。

## 交付阶段

### Phase 0 — Contract 与 guard

- 合入本 Agent Note；
- 定义 branded `PackId`、`PackRef`、`SpaceId`；
- 定义 v1 Pack manifest 校验；
- 定义 Space 持久化 schema 与 lifecycle；
- 测试拒绝 malformed id、未知 Pack version 和跨 Space 错误引用。

### Phase 1 — Local Spaces

- 基于 `storage-domain` 实现 `ctx.spaces` / Space registry；
- 内置不可移除 fallback `Phoenix General`；
- 实现 create/list/rename/delete 以及 client 的 last-active selection；
- 在 authoring/install RPC 之前，先暴露只读 Space roster RPC。

该阶段结束时 PHOENIX 已能在本地 Space 之间切换，即使这些 Space 暂时仍都长得像 General。

### Phase 2 — Transformation shell

- 加 Space switcher 与 `Ctrl+K`；
- 加 `/space` 命令；
- 通过现有 client slots 实现 Pack 驱动的 navigation/layout；
- 每个 Space 保持独立 UI state；
- 返回先前 Space 时不 reload 页面。

参考本地桌面上，已安装 Pack 的 shell/navigation 激活目标为 p95 小于 250 ms，不计可选的领域数据 lazy fetch。

### Phase 3 — Local Pack registry

- 加版本化 local Pack install/cache；
- 支持 `system`、`verified`、`community`、`user` trust metadata，但 metadata 本身不等于执行权限；
- staging Pack upgrade，并保留仍被引用的旧版本；
- HealthIA 作为第一个完整 Pack，同时再做一个非健康领域的小 Pack 证明核心是通用的。

### Phase 4 — Store

- 远程 catalog/search；
- 下载并校验 signature/integrity；
- dependency/compatibility resolution；
- 显式 install；
- staged update 与 rollback；
- activation 不依赖网络。

Store 初始可以免费，也可未来支持多个 catalog；runtime contract 不绑定某个商业后端。

### Phase 5 — Space-aware automation 与 agents

- 新 session 可继承 Space 推荐的 agent preset；
- tools/workflows 在需要时接收显式 Space context；
- shell 切换 Space 时，已有非空 session 的模型组合永不被静默更换；
- 通过显式 “在此 Space 新建/移动 session” UX 处理跨 Space，而不是破坏历史语义。

### Phase 6 — Phoenix Federation

- node identity；
- 一次性 pairing code / QR；
- capability grants；
- pause / disconnect / revoke；
- event mesh；
- signed audit receipt；
- offline queue/reconciliation。

HealthIA ONE、医生、诊所、实验室、药房、零售、库存、会计及其它 vertical 都消费同一个 Federation seam，不再各自发明连接系统。

## 考虑过的替代方案

**把 agent preset 直接当 application preset。** 否决，因为 agent preset 的职责是 model-facing、per-session 组合。把 UI navigation、业务数据和连接状态塞进去，会把持久业务环境绑到一个其重建规则禁止随意中途切换的 session 机制上。

**复用 profile bundle，每次变形都重启 PHOENIX。** 否决，因为 profile 是 boot composition。重启会让切换变慢、打断工作，也使两个 client 无法并行处于不同环境。

**一直扩 Workspace 直到它等同 Space。** 否决，因为 Workspace 已有精确的文件系统所有权契约。很多有效 Space 没有 project directory，一个目录也可能参与多个业务 Space。

**让 Store 成为真相源并按需流式加载 Pack。** 否决，因为变形必须快且离线可用。Store 只负责分发，本地 registry 执行已安装定义。

**下载 Pack 后立即允许任意代码执行。** 否决，因为 discovery catalog 不能变成 remote-code-execution 通道。声明式 manifest 与 executable plugin 安装有不同信任后果，必须分开审批。

**为每种模块组合制造一个 Pack。** 否决，因为 `Clinic + Accounting + Inventory` 会导致组合爆炸。Space 应组合一个 base Pack 加 optional module Pack。

## 验收标准

- 干净安装始终存在并可激活 `Phoenix General`。
- 切换已安装 Space 不发送网络请求、不重启进程。
- 使用同一个 Pack 的两个 Space 保持彼此独立的配置与 UI state。
- Space 可引用但永不吞并 Workspace。
- shell 切换不会重组非空 session。
- Pack manifest 在 durable/download 边界版本化并校验。
- Store 安装若要获得任意可执行权限，必须经过独立显式 trust/install 路径。
- 删除或升级 Pack 时，不能在无明确 migration/compatibility 结果的情况下让已有 Space 变成孤儿。
- 实现需要 focused unit coverage，以及覆盖 Space switcher/变形路径的 keyless assembled-web snapshot。
- HealthIA 与至少一个非健康 Pack 使用同一套 core API，core 不能出现 `if (healthia)` 一类领域特判。

## 风险

**范围膨胀。** Packs、Spaces、Store 与 Federation 足以变成重写。必须分阶段交付；Federation 不进入第一批 Space/Pack 代码。

**动态 plugin lifecycle 冲突。** 继续以现有 Cordis 与 client module lifecycle 为权威；首版 Pack contract 优先声明式贡献，不另造第二个 plugin loader。

**供应链风险。** Community Store 可能分发恶意 metadata 或 dependency。integrity、provenance、permission 与 executable installation 必须显式且 fail closed。

**数据迁移。** Pack 更新可能改变领域 schema。版本激活要 staged；新的 Pack version 不是自动迁移业务数据的许可证。

**Current-Space 泄漏。** process-global current Space 最终会在 client 或企业之间泄漏数据。因此领域边界显式使用 branded `SpaceId`，激活保持 client-scoped。
