# Sidebar PHOENIX Wordmark 实施计划

[English](2026-03-10-sidebar-phoenix-wordmark-implementation.md) | 中文

> **对于代理执行者：** 使用 `superpowers:executing-plans` 按任务执行本计划。每一步使用复选框跟踪。

### 任务 1：添加侧栏样式聚焦测试

**文件：**
- 修改：`packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx`

- [ ] 在展开的 wordmark 测试中验证 `brandName` CSS 类和字体属性。

```ts
const brandName = screen.getByText('PHOENIX', { exact: true })
expect(brandName).toHaveClass(styles.brandName)
expect(brandName).toHaveStyle({
  fontFamily: expect.stringContaining('ui-sans-serif'),
  fontWeight: '650',
  letterSpacing: '-0.03em',
})
```

在已有的侧栏展开 logo 测试中加入这些断言，并保持现有组件行为不变。

- [ ] 运行 `pnpm exec vitest run packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx` 并确认新断言先失败。

### 任务 2：实现紧凑侧栏 wordmark

**文件：**
- 修改：`packages/client/ui-sidebar/src/client/SidebarRoot.module.css:144-154`

- [ ] 只更新 `.brandName` 的 sans-serif、字号、字重和字间距，保留现有布局。

```css
.brandName {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: 34px;
  color: var(--dsw-alias-label-primary);
  font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 19px;
  font-weight: 650;
  line-height: 24px;
  letter-spacing: -0.03em;
  white-space: nowrap;
}
```

- [ ] 运行侧栏聚焦测试并确认通过。

确认 CSS 修改不会影响 fallback、hero 或按钮行为。

- [ ] 运行 `pnpm run verify-phoenix-branding` 并确认品牌资源没有变化。

### 任务 3：构建并验证渲染界面

**文件：**
- 验证：`packages/client/ui-sidebar/src/client/SidebarRoot.module.css`
- 验证：`packages/client/ui-brand-official/src/client/Brand.tsx`

- [ ] 构建 web artifacts。

运行：`pnpm run build:web`

预期：`@phoenix-ai/dsh-web-frontend` 构建成功。

- [ ] 在承诺 HMR 前确认现有 web watcher 正在运行。

运行：`Get-Process node -ErrorAction SilentlyContinue | Select-Object -First 20 Id,ProcessName`

预期：如果 watcher 正在运行，识别对应进程；如果没有运行，则在 build 后重新加载 URL，并将结果标记为刷新验证而不是 HMR 验证。

- [ ] 在浏览器中验证确切的 `http://127.0.0.1:3080` URL。

确认页面身份、内容非空、没有错误 overlay、没有相关 console error，并确认 logo 按钮行为保持不变。

- [ ] 在桌面和移动 viewport 中确认 wordmark 不会截断或溢出。

确认 hero 的显示保持原样。

- [ ] 保存隔离 commit。

```bash
git add packages/client/ui-sidebar/src/client/SidebarRoot.module.css packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx
git commit -m "fix: refine sidebar Phoenix wordmark"
```
