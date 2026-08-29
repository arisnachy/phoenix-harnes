# HARDNESS 单次同化设计

[English](2026-08-28-hardness-one-pass-assimilation-design.md) | 中文

- 日期：2026-08-28
- 状态：提议实施
- 基础提交：`6afce388522b7849f943a2d5fa929c75bafb4f71`

## 目标

让 PHOENIX 在一个有界执行循环中解决能力缺口，而不是把发现、诊断、修复、验证、晋升和 UI 适配分散到多个独立阶段。

一个能力不能仅因为已被索引就视为已同化。只有当 PHOENIX 能理解其契约、满足或报告依赖、在策略约束下执行、收集证据、晋升或隔离它，并通过正确的界面表面呈现结果时，才算完成同化。

## 非目标

- 不削弱 HARDNESS 验证，也不允许未经验证的能力绕过策略。
- 此工作进行期间不添加新的 donor 目录。
- 不替换现有的 HARDNESS registry、acquisition registry、approval system、artifact runtime 或 OpenClaw compatibility runtime。
- 不在 PHOENIX 之外创建第二个控制平面。

## 单次生命周期

对于每个任务能力需求，运行一个有界生命周期：

`resolve -> inspect -> qualify -> acquire -> prepare -> approve -> execute -> normalize -> render -> verify -> promote/quarantine -> learn`

生命周期只可针对已明确诊断的原因进行内部重试。每次失败后不得从零重新开始发现流程。

### 1. 解析

向 HARDNESS 查询已经验证且匹配的能力。如果存在，则直接执行。

### 2. 检查

如果没有已验证能力，则收集所有相关的已索引候选，并在选择之前丰富其描述符。在可发现时，丰富过程必须填充：

- 输入 schema
- 输出 schema / MIME family
- 依赖
- 所需权限
- 兼容性约束
- 限制
- provider/runtime 标识
- 展示提示
- 来源/版本

### 3. 资格验证

执行前运行确定性的预检：

- 重复项/别名检测
- 依赖可用性
- 权限要求
- runtime 兼容性
- 富输出的 renderer 可用性
- 已知隔离/失败历史

无法通过预检的候选必须以具体原因被拒绝，而不是返回泛化失败。

### 4. 获取并准备

使用现有的 `AcquisitionRegistry`。必须显式注册原生 builders 和 OpenClaw broker。OpenClaw 准备过程必须使用固定版本的 package host 和由 PHOENIX 拥有的具体 package installer。

`packages/hardness/adapters/src/index.ts` 中的生产组合必须把 OpenClaw broker 传入 `createHardnessAcquisition(...)`，而不只是索引目录。

### 5. 批准

所有副作用继续通过现有 PHOENIX approval bridge 采取 fail-closed 行为。能力获取、package 安装、凭据使用、外部副作用和高风险权限都不得绕过策略。

### 6. 执行

生产 mission runtime 必须接收一个具体的 `CapabilityExecutor`，用于执行已准备的非 tool 能力。现有 tool 执行继续作为原生快速路径。

执行失败必须至少返回包含以下内容的类型化诊断：

- 阶段
- capability id
- provider
- 失败类别
- 是否可重试
- 适用时缺失的依赖/权限
- 当前已收集的证据

### 7. 规范化并渲染

每个成功结果都要经过中央结果规范化器。

规范化器应优先采用显式能力输出元数据，然后保守推断展示类型：

- 表格数据 -> table artifact
- 数值序列 -> chart artifact
- 字段/schema -> form artifact
- 图像 payload/reference -> image artifact
- 文档 payload/reference -> document artifact
- 安全 HTML/app manifest -> sandboxed mini-app artifact
- 未知结构化值 -> JSON artifact
- 普通标量/文本 -> text artifact

规范化器必须附加 `meta.artifact`，这样现有 conversation renderer 就能使用富 UI，而不是退化为原始文本/JSON。

### 8. 验证并晋升/隔离

仅执行成功还不够。HARDNESS 记录的证据必须包括契约匹配、执行结果、输出验证、renderer 成功以及策略合规。

晋升策略：

- 静态/预检资格验证通过时，`experimental -> testing`
- 只有在存在有效执行证据并且输出验证通过后，`testing -> verified`
- 任何确定性的危险/无效行为 -> `quarantined`
- 瞬态失败保持未验证，并保留可重试诊断

验证必须绑定版本，因此能力更新后必须重新资格验证。

### 9. 学习

按能力版本持久化紧凑的使用配方：

- 成功的参数形状
- 所需设置/依赖
- 有效展示表面
- 已观察到的失败特征
- 首选用例 / routing 提示

