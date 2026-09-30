# `@phoenix-ai/dsh-healthia`

[English](README.md) | 中文

PHOENIX 的 provider-neutral 纵向健康能力 seam。

HealthIA 是附加能力：它不会替换 PHOENIX、不会改变 Web 布局、不会绑定模型 provider，也不会把对话历史当作病历。它暴露 `ctx.healthia`；provider 负责持久化存储，而 consumer 在同一个 seam 之上增加临床推理、设备、证据、社区、预约以及其他健康能力。

## Core contract

第一层有意只保存三个小而稳定的原语：

- 相互隔离的患者档案；
- 带 provenance 的规范化健康记录；
- 纵向临床 episode。

每条记录都携带 `patientId` 和 provenance。consumer 绝不能把模型假设持久化成患者事实。`snapshot()` 返回用于推理的有界视图；该视图从规范状态重建，而不是从聊天历史重建。

只有在 provider 已提交相应变更之后，service 才会发出 `healthia/patient`、`healthia/record` 和 `healthia/episode`。

## Model Experience

### Longitudinal health service

#### What the model sees

`ctx.healthia` 本身不会加入 prompt、tool schema 或患者数据；模型侧 consumer 决定哪些有界患者投影进入一次请求。

#### Token effect

仅此 service definition 不增加模型 token。HealthIA consumer 只为它们明确投影的临床上下文付出 token 成本。

#### KV Cache effect

该 seam 本身不改变前缀。只有模型侧 HealthIA consumer 挂载 prompt 内容或患者范围工具时，缓存行为才会改变。

## Known Limitations and Deferred Work

- **目前只是基础 schema** — FHIR/DICOM 投影、设备摄取、药物/证据引擎、预防照护规则、社区导航、福利、预约、临床 judge 以及 HealthIA ONE mission adapter 都将在这个规范患者边界之上继续构建。
- **没有自主诊断或处方权限** — 后续 clinical reasoner 可以协助鉴别推理和证据审查，但涉及诊断/治疗变更的敏感决定仍保留明确的人类/临床权限以及急症升级路径。
