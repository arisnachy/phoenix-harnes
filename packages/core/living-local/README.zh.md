# `@phoenix-ai/dsh-living-local`

[English](README.md) | 中文

`ctx.living` 的持久化进程内实现。它把创建物 manifest 保存在仅所有者可访问的版本化 JSON 文档中，而运行提供者的连接保持临时状态。

## Behavior

启动时会把已记住的 manifest 恢复为离线创建物。持久化的 `remember()` 与 `forget()` 变更通过同一条串行提交队列执行，因此并发更新不会互相覆盖。每次变更都会先原子写入下一份完整目录，再在内存中发布；如果写入失败，内存中的 manifest 集合以及任何已挂载提供者都保持不变。

`attach()` 会验证提供者确实能够达到 manifest 的目标级别，只接受当前已提交 manifest 中声明的事件，并依据真实提供者方法报告已达到级别。已有提供者挂载时替换 manifest，只有在该提供者满足新契约时才会被接受；如果在持久化写入期间提供者发生变化并且不再满足最终提交的 manifest，它会被断开，而不会被错误地保留为已连接。释放提供者只改变连接状态，不会删除 manifest。

## Model Experience

模型不直接调用本包。挂载 `@phoenix-ai/dsh-tool-living` 后，已记住的离线创建物仍可被发现，并可由生成的提供者或适配器重新连接。

## Limitations

此实现仅限进程内运行：它本身不跨网络或进程传输事件与动作。进程外创建物需要单独的适配器插件来挂载 `LivingCreationProvider`。
