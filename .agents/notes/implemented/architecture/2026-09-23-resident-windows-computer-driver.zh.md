# Agent Note: Windows 常驻 Computer 驱动

Status: implemented

[English](2026-09-23-resident-windows-computer-driver.md) | 中文

## Problem

Phoenix Desktop 过去为每个普通 Computer 动作启动新的 PowerShell 进程并编译 C#。浏览器控制通道也为每个请求创建一次 pipe 连接，使每个内嵌浏览器命令都承担连接建立成本，并让回复关联依赖隐式顺序。

## Decision

Phoenix Desktop 通过一个当前用户 named pipe 提供 schema-2 Computer 通道。`DesktopBrowserControlServer` 保持连接存活，按序处理请求，把 named-pipe 客户端认证为所属 runtime 进程或其后代，并在每条回复中返回请求标识。`DesktopComputerDriver` 在常驻桌面进程中执行 Win32 截图、窗口、焦点、鼠标、键盘与滚动操作。

TypeScript 客户端按进程保留一个连接；Phoenix Desktop 可用时，所有 Computer 请求都会通过常驻通道串行处理。客户端校验回复 schema 与大小，并在超时、协议错误或取消时销毁连接。状态变更动作的原生回复会携带输入注入返回后立即捕获的截图，从而免去单独的截图请求与固定的动作后延迟。凭据动作不会捕获截图，避免把私密提示框或刚填入的表单附加到模型回合。Phoenix Desktop 未发布 descriptor 时仍使用 PowerShell 驱动回退。

Schema 2 拒绝 account 与 secret 属性。`browser_login` 只传当前 HTTPS origin；桌面 host 会核对 WebView 当前 origin，仅在 broker 没有凭据时通过 Phoenix 私密提示框询问，随后获取一次性 origin 授权并填入一组明确可识别的可见账号/密码字段，不提交表单。`browser_forget_credentials` 会删除当前 origin 的已存值。凭据不会进入 Computer 参数、结果、登录动作返回的截图或学习记录；安全学习投影只保留动作名称与规范 origin。用户可在提示框关闭 vault 保存。broker 使用 AppContainer profile 与 DPAPI 静态加密，但该 AppContainer SID 会被使用同一 profile 启动的进程共享，因此不能防御以相同 Windows 用户和 AppContainer SID 运行的恶意进程。

## Alternatives considered

**每个动作启动一个原生 helper。** 拒绝，因为进程启动仍保留要消除的延迟，并使所有权和取消更复杂。

**每个动作创建一次 pipe 连接。** 拒绝，因为重复的 named-pipe 建立增加可测量的握手工作，并阻止一个通道提供串行请求所有权。

**把凭证放进 Computer 请求。** 拒绝，因为模型参数与工具调用日志会持久保存。独立的 host 提示框与 broker 让账号/密码字段留在该协议及学习投影之外。

## Consequences

常驻 Desktop 动作避开 PowerShell 启动与 C# 编译，并在同一回复中收到按请求关联的观察。服务器拒绝所属 runtime 树以外的同用户进程；超时或取消会关闭连接且不重试变更动作。PowerShell 回退继续服务于 source 或非 Desktop 组合。常驻通道还会把截图与凭据提示框串行化，避免同一 runtime 在等待用户输入时通过 Computer 截取提示框。

发布前仍需要原生 C# 构建与交互式 Windows smoke 证据。本决定不宣称与 Codex 达到相同速度；这需要使用相同冷启动与热路径动作在同一台机器上完成基准测试。
