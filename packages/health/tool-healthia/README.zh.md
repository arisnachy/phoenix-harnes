# `@phoenix-ai/dsh-tool-healthia`

[English](README.md) | 中文

按需启用的 HealthIA 模型侧表面。

PHOENIX 全局只保留一个很小的 `healthia_activate` 工具。当当前请求确实与健康相关时，该工具会把更丰富的临床工具集以及安全/连续性指导挂载到调用 agent 的 scope。其他对话继续使用普通工具目录，不承担完整 HealthIA surface 的 token 成本。

基础 scope 工具包括：

- 患者档案发现/创建/更新；
- 有界纵向 snapshot；
- 带 provenance 的健康事实；
- 患者范围的记录查询；
- 打开/更新临床 episode。

临床 prompt 明确要求患者隔离、自适应问诊、优先识别 red flag、区分事实/推断/证据、进行纵向比较，并且在涉及处方/诊断的敏感决定中保留人类权限。它还要求 HealthIA 在适合时使用 PHOENIX 其余能力——证据搜索、多模态分析、地图、调度、browser/computer、connector 和 Tool Forge。

## Model Experience

### Global HealthIA activation

#### What the model sees

模型全局只看到一个名为 `healthia_activate` 的 tool schema。它的描述要求模型在对症状、药物、实验室、医学图像/文档、生命体征、预防、特定疾病生活方式、设备、照护导航和纵向随访进行实质性推理之前激活 HealthIA。

#### Token effect

在非健康对话中成本固定且很小：只有 activator schema。

#### KV Cache effect

HealthIA 激活前前缀保持稳定。激活后，当前 agent 后续步骤的工具集合会发生有意改变。

### Activated clinical scope

#### What the model sees

激活后，调用 agent 会获得 HealthIA 临床指导以及上面记录的 patient/record/episode 工具。parent/sibling agent 不会自动收到这些 scope registration。

#### Token effect

成本是条件性的。只有健康上下文激活之后，更大的 health schema 和指导才会出现。

#### KV Cache effect

激活会有意改变该 agent 的请求前缀，因为它的能力集合已经改变。非健康 agent 保持原有前缀。

## Known Limitations and Deferred Work

- **基础阶段由模型选择激活** — activator 明确且成本很低。后续 Health Context Resolver 可以为模糊案例增加 deterministic/auxiliary routing，而不用改变 scope 内的临床工具集。
- **目前是基础工具，不是完整 HealthIA 专科** — 专用 medication、evidence、imaging、device/FHIR、prevention、risk、community、benefits、appointment 和 clinical-judge package 仍将在同一患者记录之上逐层加入。
- **没有处方权限** — 这些工具记录和检索证据；它们不会授予自主更改药物或作出确定性诊断的权限。
