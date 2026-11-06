# `@phoenix-ai/dsh-tool-healthia`

[English](README.md) | 中文

按需启用的 HealthIA 患者范围工具。PHOENIX 仅保留一个小型全局激活工具；只有用户明确要求个人健康照护或患者记录操作时，才应挂载临床工具集。模拟病例、文献综述、学术临床报告和一般医学问题使用研究工具，不打开患者记录。

作用域内的基础工具包括患者档案发现/创建/更新、有界纵向快照、带来源信息的健康事实、患者记录查询和临床事件。聊天中的患者档案与专业 /health 签署病历相互独立。

## Native HealthIA chat cards

成功执行 `healthia_activate` 仅改变可用能力，不读取患者身份，也不渲染患者卡片。`health_patient_list` 的结果仅用于后台元数据查询，同样不生成界面。

只有在用户要求浏览、打开、创建或管理患者档案后，显式 `health_patient_workspace` 工具才会显示患者选择和新建演示档案界面。经过验证的 `health_patient_create` 回执可以展示创建确认；`health_patient_snapshot` 可以展示有界患者摘要。外部、无效或失败的回执无法触发界面。任何表单都不能在缺乏第一方创建操作成功回执时声称已保存患者。

## Model Experience

### Global HealthIA activation

#### What the model sees

全局 `healthia_activate` 工具只用于个人患者照护、纵向随访或明确的患者记录管理。学术综述、模拟临床病例、医学测验和指南研究不能触发激活。

#### Token effect

患者记录流程以外只保留固定且较小的工具模式。

#### KV Cache effect

在符合条件的患者流程激活 HealthIA 前，提示前缀保持稳定。

### Activated clinical scope

#### What the model sees

患者记录工具包括只读 `health_patient_list`、显式显示界面的 `health_patient_workspace`，以及患者创建/更新/快照、记录和临床事件。激活工具不返回患者列表。父级和同级智能体不会自动继承这些工具。

#### Token effect

临床模式和指导仅在已激活的智能体作用域内启用。

#### KV Cache effect

激活会有意改变所选智能体的工具前缀；无关工作保留一般配置。

## Known Limitations and Deferred Work

- **由模型选择激活** — 基础系统仍依赖于选择正确的工具；即使在研究时错误调用激活工具，独立的患者工作区也能阻止自动出现入院登记界面。
- **仅有基础工具** — 专科用药、证据、影像、设备、预防及临床审查能力仍需要后续集成。
- **无处方权限** — 工具不能自行修改药物治疗或确定最终诊断。
