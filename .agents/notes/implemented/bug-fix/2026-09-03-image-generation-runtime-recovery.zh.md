# Agent Note: 图像生成运行时恢复

Status: implemented

[English](2026-09-03-image-generation-runtime-recovery.md) | 中文

## 问题

PHOENIX 已暴露 `image_generation`，但四个彼此独立的检查仍可能阻止真实图像被尝试或接受。Codex 桥接层把当前 `doctor --json` 的表示形式当成权威依据，因此新的或尚未识别的诊断输出会在 `codex exec` 运行前被拒绝。HARDNESS 把所有已注册工具都投影为通用的 `tool` kind，因此像 `image_generation` 这样的语义需求无法选择 `tool:image_generation`。随后 acquisition 会把本地已经存在的工具误报为外部依赖。最后，要求 `verified` 状态的需求无法执行刚准备好的 `testing` 能力来生成晋升所需的证据，而且生产 artifact runtime 也没有栅格图像 renderer。

## 决策

真实的 Codex 图像 worker 执行是图像可用性的权威依据。`codex doctor --json` 只保留为建议性探针；PHOENIX 会实际尝试 `codex exec --enable image_generation`，并根据这次执行分类认证、能力、配额和运行时错误。桥接层仍然禁止静默回退到单独计费的 API，并且仍要求发现新的真实栅格文件后才报告成功。

HARDNESS 将精确注册的工具 id `tool:<need.kind>` 视为该需求的语义 provider。精确名称工具路线以工具自己的 JSON schema 作为参数和输出的权威定义，而不会把自由文本任务描述误解释为 ATLAS 的 input/output 标签。Acquisition registry 可以把已经索引的精确名称工具准备为 `testing`，而不是错误地进入 `WAITING_EXTERNAL`。

当 acquisition 刚为最终要求 `verified` 的需求准备出一个 `testing` 能力时，任务允许执行该 testing 候选一次。成功的 artifact 验证、独立 judge 和已记录的通过证据仍然是晋升到 `verified` 的强制条件；最终完成时并没有降低用户要求的状态。图像工具现在发布基于 attachment 的 HARDNESS artifact 元数据，生产 runtime 会把 PNG、JPEG、WebP 和 GIF artifact 渲染为 `hardness-image` presentation。

## 备选方案

**继续把 `codex doctor --json` 作为硬性 gate。** 不采用，因为诊断 schema 可以独立于实际图像执行能力变化，从而在权威操作开始前制造假阴性。

**在执行前直接把 acquired capability 晋升为 `verified`。** 不采用，因为这会在没有真实通过证据的情况下伪造信任，并绕过“通过真实执行和独立 judge 才能获得 verification”的生命周期规则。

**添加单独计费的 OpenAI API fallback。** 不采用，因为这条路径的明确目标是复用用户已经认证的 Codex/ChatGPT 图像能力，不能静默改变计费方式。

**把 Chrome/CDP 作为主要恢复路线。** 不采用，因为浏览器自动化是另一个可选 transport，具有独立的启动和会话失败模式；当安装的 Codex image worker 可用时，不应依赖它。

## 影响

图像请求现在可以跨越无害的 Codex doctor 诊断格式变化继续执行，HARDNESS 也不会再把已经注册的精确名称图像工具误判为缺失的外部 provider。Verification 仍然是 fail-closed：testing capability 只有在真实 artifact 成功、renderer 接受、证据记录和 judge 通过之后才会成为 verified。图像工具现在携带 governed mission 可使用的 artifact 元数据，而栅格渲染仅覆盖 attachment pipeline 明确支持的图像 MIME 类型。真实认证失败、功能禁用、配额耗尽或没有生成新的栅格文件时，任务仍会以分类错误阻塞，而不会伪造完成结果。