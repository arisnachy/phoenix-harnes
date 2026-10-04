# Agent Note: DSH 资料运行时构建完整性

Status: implemented

## Problem

本地 DSH profile fallback 能正确把 `@phoenix-ai/dsh-tool-google-workspace` 链接到 Phoenix 安装目录，但完整 Host 构建会更早因为 JavaScript-only 的 `phoenix-git-safe-directory.mjs` 缺少 TypeScript 声明而以 TS7016 停止。因此该包的 `lib/index.js` 从未生成，`.dsh/profiles/node_modules` 中的 junction 虽然指向真实包目录，却缺少 manifest 声明的运行时入口，最终在 Loader 启动时持续触发 `ERR_MODULE_NOT_FOUND`。

## Decision

为共享 Git safe-directory helper 提供明确的 `.d.mts` 类型声明，使 Host TypeScript 构建可以继续完成。完整构建现在还会验证 profile 关键包的编译 main 产物，包括 Authorization、MCP client、MCP registry、Google Workspace tool 和 Host plugin inventory；任一缺失都会让构建直接失败。

## Consequences

现在只有当 `.dsh/profiles/node_modules` 的轻量 junction farm 实际指向可运行的已编译包时，完整构建才会成功。缺失的 profile 运行时产物会在准备/构建阶段被阻断，而不会延迟到 Host 启动后形成重启循环。
