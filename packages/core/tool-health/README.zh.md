# `@phoenix-ai/dsh-tool-health`

[English](README.md) | 中文

PHOENIX Health Engine 的可选规划工具属于现有 PHOENIX Host 内的临床试点。Health 不是独立应用，也不取代 Kira。

## 架构

面向模型的 `tool-health` 包**从不**直接暴露患者病历或凭据。`health_interview_plan` 产生通用问诊提示；`health_copilot_ask` 使用**现有 PHOENIX ASK 提供者**提出敏感问题，不接受自动答案，用于协调专业人员和 Kira；`health_kira_mail_requirements` 说明默认拒绝的发件人检查。ASK 既不是病历，也不是经核实的患者观察资料。

独立的可选 Web 临床页面在 `packages/bundle/web-app` 内通过 `/health` 运行，具有加密且持久的 SQLite 病历存储和本地员工身份验证。系统根据角色、机构及明确的诊疗团队分配检查临床访问，并审计授权与撤销。患者联系同意包含核验证据及可审计撤销。记录具有版本保护、专业人员复核与签署、检查申请、库存事务和内部账单。管理员可以创建在线 SQLite 备份并检查其完整性。

包中的独立 `ClinicSandbox` 领域模型只用于确定性的合成工作流测试，**并非**生产病历存储。

## Model Experience

### 临床问诊规划

#### 模型能看到什么

模型只能看到传给 `health_interview_plan` 的通用主诉、专业、模式与**问题键名**。患者姓名、身份标识、临床叙述、影像、诊断和病历不会自动传给模型。ASK 工具只接收通用路径与问题键名，从不读取或更新患者病历，也不返回临床证言。专业人员须在经过验证的临床工作区记录真实答案。通过 `health_kira_mail_requirements` 模型还只能看到必要的邮件检查清单，而非授权检查结果或实际邮件。专业人员在 Health 工作区独立打开受保护记录。

#### Token effect

只有检测到医疗意图时才添加系统提示指导。数据库读取和确定性的临床工作流不需要调用 LLM。

#### KV Cache effect

稳定的工具 schema 与有限的按需指导可避免把患者会话数据写入全局模型指令，从而保留可复用的系统提示前缀。

## Known Limitations and Deferred Work

- **尚未获得临床生产认证或批准。** 操作说明位于 `packages/bundle/web-app/HEALTH-OPERATOR.md`。
- 临床存储加密了病历内容，**并未加密整个 SQLite 文件或工作人员/机构元数据**；仍需 Host 文件系统权限、经验证的备份和安全审查。
- 仅对本地绑定地址开放。医院外部集成、FHIR、DICOM/PACS、LIS/RIS、医疗设备、患者门户、验证后的专业资质与合法数字签名尚未实现。
- ASK 与普通 PHOENIX 对话共享。专业人员不可在 ASK 中输入患者个人信息；适配器仅处理去标识化的工作流选择，真实临床回答需录入受保护的 Health UI。
- Kira 无法自主读取受保护的病历；仍需构建和验证具备同意、角色控制且由人管理的安全上下文代理。
- 电话和邮件确认由已验证的工作人员声明并关联证据编号，**尚未**通过独立验证服务核实。
- Gmail 仅发送经人工授权、无临床内容的预约提醒，并要求提供者真实资料与配置的 Kira 发件地址相符；不发送患者文档或医疗详情。
- 已实现本地 SQLite 备份和恢复测试；异地恢复、数据保留、密钥恢复、外部审计、威胁评估和端到端临床验证仍待完成。
