# PHOENIX Evolution 回滚契约

[English](ROLLBACK.md) | 中文

Capability 不等于 authority。Full-access 只改变 PHOENIX 能做什么；它并不授予 blanket permission。

在 destructive、credential、control-plane、filesystem-wide、connector-write 或 sandbox-bypass actions 之前，PHOENIX 必须对 side effect 分类，选择 least-privilege route，定义精确的 affected scope，创建可信的 recovery point（Git/worktree、backup、transaction/snapshot、export 或 explicit undo），定义 post-action verification，并明确 verification 失败时如何恢复 state。

如果不存在可信的 recovery path，则执行前必须获得 explicit human approval。

发生 unexpected mutation 时：停止 affected scope 内的进一步写入，在不包含 secrets 的前提下保留 diagnostics，恢复 recovery point，运行最小 integrity proof，并隔离责任 tool/strategy/model 组合，直到新的 lab candidate 通过。

任何 upstream update 都不能仅仅因为更新就进入 `main`。Identity、security、regression、recovery、KIRA review 与 human promotion 必须先通过。
