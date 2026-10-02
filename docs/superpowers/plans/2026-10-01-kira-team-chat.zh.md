# Kira 团队聊天实施计划

[English](2026-10-01-kira-team-chat.md) | 中文

> 对代理工作者：必须使用 superpowers:executing-plans 按任务实施；使用复选框跟踪步骤。

**目标：** 恢复可见的真实团队工作与用户、代理的表情参与。

**架构：** 扩展现有 Agent Teams 服务，加入仅用于聊天的捕获、规范目标和幂等反应；扩展现有会话渲染器和类型化消息操作槽。保留调度与部署成员限额。

**技术：** Cordis、TypeScript、Typert remotes、会话投影、React、emoji-picker-react、emoji-regex。

**设计：** [Kira 团队会话](../specs/2026-10-01-kira-team-chat-design.zh.md)。

## 全局约束

捕获和反应不额外调用 LLM；公开聊天不显示推理或工具内容。默认两名专家，Kira 仅按实际工作需要选择成员。所有交互在现有主聊天及输入框中。用户回复使用父代理授权的 continuation。保留固定 pnpm 和普通 Git hooks。

## 审核重点

确保 fork seed 不重复、跨团队目标不可达、多码点表情合法、反应重试与移除正确，以及卸载插件的回调不会继续执行。

### 任务 1：持久会话

文件：agent-team/src/chat-types.ts、chat.ts、chat-projection.ts、index.ts；agent-team/tests/team.spec.ts。

接口：chatMessages 读取规范消息；chatReact 提交人类反应；chatReply 按 requestId 和目标接纳 continuation；reactToChat 使用真实在线代理权限。

- [x] 添加捕获、表情切换、权限及零 LLM 调用的失败测试。
- [x] 运行聚焦测试并确认失败。
- [x] 实施来源后缀捕获、受限读取与回复、remote 操作和投影。
- [x] 运行所属包及持久化测试。

### 任务 2：浏览器参与

文件：ui-kira-teams 的 TeamChatMessage.tsx、TeamMessageActions.tsx、index.ts；ui-conversation 的 kira-team-message.ts、slots.ts、ChatNodeSeat.tsx、apply.ts。

接口：会话范围的反应、回复回调和 teamChatReactions 投影；消息操作槽接收规范消息与作者身份。

- [x] 添加投影及点击、回复失败测试。
- [x] 实施稳定头像、完整表情选择器、反应移除与定向回复。
- [x] 验证普通消息和团队回复，包括重连与重载。

### 任务 3：模型及真实装配验证

文件：tool-agent-team/src/index.ts、相关 README、Agent Note、生成器和真实浏览器场景。

- [x] 添加受限聊天读取和 Unicode 反应工具及简洁协作指导。
- [x] 验证真实装配、浏览器交互，以及反应不增加模型调用。
- [ ] 完成相关测试、类型检查、构建、文档和独立审核。
- [ ] 发布补丁，仅在检查通过后集成 main，并核验 stable 晋升。

### 用户规格扩展验收

- [x] Kira 与两名成员真实对话，用户在主输入框介入。
- [x] 一人或多人提及路由，只有一条人类消息，保留引用上下文及 Kira 监督。
- [x] 重载及历史中的名称、头像和角色稳定，不随模型变化。
- [x] 持久逐目标回执与幂等重试，重连不重复消息或反应。
- [x] 侧边头像高亮同一聊天中的发言，不打开另一个聊天。
- [x] 所有人消息可接收 Unicode 反应，支持分组、身份和移除，不调用 LLM。
- [ ] 保持 Phoenix Auto、轨迹、模型控件、输入可用性、响应式布局和成本限额。
- [ ] 核验所选 Codex 模型领导、Luna Max 执行，以及其他提供方继承所选模型。
- [ ] 失败创建保留证据，但释放容量。
