# `@phoenix-ai/dsh-living-local`

[English](README.md) | 中文

`ctx.living` 的持久化进程内实现。它把创建物 manifest 保存在仅所有者可访问的版本化 JSON 文档中，而运行提供者的连接保持临时状态。

## Behavior

启动时会把已记住的 manifest 恢复为离线创建物。`remember()` 先原子写入下一份完整目录，再在内存中发布。`attach()` 验证提供者确实能够达到 manifest 的目标级别，只订阅已声明事件，并依据真实提供者方法报告已达到级别。释放提供者只改变连接状态，不会删除 manifest。

## Model Experience

模型不直接调用本包。挂载 `@phoenix-ai/dsh-tool-living` 后，已记住的离线创建物仍可被发现，并可由生成的提供者或适配器重新连接。

## Limitations

此实现仅限进程内运行：它本身不跨网络或进程传输事件与动作。进程外创建物需要单独的适配器插件来挂载 `LivingCreationProvider`。
