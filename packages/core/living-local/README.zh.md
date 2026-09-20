# `@phoenix-ai/dsh-living-local`

[English](README.md) | 中文

`ctx.living` 的持久化进程内实现。它把创建物 manifest 保存在仅所有者可访问的版本化 JSON 文档中，并提供经过认证的 loopback 控制桥，使 Phoenix 创建的应用、网站、服务、模拟器和 dashboard 在进程重启后仍可重新连接。

## Behavior

启动时会把已记住的 manifest 恢复为离线创建物。持久化的 `remember()` 与 `forget()` 变更通过同一条串行提交队列执行，因此并发更新不会互相覆盖。每次变更都会先原子写入下一份完整目录，再在内存中发布；如果写入失败，内存中的 manifest 集合以及任何已挂载提供者都保持不变。

`attach()` 会验证提供者确实能够达到 manifest 的目标级别，只接受当前已提交 manifest 中声明的事件，并依据真实提供者方法报告已达到级别。已有提供者挂载时替换 manifest，只有在该提供者满足新契约时才会被接受；如果在持久化写入期间提供者发生变化并且不再满足最终提交的 manifest，它会被断开，而不会被错误地保留为已连接。释放提供者只改变连接状态，不会删除 manifest。

对于进程外创建物，内置 `phoenix-living-http-v1` bridge 只绑定 loopback，每个创建物使用独立 bearer secret 认证，连接时验证运行时声明的 state/actions/events/actors 是否完全匹配，接收状态与 telemetry/event 更新，并把 Phoenix 动作排队直到运行时返回结果。心跳过期或主动断开只会移除实时 provider；持久 manifest 仍保留，等待重连。

## 模型体验

### 本地 Living provider

#### 模型看到的内容

模型不直接调用本包。挂载 `@phoenix-ai/dsh-tool-living` 后，非静态创建物会获得控制描述符和 connector kit；生成的运行时连接后，同一组 `living_read_state`、`living_act`、检查与验证工具都通过 `ctx.living` 工作。

#### Token 影响

Provider 本身不增加常驻提示词文本。只有显式 living 工具调用才把有界的创建物元数据、状态或动作结果返回给模型。

#### KV Cache 影响

Provider 的连接状态变化不会重写可复用提示词前缀。后续 living 工具结果会作为普通工具 transcript 中的新动态内容追加。

## 已知限制与暂缓事项

- 内置 bridge 有意只绑定 loopback，适用于 owner-local 运行时或受信任的服务端 sidecar。
- 纯公共浏览器 bundle 无法安全保存 bearer secret；这类部署需要服务端连接器或另一个 `LivingRegistry` 传输实现。
