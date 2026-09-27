# `@phoenix-ai/dsh-tool-living`

[English](README.md) | 中文

Universal Living Creations 的模型侧 consumer。它安装一条与领域无关的策略，并通过 `ctx.living` 提供注册、连接器生成、检查、列出、读取、操作、验证以及显式遗忘创建物的工具。

## Model Experience

### Universal creation policy

#### What the model sees

只要 Phoenix 创建或实质修改面向用户的制品或可运行系统，模型就必须在交付前注册，不受领域或格式限制。每个 Phoenix 创建的输出都获得连接器契约；可变创建物以实时控制为目标，而不是静默降级为静态制品。后台 worker 是可选的，并且需要用户明确同意。

#### Token effect

一条有界且与领域无关的策略替代各领域专用创建指令。插件激活期间成本固定，不随已记住创建物数量增长。

#### KV Cache effect

只要插件版本和注册 scope 不变，策略文本保持前缀稳定。创建物专属状态通过工具查询，不会追加到每一次请求。

### Living tools

#### What the model sees

模型获得用于注册、检查、列出、读取、操作、验证、获取 connector kit 和显式遗忘创建物的 schema。`living_register_creation` 接受任意 `kind` 与自描述能力，配置每个创建物独立的控制身份，并让 telemetry/error surface 与该持久身份绑定。`living_verify_creation` 在实际集成级别低于声明目标时拒绝完成。

#### Token effect

可见工具集合不变时 schema 成本固定。manifest、telemetry 和错误仅在模型调用对应检查、读取或验证工具时进入上下文。

#### KV Cache effect

只要可见性和定义不变，schema 保持缓存稳定。单个创建物更新只影响历史尾部的工具结果，不重写可复用 prompt 前缀。

## Known Limitations and Deferred Work

- 生成的 connector kit 有意保持轻量并以 owner-local 为目标。公共浏览器 bundle 绝不能包含 bearer token；面向浏览器的产品应把 Phoenix connector 放在服务端进程/sidecar 中，或使用其他安全 provider 实现。