这些知识属于 PHOENIX/HARDNESS 的元数据和证据存储，而不是模型 prompt。模型只接收当前任务相关的小型能力子集。

## 生产 wiring 变更

第一个实现切片必须关闭当前不完整的纵向路径：

1. 添加由 PHOENIX 拥有的具体 OpenClaw package installer。
2. 在 HARDNESS adapter 组合中实例化 OpenClaw package host 和 broker。
3. 将 broker 传给 `createHardnessAcquisition(hardness, builders, broker)`。
4. 向 `installHardnessMissionRuntime(...)` 提供具体的 `CapabilityExecutor`。
5. 为 tools、skills 和 donor 能力添加 descriptor enricher。
6. 在任务完成前添加 result normalizer/artifactizer。
7. 在同一个任务事务中记录晋升/隔离证据。

## 单次编排规则

`runHardnessMission` 为整个尝试持有一个诊断上下文。当某一阶段失败时，下一步必须直接消费该诊断。

示例：

- 缺失依赖 -> 获取/安装该依赖 -> 从预检继续
- 缺失权限 -> 请求批准 -> 从执行继续
- 输出不可渲染 -> 规范化/适配输出 -> 验证 renderer -> 从验证继续
- 候选损坏 -> 隔离候选 -> 尝试下一个已排序候选

除非任务本身发生变化，否则 orchestrator 不得丢弃先前证据并重新启动一个新的泛化任务。

## 重复项处理

不要自动删除重复项。根据规范化契约、provider 标识、implementation/package 来源和语义能力家族计算稳定 fingerprint。

将匹配项分类为：

- 完全重复
- 别名
- 兼容变体
- 重叠能力
- 已被取代的候选

Routing 选择一个 canonical candidate，同时保留别名和来源信息。

## UI 契约

界面必须暴露能力状态，而不只是最终文本。后续 observability surface 可以读取相同状态，但本实现只需确保 runtime 发出结构化 status/evidence 事件和富 artifacts。

需要向用户显示的状态：

- 正在准备能力
- 需要批准
- 正在执行
- 已在内部修复/重试
- 已验证
- 已隔离/失败并带具体原因

外部 artifact actions 必须经过 approval bridge 和 executor，否则保持禁用。

## 失败边界

单次系统是有界的。以下情况会停止：

- 没有剩余候选
- 所需批准被拒绝
- 策略禁止该操作
- 某个依赖无法安全获取
- 同一诊断原因的重试预算耗尽
- 结果无法验证

系统必须返回最终诊断原因，并为下一次任务保留证据。

## 测试策略

实现采用 TDD-first。

最低必需测试：

1. 已验证的原生 tool 无需 acquisition 即可执行。
2. 实验性 tool 被丰富、测试、记录证据并晋升。
3. OpenClaw 候选通过生产 broker wiring 获取，并通过 executor 执行。
4. 缺失依赖只获取一次，同一任务无需重新发现即可继续。
5. 批准被拒绝时 fail-closed 停止。
6. 损坏候选被隔离，并尝试下一个已排序候选。
7. 结构化 tool 结果通过 `meta.artifact` 变成富 artifact。
8. Renderer 失败会阻止晋升。
9. 版本变化使先前验证失效。
10. 重复候选被分组，但不会被破坏性删除。
11. 不把任何凭据值复制到 ATLAS/evidence/model-visible metadata。
12. 现有原生 tool/skill 行为保持向后兼容。

## 验收标准

只有当端到端测试在一次任务调用中证明以下路径时，此切片才算完成：

`need -> no verified match -> candidate discovery -> descriptor enrichment -> preparation/acquisition -> approval if required -> execution -> artifact normalization -> evidence -> verified/quarantined state -> final UI-compatible result`

对于 OpenClaw，至少五个代表性家族必须端到端通过：web/search、memory、channel/integration、device/computer-use 和 provider。

任何能力都不能仅因存在于目录中就被报告为“available”。PHOENIX 必须区分 `cataloged`、`prepared`、`executable`、`verified` 和 `UI-capable` 状态。

## 实现顺序

保持为一个架构功能，但以窄小、可测试的提交落地：

1. 编排测试和类型化诊断
2. descriptor enrichment
3. OpenClaw installer/broker/executor 生产 wiring
4. result normalizer + artifact bridge
5. evidence promotion/quarantine loop
6. duplicate fingerprinting 和 learned usage recipe
7. 端到端矩阵和 regression gates

在验收标准通过前不要添加无关功能。
