# OpenAI 编排器与 Luna 执行器试验实施计划

[English](2026-08-27-openai-orquestador-luna-ejecutor.md) | 中文

> **面向 agent worker：** REQUIRED SUB-SKILL：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务执行本计划。步骤使用复选框（`- [ ]`）跟踪。

**目标：**验证并记录一项临时试验：用户选择的 OpenAI 模型保留编排职责，委派任务使用 `openai-codex/gpt-5.6-luna` 和 `reasoningEffort: high` 执行。

**架构：**复用标准 preset 以及 `subagent` 和 `workflow` runtime 中已经存在的条件 `childRoute`。父任务保留其选择；只有当父任务使用 `openai-codex` 时，子任务才切换为 Luna `high`。测量数据来自会话事件/投影和现有的子任务视图。

**技术栈：**TypeScript、YAML、Vitest、pnpm、PHOENIX 会话事件/投影、现有 Web GUI。

---

## 文件地图

- `apps/cli/config/agent-presets/standard/agent.cordis.yml` — 三条委派路径的标准配置；实验路由已经存在，只有在验证发现不一致时才修改。
- `packages/subagent/tool-subagent/tests/tool-subagent.spec.ts` — `subagent` 和 `subagent_fork` 路径测试；扩展为三个根模型。
- `packages/workflow/workflow-worker-thread/tests/workflow-worker-thread.spec.ts` — worker 路径及其限制测试。
- `packages/llm/token-meter/tests/token-usage-projection.spec.ts` — 现有 token 累积合约；用于取证，不重复实现投影器。
- `packages/client/ui-subagent/tests/conversation-ui.client.spec.tsx` — 子任务 token 和持续时间显示合约；用于验证可见测量。
- `docs/superpowers/specs/2026-08-27-openai-orquestador-luna-ejecutor-design.md` — 已批准的范围与验收规范。

## 实施决策

当前路径已经在标准 preset 中实现，并由 `whenProvider: openai-codex` 条件控制。不添加 `whenModel`，因为当前 `tool-subagent` 和 `workflow-worker-thread` 合约只支持按供应商判断。根模型 Sol、Luna 和 Terra 可以共享 Luna 执行路径，同时不改变选择器。

不创建指标页面：`assistant/message` 事件包含 usage，`subagent/start`/`subagent/end` 划定委派范围，GUI 已经显示 token 和持续时间。撤销试验只需从 preset 移除三条 `childRoute`，或回退实验 commit。

---

### 任务 1：测试 `subagent` 中的三个根模型

**文件：**
- 修改：`packages/subagent/tool-subagent/tests/tool-subagent.spec.ts:289-327`

- [ ] **步骤 1：将现有测试转换为根模型表格**

将只使用 `gpt-5.4` 的测试替换为以下参数化测试，并保留已有 helper 和 import：

```ts
it.each(['gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-5.6-terra'])(
  'routes OpenAI root %s children to Luna high without changing a non-OpenAI parent route',
  async (rootModel) => {
    let seen: { agentOptions?: { provider?: string; model?: string; reasoningEffort?: string } } | undefined
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    ctx.subagents.registerProvider({
      name: 'capture-route',
      capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
      inheritsParentContext: false,
      start: async (request) => {
        seen = request
        return {
          id: SessionId('capture-route-child'),
          localAgent: undefined,
          result: Promise.resolve({ output: [{ type: 'text', text: 'ok' }], stopReason: 'completed' as const }),
          dispose: async () => {},
        }
      },
    })
    await ctx.plugin(tool, {
      provider: 'capture-route',
      childRoute: {
        whenProvider: 'openai-codex',
        provider: 'openai-codex',
        model: 'gpt-5.6-luna',
        reasoningEffort: 'high',
      },
      maxDepth: 'provider-managed',
    })

    const openAiParent = { ...fakeAgent(), options: { provider: 'openai-codex', model: rootModel } } as Agent
    await callSubagent(ctx, { description: 'd', prompt: 'p' }, { agent: openAiParent })
    expect(seen?.agentOptions).toEqual({ provider: 'openai-codex', model: 'gpt-5.6-luna', reasoningEffort: 'high' })

    const otherParent = { ...fakeAgent('other-parent'), options: { provider: 'openrouter', model: 'ox-alpha' } } as Agent
    await callSubagent(ctx, { description: 'd', prompt: 'p' }, { agent: otherParent })
    expect(seen?.agentOptions).toBeUndefined()
  },
)
```

- [ ] **步骤 2：运行聚焦测试**

运行：

```text
pnpm exec vitest run packages/subagent/tool-subagent/tests/tool-subagent.spec.ts
```

预期：PASS，包括 `gpt-5.6-sol`、`gpt-5.6-luna` 和 `gpt-5.6-terra` 三种变体，以及非 OpenAI 场景。

- [ ] **步骤 3：检查 diff，避免测试范围外的改动**

运行：

```text
git diff -- packages/subagent/tool-subagent/tests/tool-subagent.spec.ts
```

预期：只包含测试参数化，没有 runtime 改动。

- [ ] **步骤 4：提交回归测试**

```text
git add packages/subagent/tool-subagent/tests/tool-subagent.spec.ts
git commit -m "test: cover OpenAI root models for Luna delegation"
```

---

### 任务 2：确认 workflow 和执行限制

**文件：**
- 修改：`packages/workflow/workflow-worker-thread/tests/workflow-worker-thread.spec.ts:179-203`

- [ ] **步骤 1：将 workflow 测试的 OpenAI 父任务参数化**

使用表格让相同场景覆盖每个根模型，保持每个变体只执行一次，并验证已有限制：

