# Agent Note: Web fetch SSRF guard

Status: implemented

[English](2026-08-24-web-fetch-ssrf-guard.md) | 中文

## Problem

匿名 HTTP 抓取提供方接受任意 HTTP(S) 目标，并把主机名解析交给底层 fetch。模型可见的 web 请求因此可能访问 loopback、私有、link-local、multicast 或保留网络，也可能通过同源重定向到达这些网络。

## Decision

`web-fetch-http` 在每次请求前立即验证私有和保留目标。先检查字面地址，再解析主机名的全部结果；如果解析为空或任一结果属于私有或保留网络，请求就会被拒绝。每个被接受的同源重定向之后也会再次执行相同检查。

生产配置始终把 `allowPrivateNetworks` 设为 `false`。该显式例外仅供隔离的本地 fixture 服务器测试使用，并记录为不适用于不受信任请求。面对恶意解析器的部署仍应使用出口代理或网络 allowlist，因为验证和建立 socket 是两个分开的操作。

## Alternatives considered

**允许私有目标并依赖部署防火墙。** 拒绝：该提供方可复用，而调用方的网络边界并不相同。

**只验证字面 IP 地址。** 拒绝：主机名可以解析到内部地址，也可以在重定向之间改变结果。

**声称通过预解析即可完全防止 DNS rebinding。** 拒绝：Node fetch 可能在检查之后再次解析；残余风险会被明确记录，出口代理仍是更强的控制。

## Consequences

公共 web 抓取现在会以 `WEB_BLOCKED_URL` 对私有和保留目标 fail-closed，包括 DNS 结果和重定向跳转。提供方本地测试显式启用仅供 fixture 使用的例外。聚焦提供方测试覆盖防护和原有传输行为；没有涉及凭据或远程 MCP 激活。
