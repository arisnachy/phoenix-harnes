# Agent Note：接管先前的 Windows Phoenix Host

Status: implemented

[English](2026-10-18-phoenix-previous-host-takeover.md) | 中文

## Problem

以前的启动流程无法停止由独立的 `phoenix-runtime-*` 目录或同一个官方检出目录监管的现有 Host，因为旧的交接实现要求存在另一个较旧的官方 Git 检出目录。

## Decision

更新后的启动程序可识别持久根目录以及由检出目录 Git common-dir 哈希派生的运行时命名空间。它保留对所有者、命令行、TCP 监听器、监管进程和 PID 创建时间的检查。在退出既有 Host 前，会先关闭已确认属于该 Host 的已安装 Phoenix.exe 外壳。其他应用程序仍保有自己的端口。

## Consequences

Host 接管仍受到所有者、命令行和 PID 检查的限制。

## Alternatives considered

拒绝停止占用 Phoenix 端口的任意应用程序，因为不能夺取其他应用程序的监听端口。
