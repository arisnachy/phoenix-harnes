# Agent Note: 已安装的 Windows 桌面启动不依赖附近的 checkout

Status: implemented

[English](2026-09-22-windows-installed-desktop-startup.md) | 中文

## 问题

已安装的桌面程序可能会发现常规位置中的 Phoenix checkout，并通过 PowerShell 和 pnpm 启动它，即使该 checkout 缺少启动依赖也会如此。readiness 状态也可能在 supervisor 退出后仍然存在，或引用与通过 HTTP 探测的 listener 不同的进程。Windows 工作流只编译 Inno 安装程序，没有启动已安装的副本。

## 决策

`DesktopSourceCheckout.ShouldUseSourceCheckout` 仅在明确设置 `PHOENIX_SOURCE_ROOT` 时启用源码模式。`DesktopStartupContract.ResolveSourceRoot` 只接受可运行的显式路径；路径无效时会继续使用安装包中的运行时。正常安装启动使用随包提供的 Node 运行时和受管 supervisor。[Windows 桌面文档](../../../../docs/phoenix-windows.zh.md) 说明了面向用户的安装与启动选项。

readiness 要求连续的 Phoenix HTTP 身份探测都来自同一 listener PID 和进程创建时间。桌面程序会在标记运行时就绪前立即再次验证 listener，而且必须确认自有 supervisor 仍在运行。只有在进程身份和 endpoint 仍然稳定时，程序才会采用兼容的既有 listener；它不会声称拥有或停止该进程。关闭应用时，程序只会终止由其持有的 `Process` 句柄对应的进程树。源码根目录只有在 readiness 成功后才会持久化。

Windows 工作流会先在干净的当前用户配置中安装生成的 Inno 安装包，再运行独立可执行文件检查。它会显式运行静默安装跳过的命令，验证快捷方式和当前用户的启动项，启动已安装的可执行文件，确认实时 HTTP listener 属于其进程树，并运行卸载程序。如果测试无法确认它启动的所有进程都已停止，就会保留安装和应用数据；失败诊断会作为 CI 产物保存。

## 备选方案

**从常规路径或已保存的指针发现 checkout。** 不予采用，因为已安装的应用不应依赖开发文件或其包管理器依赖。只有通过显式环境变量指定的源码树才会被选用。

**把开放端口或看似 Phoenix 的 HTML 当成 readiness。** 不予采用，因为两次探测之间它们都可能过期或属于另一个进程。readiness 会验证实时 listener PID、进程创建时间、HTTP 身份和自有 supervisor 状态。

**通过 `taskkill.exe` 按 PID 停止进程。** 不予采用，因为 PID 可能已被其他进程复用。桌面程序会保留自己启动的 `Process` 句柄，并且只终止该进程树。

**只测试发布的桌面可执行文件。** 不予采用，因为这不会覆盖 Inno payload 的安装位置、快捷方式、启动项注册或卸载清理。CI 会安装并启动同一工作流生成的安装包。

## 影响

已安装程序的启动行为不再受附近是否存在 Phoenix checkout 影响。在随包提供的运行时启动期间，原生窗口保持可用并显示进度或恢复状态。开发人员仍可显式配置源码 checkout；如果该 checkout 无法运行或未能完成启动，Phoenix 会继续使用受管运行时。

已安装安装包的 smoke 需要支持 Inno Setup 和桌面功能的 GitHub 托管 Windows runner。本地契约测试和 PowerShell 语法解析不能代替真实 Windows 安装与启动结果。测试拒绝复用现有 Phoenix 配置；如果无法证明路径归本次测试所有，就会保留诊断数据而不删除这些路径。
