# Agent Note: 已安装的 Windows 桌面启动不依赖附近的 checkout

Status: implemented

[English](2026-09-22-windows-installed-desktop-startup.md) | 中文

## 问题

已安装的桌面程序可能会发现常规位置中的 Phoenix checkout，并通过 PowerShell 和 pnpm 启动它，即使该 checkout 缺少启动依赖也会如此。readiness 状态也可能在 supervisor 退出后仍然存在，或引用与通过 HTTP 探测的 listener 不同的进程。重复的 WMI 命令行查询会间歇性地拒绝由桌面程序启动的 listener。默认 profile 的标题与 telemetry 插件导入了部署后的 base bundle 未包含的必需 workspace 对等包，Windows Chrome MCP 行则启动了生产依赖闭包中不存在的源代码 `tsx` 入口。smoke 脚本也可能在桌面程序同时追加日志时读失败并隐藏原始启动故障。

## 决策

`DesktopSourceCheckout.ShouldUseSourceCheckout` 仅在明确设置 `PHOENIX_SOURCE_ROOT` 时启用源码模式。`DesktopStartupContract.ResolveSourceRoot` 只接受可运行的显式路径；路径无效时会继续使用安装包中的运行时。正常安装启动使用随包提供的 Node 运行时和受管 supervisor。base bundle 将 `@phoenix-ai/dsh-session-title-llm` 和 `@phoenix-ai/dsh-session-telemetry` 声明为生产依赖，因为已挂载的标题与 telemetry 插件会导入它们。web-app bundle 声明 `@phoenix-ai/dsh-chrome-connector`，因为其 Windows MCP 行会启动该包。受管启动使用随包的 Node 可执行文件和连接器编译后的 `lib/bin.js`；源码启动保留 `tsx` 入口。[Windows 桌面文档](../../../../docs/phoenix-windows.zh.md) 说明了面向用户的安装与启动选项。

桌面程序集和 Inno Setup 元数据使用版本 `1.0.22`，这是 `1.0.21` 之后的下一个 Windows 版本。[安装程序契约测试](../../../../scripts/windows-installer.spec.ts)会保证两个版本值一致。

随包提供的 `.phoenix-managed-install` 标记会记录运行时种子的源 commit。新安装程序携带不同种子 commit 时，启动会先安装该种子再启动主机，并把被替换的运行时保留在带时间戳的同级目录中，以便恢复本地自修改。旧版安装程序未携带种子时，已 ready 的运行时仍可使用。

每次 readiness 探测都会在 HTTP 请求前后分别获取 loopback listener PID 和进程创建时间。只有 Phoenix HTML 响应前后都属于同一个仍在运行的进程，探测才会通过。对于由桌面程序启动的 runtime，Toolhelp32 进程快照必须证明 listener 是仍然存活的 supervisor 的后代；这样每次探测都无需查询 WMI 命令行。只有命令行和稳定进程身份都匹配时，程序才会采用兼容的外部 listener；它不会声称拥有或停止该进程。关闭应用时，程序只会终止由其持有的 `Process` 句柄对应的进程树。源码根目录只有在 readiness 成功后才会持久化。

Windows smoke 使用允许共享读写与删除的文件句柄读取桌面日志，并对暂时的 I/O 错误进行有限重试，避免活动中的追加操作遮蔽启动诊断。Windows 工作流会先在干净的当前用户配置中安装生成的 Inno 安装包，再运行独立可执行文件检查。它会显式运行静默安装跳过的命令，验证快捷方式和当前用户的启动项，启动已安装的可执行文件，确认实时 HTTP listener 属于其进程树，并运行卸载程序。如果测试无法确认它启动的所有进程都已停止，就会保留安装和应用数据；失败诊断会作为 CI 产物保存。

## 备选方案

**从常规路径或已保存的指针发现 checkout。** 不予采用，因为已安装的应用不应依赖开发文件或其包管理器依赖。只有通过显式环境变量指定的源码树才会被选用。

**把开放端口或看似 Phoenix 的 HTML 当成 readiness。** 不予采用，因为两次探测之间它们都可能过期或属于另一个进程。readiness 会验证实时 listener PID、进程创建时间、HTTP 身份和自有 supervisor 状态。

**每次 listener 探测都查询 WMI。** 不予采用，因为命令行查询间歇性地拒绝桌面程序启动的 listener。Toolhelp32 进程快照会验证自有 listener 的父进程链；外部管理的 listener 仍需要兼容的命令行。

**通过 `taskkill.exe` 按 PID 停止进程。** 不予采用，因为 PID 可能已被其他进程复用。桌面程序会保留自己启动的 `Process` 句柄，并且只终止该进程树。

**只测试发布的桌面可执行文件。** 不予采用，因为这不会覆盖 Inno payload 的安装位置、快捷方式、启动项注册或卸载清理。CI 会安装并启动同一工作流生成的安装包。

**依赖 workspace 链接或自动安装对等依赖来解析插件导入。** 不予采用，因为已安装运行时使用干净的生产依赖闭包；Cordis 加载插件之前，基础 bundle 声明的依赖中必须包含所需对等包。

**不比较随包种子，仅凭 ready 标记信任运行时。** 不予采用，因为 ready 标记只能证明较早的一次安装已完成，不能证明运行时包含当前桌面版本所需的软件包。

**在已安装运行时从 TypeScript 启动 Chrome connector。** 不予采用，因为生产构建已生成 `lib/bin.js`；web-app 依赖闭包会包含编译后的包，并通过随包提供的 Node 可执行文件启动它。

## 影响

已安装程序的启动行为不再受附近是否存在 Phoenix checkout 影响。在随包提供的运行时启动期间，原生窗口保持可用并显示进度或恢复状态。种子身份可避免旧的 ready 标记掩盖运行时缺少的软件包；被替换的运行时会保留，以便恢复本地自修改。base 和 web-app manifest 会包含其挂载插件导入的生产包。web-app composition 测试固定 Chrome connector 依赖及其受管/源码入口；Windows 已安装包 smoke 会实际执行插件加载和 Web readiness 路径。开发人员仍可显式配置源码 checkout；如果该 checkout 无法运行或未能完成启动，Phoenix 会继续使用受管运行时。

已安装安装包的 smoke 需要支持 Inno Setup 和桌面功能的 GitHub 托管 Windows runner。本地契约测试和 PowerShell 语法解析不能代替真实 Windows 安装与启动结果。测试拒绝复用现有 Phoenix 配置；如果无法证明路径归本次测试所有，就会保留诊断数据而不删除这些路径。
