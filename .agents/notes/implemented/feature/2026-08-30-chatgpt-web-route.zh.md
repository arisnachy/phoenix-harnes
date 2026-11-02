# Agent Note: ChatGPT Web 桥接路由

Status: implemented

[English](2026-08-30-chatgpt-web-route.md) | 中文

## 问题

PHOENIX 可以连接任意兼容 OpenAI 的网关，但可选的本地 `codex-chatgpt-web` 桥接没有命名路由或诊断。这让配置不明确，也会让不可用的桥接显示为普通的提供方错误。

## 决策

`llm-pi-ai` 现在公开休眠的 `chatgpt-web` 可配置路由。保存配置后，它解析到桥接的 OpenAI Responses 端点（`http://127.0.0.1:17841/v1`），并以桥接支持的模型名作为默认值。用户仍可通过现有设置服务覆盖端点、协议、模型和凭据引用。PHOENIX 不会导入浏览器配置、Cookie、密码或凭据。

只有显式设置 `PHOENIX_CHATGPT_WEB_URL` 时，`dsh doctor` 才会检查桥接。它读取模型列表，只报告有界的健康结果，并且不会打印响应正文或授权数据。

## 后果

模型页面可以显示一项专门的 ChatGPT Web 选项，而未配置的安装仍保持休眠。已配置但不可用的桥接会被诊断为本地依赖问题，不会静默切换到其他提供方。

这是 Phoenix 侧的桥接集成，不是内置的 ChatGPT 登录功能。上游桥接仍负责浏览器认证及其安全模型。

## Alternatives considered

将浏览器登录捆绑到 PHOENIX 会要求 PHOENIX 接管 cookie 和凭据，因此仍由外部桥接负责认证。将桥接当作未命名的自定义 provider 会隐藏其配置和健康状态，因此增加了命名的休眠路由与诊断。

## 测试

`packages/llm/llm-pi-ai/tests/config.spec.ts` 验证默认路由物化，`packages/llm/llm-pi-ai/tests/catalog.spec.ts` 验证目录公开，`apps/cli/tests/doctor.spec.ts` 验证有界的桥接健康解析。聚焦运行通过了 3 个文件、83 个测试。
