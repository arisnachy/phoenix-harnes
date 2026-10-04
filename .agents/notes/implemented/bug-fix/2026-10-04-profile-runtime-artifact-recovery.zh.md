# Agent Note: 资料运行时产物恢复

Status: implemented

## Problem

Windows supervisor 已经能够检测共享资料 fallback 中缺失的编译模块，也知道如何执行完整 Phoenix 重建，但旧逻辑在开始修复前先信任 `web --dump-config` 预检。该预检可能在没有导入所有已配置插件时成功，因此像 `@phoenix-ai/dsh-tool-google-workspace` 这样的包可能拥有有效的 package manifest，却缺少编译后的 `lib/index.js`。真正的 Host 随后以 `ERR_MODULE_NOT_FOUND` 失败，而 supervisor 会继续重启 Host，updater 也会反复准备同一个 stable 版本。

## Decision

当 profile fallback 链接指向的包 manifest 存在，但 manifest 声明的 `main` 产物缺失时，这本身就是本地安装不完整的权威证据。Windows supervisor 即使看到 `--dump-config` 成功，也会执行一次完整的 `scripts/build.ts` 修复。重建后会同时再次验证 profile fallback 与 boot preflight；如果仍有链接包缺少声明的 main 产物，恢复会关闭并停止重启，而不是再次进入循环。对于 package manifest 已不存在的悬空链接则继续忽略，因为 profile fallback 本来就允许当前安装已移除包留下的旧链接。

同一规则同时用于 supervisor 初始启动和 Host 意外退出后的恢复。崩溃路径把直接 fallback 检查与既有错误文本检测结合起来，因此即使最初的 profile 扫描没有观察到问题，真实的 `/profiles/node_modules/.../lib/...` 导入失败仍会触发修复。

## Alternatives considered

**只信任 `web --dump-config` 作为恢复门槛。** 这样更便宜，但它不能保证每个 loader entry 都已导入，这正是重启循环能够发生的条件。

**只重建 `build:lib:host`。** 当前问题是运行时产物缺失，而未来同类事故也可能涉及浏览器或生成产物；updater 修复现在使用与正常可运行 Phoenix checkout 相同的完整构建路径。

**删除整个 profile fallback 后重新创建。** 缺失的是链接目标安装包里的产物，而不是链接本身；重新创建链接仍会指向同一个不完整包，还会扰动系统刻意允许保留的旧悬空链接。

## Consequences

新加入的内置包不会再因为 live checkout 缺少被忽略的编译输出，而把 Phoenix 困在 Host 重启循环中。真正触发修复时成本会稍高，因为执行的是完整构建，但它只会在存在明确缺失产物证据时运行，并且在重新启动前会确认该问题已经消失。
