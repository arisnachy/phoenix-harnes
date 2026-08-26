# 免费网页搜索回退 — Implementation Plan

[English](2026-08-26-web-search-free-fallback.md) | 中文

> **面向智能体工作者：** 必须使用相应的子技能：推荐 superpowers:subagent-driven-development，或使用 superpowers:executing-plans，按任务逐项执行本计划。步骤使用复选框（`- [ ]`）语法跟踪。

**Goal:** 当主要网页提供商因额度、配额或可用性失败时，让 PHOENIX 继续通过 Chrome/Bing/DuckDuckGo 进行研究。

**Architecture:** 保持 `ctx.web` 负责选择，并增加显式回退策略，为浏览器和免费 HTTP 使用独立提供商。在 web 层分类可恢复错误，保留规范化词汇，并避免任何秘密进入错误或追踪。

**Tech Stack:** TypeScript ESM、Cordis、Vitest、专用 Playwright/Chrome、fetch 和 HTML fixture。

---

### Task 1: 捕获回退选择中的回归

**Files:**
- Modify: `packages/web/web/tests/web.spec.ts`
- Modify: `packages/web/web/src/index.ts`

- [ ] **Step 1: Write the failing tests**

添加测试，确保主要提供商以可恢复错误拒绝时，回退提供商可以响应，而取消和配置错误不会被隐藏。

- [ ] **Step 2: Run focused tests**

Run: `pnpm exec vitest run packages/web/web/tests/web.spec.ts`
Expected: FAIL，因为 `ctx.web.search()` 当前只执行被选中的提供商。

- [ ] **Step 3: Implement minimal policy seam**

增加回退注册/配置以及可恢复错误分类，但暂不改变具体提供商。选择必须保留已配置提供商的优先级，并对尝试去重。

- [ ] **Step 4: Run focused tests**

Run: `pnpm exec vitest run packages/web/web/tests/web.spec.ts`
Expected: PASS。

### Task 2: 创建专用浏览器提供商

**Files:**
- Create: `packages/web/web-search-browser/package.json`
- Create: `packages/web/web-search-browser/src/types.ts`
- Create: `packages/web/web-search-browser/src/provider.ts`
- Create: `packages/web/web-search-browser/src/index.ts`
- Create: `packages/web/web-search-browser/tests/browser.spec.ts`
- Create: `packages/web/web-search-browser/tests/browser.e2e.ts`

- [ ] **Step 1: Write fixture-based failing tests**

使用可注入 driver 覆盖结果提取、去重、限制、超时、上下文关闭以及 Chrome 缺失的情况。

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec vitest run packages/web/web-search-browser/tests/browser.spec.ts`
Expected: FAIL because the package and provider do not exist.

- [ ] **Step 3: Implement the provider**

使用小型 driver 接口隔离 Playwright，打开带可配置专用配置文件的持久上下文，按顺序访问 Bing 和 DuckDuckGo，只提取 URL/标题/snippet，应用 `maxResults`，在 `finally` 中关闭资源，并在运行时无法启动时返回 `available() === false`。

- [ ] **Step 4: Run focused tests**

Run: `pnpm exec vitest run packages/web/web-search-browser/tests/browser.spec.ts`
Expected: PASS。

- [ ] **Step 5: Run browser smoke when available**

Run: `pnpm exec vitest run packages/web/web-search-browser/tests/browser.e2e.ts`
Expected: 安装 Chrome 时 PASS；否则以明确原因 skip。

### Task 3: 增加免费 HTTP 备用路线

**Files:**
- Create: `packages/web/web-search-free/src/provider.ts`
- Create: `packages/web/web-search-free/src/index.ts`
- Create: `packages/web/web-search-free/tests/free-search.spec.ts`
- Modify: `packages/web/web/README.md`

- [ ] **Step 1: Write failing parser/provider tests**

测试 Bing fixture、DuckDuckGo fixture、安全重定向、无结果 HTML、反机器人页面和去重。

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run packages/web/web-search-free/tests/free-search.spec.ts`
Expected: FAIL because the package does not exist.

- [ ] **Step 3: Implement HTTP fallback**

使用带超时和 `AbortSignal` 的 `fetch`、搜索引擎 allowlist、受限 HTML 解析和绝对 URL；不跟随嵌入凭据，并在搜索引擎阻止请求或没有结果时分类为可恢复的 `WebError`。

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec vitest run packages/web/web-search-free/tests/free-search.spec.ts`
Expected: PASS。

### Task 4: 在官方组合中挂载回退链

**Files:**
- Modify: `packages/bundle/base/cordis.patch.yml`
- Modify: `packages/web/tool-web/src/search.ts`
- Modify: relevant generated catalogs
- Modify: `packages/web/web-search-free/tests/free-search.spec.ts`

- [ ] **Step 1: Add loader regression test**

使用失败的付费提供商和确定性的浏览器/免费提供商启动真实 base composition；断言最终结果以及不敏感的 attempted-provider 元数据。

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run packages/web/web-search-free/tests/free-search.spec.ts packages/web/web/tests/web.spec.ts`
Expected: 回退链接线后 PASS。

- [ ] **Step 3: Wire providers and bounded prompt guidance**

仅在配置回退或主要提供商以可恢复代码失败时启用回退。保持提供商选择显式，不增加大段 prompt 文本；工具应在结果元数据中报告所使用的路线。

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec vitest run packages/web/web-search-free/tests/free-search.spec.ts packages/web/web/tests/web.spec.ts`
Expected: PASS。

### Task 5: 验证完整质量与晋升边界

**Files:**
- Modify: `docs/architecture.md` if the provider-selection contract changes
- Create: `.agents/notes/implemented/architecture/YYYY-MM-DD-web-search-free-fallback.md`

- [ ] **Step 1: Run focused web suites**

Run: `pnpm exec vitest run packages/web packages/bundle/base`
Expected: PASS，仅允许因缺少 Chrome/真实网络而明确 skip。

- [ ] **Step 2: Run static and artifact checks**

Run: `pnpm run typecheck`, `pnpm run build`, `pnpm run verify-cordis-config`, `pnpm run verify-tool-catalog`, `pnpm run verify-config-catalog`
Expected: PASS；生成的 catalogs 必须更新，而不是被排除。

- [ ] **Step 3: Run browser/live verification**

针对 Bing 和 DuckDuckGo 运行专用 Chrome smoke，捕获规范化源输出，确认没有秘密，并记录精确提供商路线。

- [ ] **Step 4: Commit on `main`**

```sh
git add packages/web packages/bundle/base docs .agents/notes
git commit -m "feat(web): fall back to free browser search"
```

- [ ] **Step 5: Promote to `stable` only after all gates pass**

从已验证的 `main` commit 创建/更新 `stable`；只有在回读确认预期 commit 后才推送两者，然后使用现有更新路径刷新 PHOENIX。绝不 force-push，也绝不晋升失败的 commit。
