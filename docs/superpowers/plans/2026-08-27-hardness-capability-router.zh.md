# HARDNESS 声明式能力路由器实现计划

[English](2026-08-27-hardness-capability-router.md) | 中文

**目标：** 增加 provider-neutral router，在不执行 tools 或授予权限的前提下选择已验证 capability 与 modality。

**架构：** router 委托 HARDNESS resolver，按 modality 偏好确定性选择，并返回 `route`、`missing` 或 `unknown`。

**技术栈：** TypeScript、Cordis、Vitest、oxlint。

---

### Task 1：加入 modality contract

**文件：**
- 修改：`packages/hardness/hardness/src/types.ts`
- 测试：`packages/hardness/hardness/tests/router.spec.ts`

- [ ] **步骤 1：编写失败测试**

覆盖 visual route、workspace mismatch、unknown need，并确认结果没有执行回调。

```ts
expect(result).toMatchObject({ kind: 'route', route: { modality: 'visual', capability: { id } } })
expect(result.kind).toBe('missing')
expect(result.kind).toBe('unknown')
expect('execute' in result).toBe(false)
```

- [ ] **步骤 2：运行测试确认失败**

运行 `pnpm exec vitest run packages/hardness/hardness/tests/router.spec.ts`。

- [ ] **步骤 3：定义公开 route 类型并更新 fixtures**

显式加入 `modalities`、`CapabilityRoute`、`CapabilityRouteResult` 和 `CapabilityRouteOptions`。

- [ ] **步骤 4：运行类型与测试并提交**

补充类型检查。

- [ ] **步骤 5：记录 contract 变化**

保持公开类型稳定。

- [ ] **步骤 6：完成 Task 1 提交**

保留可回滚的提交。

```ts
type CapabilityRouteResult =
  | { readonly kind: 'route'; readonly route: CapabilityRoute }
  | { readonly kind: 'missing'; readonly considered: readonly string[]; readonly reasons: readonly string[] }
  | { readonly kind: 'unknown'; readonly considered: readonly string[]; readonly reasons: readonly string[] }
```

```sh
git add packages/hardness/hardness/src/types.ts packages/hardness/hardness/tests
 git commit -m "feat: add HARDNESS capability modality contracts"
```

### Task 2：实现确定性的声明式 routing

**文件：**
- 创建：`packages/hardness/hardness/src/capability-router.ts`
- 修改：`packages/hardness/hardness/src/index.ts`
- 测试：`packages/hardness/hardness/tests/router.spec.ts`

- [ ] **步骤 1：加入 preference 与 mismatch 测试**

验证 modality 偏好与 mismatch。

- [ ] **步骤 2：运行 router 测试确认失败**

确认未实现时测试失败。

- [ ] **步骤 3：实现 `routeCapabilityNeed`**

委托现有 resolver。

- [ ] **步骤 4：通过 HARDNESS 暴露 router**

保留服务 disposal。

- [ ] **步骤 5：运行 suite 与 lint**

确认测试与 lint 通过。

- [ ] **步骤 6：提交 routing**

```sh
git add packages/hardness/hardness/src packages/hardness/hardness/tests
 git commit -m "feat: route HARDNESS needs by capability modality"
```

### Task 3：验证真实 composition 与 adapter metadata

**文件：**
- 修改：`packages/hardness/adapters/src/tool-adapter.ts`
- 修改：`packages/hardness/adapters/src/skill-adapter.ts`
- 测试：`packages/hardness/adapters/tests/adapters.spec.ts`
- 修改：`packages/bundle/base/cordis.patch.yml`
- 测试：`packages/bundle/base/tests/base.spec.ts`

- [ ] **步骤 1：验证 adapters 的 native modality**

确认 projections 显式声明 native。

- [ ] **步骤 2：验证 Loader composition 与 disposal**

确认服务可逆卸载。

- [ ] **步骤 3：运行 HARDNESS 与 base tests**

执行 focal suite。

- [ ] **步骤 4：提交 composition verification**

```sh
git add packages/hardness packages/bundle/base/cordis.patch.yml
 git commit -m "test: verify HARDNESS routing in composition"
```

### Task 4：文档与 repository gates

**文件：**
- 修改：`packages/hardness/hardness/README.md`
- 修改：`packages/hardness/hardness/README.zh.md`
- 修改：`docs/architecture.md`
- 修改：`docs/architecture.zh.md`
- 修改：`packages/hardness/hardness/README.i18n.yaml`
- 修改：`docs/event-producer-consumer.md`
- 修改：`docs/event-producer-consumer.i18n.yaml`
- 修改：`tsconfig.host.json`

- [ ] **步骤 1：记录 route semantics**

记录 modality、偏好和权限边界。

- [ ] **步骤 2：重新生成图与 translation records**

更新图文档与 hashes。

- [ ] **步骤 3：运行 Vitest、tsc、oxlint、链接与 budgets**

执行 repository gates。

- [ ] **步骤 4：提交文档**

```sh
pnpm exec vitest run packages/hardness packages/bundle/base/tests/base.spec.ts
pnpm exec tsc -b tsconfig.host.json --pretty false
pnpm exec tsx scripts/run-oxlint.ts packages/hardness packages/bundle/base
git diff --check
pnpm run verify-doc-budgets
pnpm run verify-md-links
```

```sh
git add docs packages/hardness tsconfig.host.json
 git commit -m "docs: document HARDNESS declarative routing"
```

## 自检清单

- unknown 与 missing 保持诚实。
- verified capability 与 modality 选择具有确定性。
- 权限只是声明，现有 registry 仍是执行 authority。
- Cordis composition 与 disposal 有测试覆盖。
- 文档与 repository gates 有明确命令。
- visual execution 与 generative UI 保持独立。
- workspace、acquisition 与自动 promotion 保持后续范围。
