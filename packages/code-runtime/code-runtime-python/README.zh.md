# @phoenix-ai/dsh-code-runtime-python

[English](README.md) | 中文

[`@phoenix-ai/dsh-code-runtime`](../code-runtime/README.zh.md) seam 的 CPython 子进程实现。与 [`@phoenix-ai/dsh-code-runtime-worker-thread`](../code-runtime-worker-thread/README.zh.md) 配套；以全新的 CPython 子进程取代 Node worker 线程，让模型代码从 TypeScript 换成 Python。

本包持有该 seam 的 wire protocol 和生产实现：host 侧的帧编解码、Python 侧对同一套消息词汇的镜像，以及注册为 `ctx.pythonCodeRuntime` 的 `PythonCodeRuntime`。

## 提供者

`PythonCodeRuntime` 为每次运行启动全新的 CPython 进程。它支持 `return`、`await tools.name(args)`、stdout/stderr 捕获、带类型的绑定错误、取消、墙钟超时、输出限制，以及在主机提供时启用 POSIX CPU/地址空间限制。进程接收空环境，并使用两个私有 protocol 管道：fd 3 承载 host 到 child 的请求，fd 4 承载 child 到 host 的回复；stdout 与 stderr 仍是独立的捕获流。它是隔离措施而不是安全边界；消费者仍必须在执行前应用产品 sandbox 和审批策略。

## Wire protocol

host 向子进程 fd 3 写入无版本号的 JSON-lines 请求流，并从 fd 4 读取 child 到 host 的回复流——每行一个 JSON 对象，让 stdout/stderr 空出给程序自己的输出。`src/protocol.ts` 是 host 侧；`py/protocol.py` 在 Python 侧镜像其帧词汇、描述符常量与共享的截断标记文本。

- **独立的 protocol 管道，而非 stdout** —— Node 通过 `stdio: ['pipe','pipe','pipe','pipe','pipe']` 按位置钉住五个管道；`PROTOCOL_READ_FD = 3` 是 child 的请求输入，`PROTOCOL_WRITE_FD = 4` 是 child 的回复输出。独立方向避免同步 Python 读写争用同一条 Windows 管道。JSON-lines 帧保持不变。
- **host 把每个 child 回复当作敌意输入** —— 模型代码可以通过 child 的 fd 4 写入伪造帧，所以 `validateChildFrame` 在 host 处理每个回复前做形状校验并重建：伪造的额外字段绝不随行，非数字的 call id 绝不会被回显进 reply，垃圾降为 `undefined` 被丢弃，而不是在 host 的 message handler 里抛错。child 从 fd 3 读取 host 请求，并信任这条由 host 控制的流。
- **lossless-JSON 穿越** —— 完成值与 binding 参数以精确 JSON 穿越。`encodeJsonPlain` 无递归地序列化一个 `JSON.parse` 产出的值，使低于字节预算的深层值能完整穿越，而不是死在 `JSON.stringify` 的栈限制上；`checkDoneValue` 在一次遍历中同时计量伪造完成值的字节长度与数字无损性，在它本会新增的增量工作之前就拒绝超预算 payload（即入栈子节点；字符串与 key 由非分配的转义尺寸扫描计量，从不物化转义副本）——帧自身的宽度已被上游 `JSON.parse` 支付、由 host 的 fd-4 接收缓冲封顶，并非在此重新约束；`hasUnsafeIntegerToken` 读取原始帧文本，捕获 `JSON.parse` 会静默舍入的整数 token；`hasNonLosslessNumber` 拒绝无字节上限的 `call.args` 中的非有限数或负零。超出安全范围的整数型 double 通过 `BigInt` 数字序列化，穿越的是精确整数而非 `String()` 的舍入形式。
- **共享截断标记** —— `logTruncationMarker(maxBytes)` 在两侧产出逐字节一致的文本，使被截断的日志运行无论从哪侧触达上限都读起来一致。`log` 帧的 `truncated` 标志把子进程 ledger 自身的标记与程序输出区分开。

## Model Experience

经由 [`dsh-tools`](../../core/tools/README.zh.md) 里的 Code Mode 间接生效：Code Mode 把本后端的精确完成值（放得下时）或一个明确的 `invalid-output` / `output-limit` 失败，连同精确的 `[dsh-code-runtime-python] log capture truncated at <maxLogBytes> bytes` 日志标记，渲染进一个保留的 `run_code` 结果。

#### KV Cache effect

无直接失效；具名消费者拥有任何请求前缀的变更。

## 已知限制与延期工作

- **跨语言 guard 覆盖运行时执行的面与帧字段形状** —— `tests/protocol-mirror.e2e.ts` 启动一个真实 CPython 解释器，对照 `src/protocol.ts` 断言两个 protocol 描述符常量、日志截断标记文本，以及 `py/protocol.py` 中每个 `TypedDict` 的必填/可选 wire 字段集。它不比较字段的*类型*（例如 `cpuSeconds` 两侧都是 `int`）：跨 TypeScript 与 Python 比较类型声明在此无机械等价物，故类型级漂移仍由 review 加后端真子进程套件捕获，而非本包的测试。
- **Python 提供者需要已安装的 CPython** —— `pythonCommand` 可配置，Windows 默认使用 `python`，其他平台默认使用 `python3`。如果解释器不存在，提供者报告子进程失败，不会静默回退到 TypeScript。
- **子进程是隔离措施而不是安全边界** —— 模型代码仍可使用 Python 标准库，因此执行前必须由产品 sandbox 和审批策略治理。
