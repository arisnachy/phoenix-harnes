# `@phoenix-ai/dsh-tool-living`

[English](README.md) | 中文

Universal Living Creations 的模型侧 consumer。它安装一条与领域无关、fail-soft 的策略，并通过 `ctx.living` 提供注册、连接器生成、检查、列出、读取、操作、验证以及显式遗忘创建物的工具。

## Model Experience

### Universal creation policy

#### What the model sees

用户要求的交付物始终是主要 mission。Phoenix connectivity 只有在用户明确要求、已对该创建物选择加入，或连接器本身是所请求功能所必需时才启用。模型不能仅因为创建了制品就注册或安装 connector；当连接有价值而偏好未知时，只询问一次。connector setup 最多进行两次有界 connect/repair 尝试，并占用大约十秒前台时间，随后 fail-soft：保留任何离线 manifest、报告降级，并继续所有独立任务。用户要求跳过或在没有 connector 的情况下完成时，本轮立即停止 connector 工作。

#### Token effect

一条有界且与领域无关的策略替代各领域专用创建指令。插件激活期间成本固定，不随已记住创建物数量增长。

#### KV Cache effect

只要插件版本和注册 scope 不变，策略文本保持前缀稳定。创建物专属状态通过工具查询，不会追加到每一次请求。

### Living tools

#### What the model sees

模型获得用于注册、检查、列出、读取、操作、验证、获取 connector kit 和显式遗忘创建物的 schema。`living_verify_creation` 只在 Phoenix connectivity 是明确验收条件时使用，而不是通用完成 gate。使用 connector 时，只暴露最小有意义的 state/actions/events，保持 telemetry 有界，并保留足够 manifest resources 以便之后重连，同时绝不暴露或提交 bearer token。后台 agent 始终是可选的，并需要用户批准；connectivity 本身绝不意味着后台 worker。

#### Token effect

可见工具集合不变时 schema 成本固定。manifest、telemetry 和错误仅在模型调用对应检查、读取或验证工具时进入上下文。

#### KV Cache effect

只要可见性和定义不变，schema 保持缓存稳定。单个创建物更新只影响历史尾部的工具结果，不重写可复用 prompt 前缀。

## Known Limitations and Deferred Work

- 生成的 connector kit 有意保持轻量并以 owner-local 为目标。公共浏览器 bundle 绝不能包含 bearer token；面向浏览器的产品应把 Phoenix connector 放在服务端进程/sidecar 中，或使用其他安全 provider 实现。