```ts
it.each(['gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-5.6-terra'])(
  'routes OpenAI workflow root %s to Luna high and preserves the cap',
  async (rootModel) => {
    const { ctx, provider } = await setup({
      config: {
        maxConcurrentAgents: 2,
        maxTotalAgents: 2,
        childRoute: {
          whenProvider: 'openai-codex',
          provider: 'openai-codex',
          model: 'gpt-5.6-luna',
          reasoningEffort: 'high',
        },
      },
    })
    const result = await run(
      ctx,
      fakeParent({ provider: 'openai-codex', model: rootModel }),
      scripted("return await agent('review the focused change')"),
    )
    expect(result.stopReason).toBe('completed')
    expect(result.agentsStarted).toBe(1)
    expect(provider.runs[0]?.request.agentOptions).toEqual({
      provider: 'openai-codex',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'high',
    })
  },
)
```

- [ ] **步骤 2：运行 workflow 聚焦测试**

运行：

```text
pnpm exec vitest run packages/workflow/workflow-worker-thread/tests/workflow-worker-thread.spec.ts
```

预期：三个根模型和其余限制/并发测试均 PASS。

- [ ] **步骤 3：提交 workflow 回归测试**

```text
git add packages/workflow/workflow-worker-thread/tests/workflow-worker-thread.spec.ts
git commit -m "test: cover OpenAI workflow roots for Luna delegation"
```

---

### 任务 3：验证现有配置与测量

**文件：**
- 验证：`apps/cli/config/agent-presets/standard/agent.cordis.yml:195-257`
- 验证：`packages/llm/token-meter/tests/token-usage-projection.spec.ts`
- 验证：`packages/client/ui-subagent/tests/conversation-ui.client.spec.tsx`

- [ ] **步骤 1：验证三个 preset 条目完全一致**

确认 `tool-subagent`、`tool-subagent-fork` 和 `workflow-worker-thread` 都精确包含 `whenProvider: openai-codex`、`provider: openai-codex`、`model: gpt-5.6-luna` 和 `reasoningEffort: high`，且不改变其他供应商。

运行：

```text
pnpm run verify-cordis-config
```

预期：PASS。

- [ ] **步骤 2：验证 token 累积且不重复计数**

运行：

```text
pnpm exec vitest run packages/llm/token-meter/tests/token-usage-projection.spec.ts
```

预期：PASS，包括用最终 usage 替换样本，以及累积 `uncachedInputTokens`、`outputTokens`、`cacheReadTokens` 和 `cacheWriteTokens`。

- [ ] **步骤 3：验证子任务的可见 token 和持续时间**

运行：

```text
pnpm exec vitest run packages/client/ui-subagent/tests/conversation-ui.client.spec.tsx
```

预期：PASS，包括持久 token 指标和子任务的活动/冻结持续时间。

- [ ] **步骤 4：记录配置证据但不编辑配置**

运行：

```text
git diff -- apps/cli/config/agent-presets/standard/agent.cordis.yml
```

预期：输出为空；现有路径保持不变，并由测试覆盖。

---

### 任务 4：集成验证与可逆性

**文件：**
- 验证：`apps/cli/config/agent-presets/standard/agent.cordis.yml`
- 验证：`packages/subagent/tool-subagent/tests/tool-subagent.spec.ts`
- 验证：`packages/workflow/workflow-worker-thread/tests/workflow-worker-thread.spec.ts`

- [ ] **步骤 1：运行完整聚焦集合**

运行：

```text
pnpm exec vitest run packages/subagent/tool-subagent/tests/tool-subagent.spec.ts packages/workflow/workflow-worker-thread/tests/workflow-worker-thread.spec.ts packages/llm/token-meter/tests/token-usage-projection.spec.ts packages/client/ui-subagent/tests/conversation-ui.client.spec.tsx
```

预期：PASS，且不修改已有的本地文件。

- [ ] **步骤 2：构建现有 GUI 所需 artifact**

运行：

```text
pnpm run build
```

预期：完整编译无错误。

- [ ] **步骤 3：刷新后验证现有 GUI**

使用现有 GUI `http://127.0.0.1:3080`，刷新页面并确认选择器仍正常显示选项。不要启动替代服务器。如果 `pnpm run dev:web` watcher 已经运行则复用；否则验证限于构建 artifact 和现有 URL 的加载。

预期：界面加载，选择器可用，控制台没有与本试验相关的错误。

- [ ] **步骤 4：确认可逆性并保留无关变更**

运行：

```text
git status --short
git diff --stat HEAD~2..HEAD
```

预期：本任务的唯一 commit 是规范和回归测试；此前本地变更保持未 staged 且未修改。

- [ ] **步骤 5：验证通过后提交最终证据**

```text
git add packages/subagent/tool-subagent/tests/tool-subagent.spec.ts packages/workflow/workflow-worker-thread/tests/workflow-worker-thread.spec.ts
git commit -m "test: verify temporary OpenAI Luna orchestration trial"
```

---

## 计划审查

- **规范覆盖：**保留根模型（任务 1–2）、Luna `high` 子任务（任务 1–2）、选择器不变且非 OpenAI 供应商不重定向（任务 1 和 4）、深度/限制（任务 2 和 4）、token/持续时间/委派（任务 3）、可逆性和本地变更（任务 4）。
- **未完成标记：**没有 `TODO`、`TBD` 或开放指令。
- **一致性：**所有步骤使用 `gpt-5.6-luna`、`reasoningEffort: high`、`openai-codex`、`maxDepth: 1` 以及 workflow 当前的两个 agent 限制。
