# Agent Note: 自适应 Judge 与 Token 效率

Status: implemented

## Problem

后续外部基准显示，PHOENIX 比对比 harness 高约 1.5 分，但模型 token 消耗接近两倍。质量提升是真实的，但成本结构不可接受。

主要原因是上一轮质量改进加入的普通完成桥接。每个已经验证的实质性修改都可能启动一个新的结构化 subagent。虽然 spawn provider 不继承父会话历史，但它仍会创建完整 child agent、沿用父级模型路由、重新组合 preset/system prompt 与允许的工具 schema，并且默认创建独立 Git worktree。全局完成提示还要求在没有 durable goal judge 时使用新的独立 verifier，因此模型自身的审查可能与 bridge 重复。

## Decision

确定性证据加一次同 worker 的静默 in-band 自检现在成为默认完成路径。验证之后，同一个 worker 对照 acceptance ledger 与真实证据，并在最终回复前直接修复明显缺口。任务仅仅“很实质”不再自动启动第二个 judge。

普通独立 judge 改为自适应。一个零模型成本的风险分数只在独立性真正可能增加信息时升级：用户明确要求 judge/audit/second opinion；工作涉及安全或高影响；验证曾失败后恢复；修改范围异常广；或者前一次独立 judge 要求修复，因此必须重新审查。明确的错误契约和规模/资源要求本身不会触发独立 judge，因为定向测试/benchmark 加 worker 自检是更便宜的一线证据。

在确定性证据不完整时，bridge 也不会支付语义审查成本。若请求明确要求可观察错误契约或规模/资源行为，对应的定向证据必须先存在，judge 才能运行。

当独立 judge 确实必要时，它的上下文被刻意压缩：请求文本有上限，mutation 与 verification 摘要有界，默认工具仅包含 read/glob/grep/session evidence；只有视觉任务才加入 visual 工具，只有外部/当前比较才加入 web 工具。judge child 还有独立 token 上限。

新增专用 `judge-spawn` provider，并关闭 Git worktree isolation，因为该 judge 是只读的。普通 `spawn` provider 保持不变，继续供可能修改状态的 worker 与其他 subagent 使用。

`needs_changes` 仍只把具体修复项交回原 worker。修复并重新获得确定性验证之后，会强制再进行一次新的 judge 审查，因此 judge 永远不会自行修改后又自行认证。

## Verification

回归测试固定了风险策略，包括：错误契约加规模要求走低成本路径；明确独立审查/高影响工作/恢复后的验证失败会升级；judge 要求修复后强制复审；紧凑工具面；按需 visual/web 工具；以及 judge token 上限。base bundle 测试固定 `judge-spawn` 的 `worktreeIsolation: false`。

## Alternatives considered

**完全移除独立 judge。** 拒绝，因为上一轮外部基准已经显示可测量的质量提升，而且在高风险、广泛修改或失败恢复场景中独立审查仍然有价值。

**始终为 judge 使用更小/更便宜的模型。** 不作为通用默认，因为不同 provider 的模型可用性与能力不同。自适应调用和压缩上下文可以降低成本，而不会静默改变用户选择的模型体系。

**使用 fork provider 做便宜审查。** 拒绝，因为 fork 按设计继承父历史，这会削弱独立性，并可能增加本应“新鲜审查”的上下文 token。

**继续审查每个实质修改，只限制输出 token。** 拒绝，因为输入、system/tool schema 与 child setup 仍占据足够多成本，必须减少调用频率，而不仅是压缩输出。

## Consequences

低风险和中风险任务应继续保留之前引入的 requirement-aware 严格验证，同时避免第二次模型调用。只有在预期信息增益足以抵偿延迟和 token 时才使用独立审查。

高风险或恢复路径仍可能有意消耗额外 token。该策略优化的是每个 token 带来的预期质量，而不是为了最低 token 而牺牲验证。
