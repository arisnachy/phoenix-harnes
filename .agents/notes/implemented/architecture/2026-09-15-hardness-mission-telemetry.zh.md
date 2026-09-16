# HARDNESS Mission Telemetry

HARDNESS 提供从持久化 `hardness/mission` audit row 派生的无 secret mission metrics。in-memory observer 挂载到 runner，并在 durable audit 成功后接收同一批 row。

snapshot 记录 attempts、completed 与 blocked missions、recovery attempts、每个 protocol step 的 completed/blocked 计数、非负 duration 的 count/total/maximum，以及稳定的 blocked reason 计数。Replay 可从保留的 audit row 重建等价 snapshot，不保留 arguments、credentials、provider errors 或 live runtime objects。

Telemetry 仅用于观察。observer 失败会被隔离，不能改变 approval、execution、verification、judge 或 terminal-state 决策。没有 live session 的 direct runner call 仍可提供 metrics；production audit persistence 仍由 calling session 负责。

受控的 synthetic sample 覆盖 blocked execution 后成功 presentation、replay 等价性、reset 行为和非负 duration normalization。adapter README 记录 public observer 与 replay function。
