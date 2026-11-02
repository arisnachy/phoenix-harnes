# PHOENIX 技术报告

[English](README.md) | 中文

此目录包含可重新生成的 HTML 源文件和 PDF，报告名称为“PHOENIX——使用、架构与操作控制”。该文档面向技术读者，描述 2026 年 8 月 28 日检查的 checkout。

## 重新生成

从仓库根目录执行：

```powershell
node reports/phoenix-technical-report/render-report.mjs
node reports/phoenix-technical-report/verify-report.mjs
```

源文件为 `report.html`，输出为 `phoenix-technical-report.pdf`。渲染使用 Playwright，不需要凭据或 Gmail 连接。

## 证据

报告中的断言会与 `README.md`、`docs/architecture.md`、`docs/development.md`、`docs/phoenix-windows.md`、`SECURITY.md`、`AGENTS.md` 和 `package.json` 对照。报告区分已记录的能力、受条件限制的能力和开发状态；它不替代产品规范文档。
