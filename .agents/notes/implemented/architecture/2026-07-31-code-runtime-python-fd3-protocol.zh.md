# Agent Note: the code-runtime-python duplex frame protocol

Status: implemented

[English](2026-07-31-code-runtime-python-fd3-protocol.md) | 中文

## Problem

CPython code-runtime 后端（`@phoenix-ai/dsh-code-runtime-python`）在全新的隔离 CPython 子进程中运行每个模型程序，并通过子进程的私有描述符桥接 binding 调用与完成值。协议需要明确方向，因为同步读写器共享同一条 Windows 管道时可能互相阻塞。host 也不能信任 child 回复：模型代码可以伪造任意回复帧，所以 host 处理每个入站帧前都必须校验并重建。协议承载无损 JSON，不依赖递归的 `JSON.stringify` 或 `json.dumps` 深度。

## Decision

`src/protocol.ts` 是 wire vocabulary 的 host 侧及其敌意帧编解码：

- **`validateChildFrame`** 对来自 fd 4 的每个 child 回复做形状校验并重建。编译期 union 不能约束运行时帧：伪造帧可以携带 `null`、被污染的字段，或省略必需字段，所以每个被接受的帧都逐字段重建。伪造的额外字段绝不随行，非有限的 call id 绝不会被回显进 reply，垃圾返回 `undefined` 被丢弃，而不是在 host 的 message handler 里抛错。
- **`encodeJsonPlain` / `checkDoneValue` / `hasUnsafeIntegerToken` / `hasNonLosslessNumber`** 是 lossless-JSON 编解码器与计量器。它们迭代遍历（显式栈，非递归），使低于字节预算的深层值能完整穿越；`checkDoneValue` 把字节计量与数字无损性折进一次遍历，在它本会新增的增量工作之前就拒绝超预算 payload——即入栈子节点；字符串与 key 由非分配的转义尺寸扫描（`jsonStringBytesUpTo`）计量，从不物化转义副本。它不会重新约束帧自身宽度：检查运行时 `done.value` 已经经过 `JSON.parse`，所以 payload 尺寸由上游承担，并在那里由 host 固定的 fd-4 接收缓冲封顶。超出安全范围的整数型 double 通过 `BigInt` 数字序列化，穿越的是精确整数而非 `String()` 的舍入形式。
- **`logTruncationMarker`** 产出日志 ledger 耗尽字节预算时发出的带内标记文本。

`py/protocol.py` 镜像消息形状，并重新声明两侧都会执行的两个描述符：`PROTOCOL_READ_FD = 3` 承载 host 到 child 的请求，`PROTOCOL_WRITE_FD = 4` 承载 child 到 host 的回复。共享的截断标记文本保持逐字节一致。

## Wire contract

host 向 child fd 3 写入 JSON-lines 请求，并从 child fd 4 读取 JSON-lines 回复，每行一个对象；stdout 与 stderr 仍是独立的捕获流。Host → child 帧为 `boot`（首帧）、`run`（`boot-ack` 后）以及每个 `call` 对应的一个 `reply`。Child → host 帧为 `boot-ack`、`call`、`log` 与 `done`。`log` 帧的 `truncated` 标志标记那个本身就是 child ledger 截断标记的帧，使 host 在与 child 相同的点停止捕获，而不是从自己的预算去推断。`done.error.kind` 是 `exception`、`invalid-output`、`output-limit` 之一；wall/CPU 预算、abort 与 substrate 死亡都在 host 侧观测，不作为帧携带。

Node 通过 `stdio: ['pipe','pipe','pipe','pipe','pipe']` 分配五个位置管道：stdin、stdout、stderr、fd 3 与 fd 4。将 protocol 两个方向放在独立管道上，避免同步 CPython 读写器争用同一条 Windows 管道，同时保留既有的 stdout/stderr 捕获流。

## Mirror alignment

`tests/protocol-mirror.e2e.ts` 启动真实 CPython 解释器，并将两个描述符常量和截断标记文本与 `src/protocol.ts` 比较。它还将每个 `TypedDict` 的必填与可选 wire 字段集与 TypeScript 帧定义比较，因此字段重命名、删除或必填/可选性不一致都会使测试失败。字段类型不跨语言比较；这部分残留由 review 与后端真子进程套件负责。

## Alternatives considered

**让请求和回复共用一个双向 fd 3。** 拒绝。同步 Python `send()`/`flush()` 可能在 host 的回复读取器运行时阻塞；独立的 fd 3 与 fd 4 管道让两个方向各自推进，并保留原有的墙钟预算。

**把 Python JSON codec（`_encode_json_plain` / `_decode_json_plain`）移入 `py/protocol.py`，以与 `protocol.ts` 跨侧对称。** 拒绝。host 侧 codec 校验敌意输入且自包含。Python codec 在受信任侧产出输出，并耦合于 bootstrap 内部 helper（`_Emit`、`_dump_scalar`/`_dump_string`/`_dump_float`、`LogBuffer` 的成本核算、`_check_done_value`、`_lossless_json_violation`）；只移动两个入口会把这一整片拖进 `protocol.py`，或制造 `bootstrap.py` ↔ `protocol.py` 的 import 环。真正跨侧平行的是 host 校验 fd-4 回复与 child 信任 host 拥有的 fd-3 请求。

## Consequences

协议拥有两个命名描述符和五管道 spawn 布局。host 校验并重建来自 fd 4 的每个 child 回复，child 从 fd 3 读取 host 请求并信任这条由 host 控制的流。stdout 与 stderr 继续用于程序输出捕获。mirror guard 比较描述符值、标记文本、字段名以及必填/可选状态，但不比较字段类型；这部分残留由 review 与后端真子进程套件负责。
