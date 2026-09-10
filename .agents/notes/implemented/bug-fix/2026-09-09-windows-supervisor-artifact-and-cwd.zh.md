# Agent Note: Windows supervisor preserves artifact and launch directory

Status: implemented

[English](2026-09-09-windows-supervisor-artifact-and-cwd.md) | 中文

## Problem

Windows update supervisor 总是从 TypeScript source 重启 Web Host，并把 working directory 改为 repository root。从 project directory 启动 built CLI 的用户可能会在更新后重启到不同 artifact，并丢失 project-relative configuration。

## Decision

CLI 在进入 supervisor 前记录当前 entry 是 `src` 还是 built `lib`，并记录 absolute launch directory。Supervisor 验证这两个值，重启相同 artifact，并为 child Host 保留 launch directory。缺失 entry、relative directory 与未知 artifact value 会在启动不匹配 process 前失败。

Browser-open tests 通过 `NODE_OPTIONS` 传递 loader hook，因此 Windows supervisor 启动真实 child process 时 hook 仍然有效。Tests 也禁用 automatic updates，以隔离 browser-open behavior。

## Alternatives considered

**始终从 source 重启：**拒绝，因为 installed builds 可能不包含 source，并且会改变用户选择的 artifact。

**始终从 repository root 重启：**拒绝，因为 project-relative configuration 属于原始 launch directory。

## Verification

CLI build 通过。Focused supervisor suite 通过 4 个 tests，assembled browser-open snapshot 也通过 4 个 tests，覆盖 local launch、browser failure、SSH suppression 与 project-relative browser configuration。

## Consequences

Source development 保持 source-based，installed builds 保持 built，update restart 保留用户选择的目录。Update supervisor 不再改变当前 PHOENIX runtime artifact 或 project configuration。
