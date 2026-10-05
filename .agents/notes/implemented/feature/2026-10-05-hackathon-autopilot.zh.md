# Agent Note：Hackathon Autopilot 连接器任务

Status: implemented

[English](2026-10-05-hackathon-autopilot.md) | 中文

## 问题

PHOENIX 已经在设置中暴露官方 Devpost Hackathons MCP，也允许模型安装注册表中的 MCP，但两条路径并不对称：Kira 能发现缺少 Devpost 能力，却不能自行激活 Host 固定的 Devpost 连接器。Hackathon 工作也缺少一个随产品发布的统一流程，把官方赛事数据、代码、部署、演示媒体、评审证据和已验证提交串成一个任务。

## 决策

模型侧 `connector_install` 现在只接受两类受信目标，并且必须二选一：Official MCP Registry 的精确 `name`，或者内置的 `connectorId=devpost`。Devpost 路径仍经过规范的一次性批准，并且只调用 `pluginInventory.installCuratedMcpConnector`；模型不能提供端点或可执行来源。注册表安装行为保持不变。

standard 与 Code Mode 预设都随附 `hackathon-autopilot`。该技能在使用前验证连接器，需要时激活固定的 Devpost MCP，以 Devpost 实时数据作为规则和评审标准的权威来源，建立证据矩阵，在制作媒体前要求经过测试的候选版本，生成面向评委的演示方案和自然英语旁白，并且对具有合同意义的注册和最终 Devpost 提交要求明确的人类确认。GitHub、部署、Canva、HeyGen、分析和可观测性只是能力路径，不是强制依赖；当付费或高级连接器不可用时，本地构建和媒体回退仍可完成任务。

设置侧导出 `hackathon` 连接器预设，让产品界面能够表达推荐工具包，同时不会把任何外部账户误报为已连接。

## 备选方案

**要求用户打开设置页面激活 Devpost。** 拒绝，因为任务本身已经具备受治理的模型侧连接器安装器，强制切换 UI 会破坏自主恢复。

**把 Devpost 当作普通注册表安装。** 拒绝，因为 Phoenix 已经拥有固定的官方端点；额外注册表查询只会增加可用性和来源不确定性，而不会提高信任。

**强制依赖 HeyGen 或 Canva。** 拒绝，因为媒体服务可能不可用、收费或不适合某个赛事。任务真正要求的是可验证的演示证据和高质量旁白，而不是特定供应商。

## 结果

全新的 hackathon 任务可以在聊天中经过明确批准准备 Devpost 路径，并在调用赛事工具前验证其就绪状态。任意 MCP 代码和具有后果的 Devpost 写操作仍然保持 fail-closed。standard 和 Code Mode 会共享一套可复用的端到端竞赛流程，连接器目录也能清楚表达可选的支持服务。
