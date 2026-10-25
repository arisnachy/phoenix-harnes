# X/Twitter：在 Phoenix 中修复 OAuth

[English](x-oauth-repair.md) | 中文

## Identidades distintas

- `x-docs`：公开的官方文档；**不能**授权任何账户。
- `x-api`：用户自己的 X 账户；需要 X Developers 应用及 OAuth 2.0 同意。
- `x-api-phoenix`：先前在 X 上真实创建并验证的 Phoenix 专用账户；它使用不同的用户身份和凭据。正式注册可能需要人工参与。

Phoenix 通过本地 MCP 安装官方 [xurl](https://github.com/xdevplatform/xurl) 桥接器。进程、连接卡片或工具列表的存在**不能证明已经登录认证**。

## Autorizar

1. 打开 [X Developer Console](https://console.x.com/)，检查应用是否启用 OAuth 2.0 且拥有适当权限。除非在 xurl 中正式配置其他值，否则回调地址必须与 `http://localhost:8080/callback` **完全相同**。
2. **只在** Phoenix 的 Configuración → Conectores → X 表单中输入 Client ID 与 Client Secret。Phoenix 通过受保护的保险库引用将其交给 MCP 进程，而不是放在命令参数或聊天中。注意，官方 xurl 执行文件还会把凭据与 token 保存在 Windows 用户本地配置 `~/.xurl/auth.yml` 中；保护该配置，不得在聊天中读取或复制该文件。
3. 安装或重新连接 `x-api`。首次授权 xurl 桥接器时会在运行 Phoenix 的 Windows 用户浏览器中打开页面。若未打开，应确认 Host 能运行 `npx`、TCP 8080 端口未被占用，且注册的回调地址完全一致。初次 OAuth 可能需要数分钟。
4. 若要在不泄露 token 的情况下本地诊断，请在**同一个 Windows 用户配置**的终端执行 `npx -y @xdevplatform/xurl auth status`。如果 xurl 已经登记本地应用但无法处理回调，可以依照官方流程执行 `npx -y @xdevplatform/xurl auth oauth2 --headless`；不要将授权码或返回 URL 粘贴到聊天中。
5. 授权后，通过 `xurl whoami` 或 MCP 只读工具验证一次**真实查询**。即使 OAuth 已有效，若应用未加入要求的 API 环境或计划，也可能出现 `client-not-enrolled`。X 的计划可能产生费用，Phoenix 不得静默启用收费功能。

不要把 xurl OAuth 与通用 HTTP MCP 服务器的 OAuth 混淆；后者无法自行登记 X Developer App。如果没有证据表明数据损坏，修复过程不得删除仍有效的身份、刷新凭据或 token。用户的 X 账户授权绝不可重复作为 Phoenix 专用账户授权。

## Diagnóstico rápido

| 症状 | 检查方式 |
| --- | --- |
| 安装按钮有效但没有打开认证 | 检查 xurl、Host 进程、Windows 浏览器及回调地址/TCP 8080 端口 |
| 回调页面被拒绝 | X Developers 中的 URI 必须与 xurl 实际使用的 URI 完全一致 |
| 401 / token 过期 | 在 xurl 中为正确的账户和应用重新授权 |
| `client-not-enrolled` | 检查 X API 计划和 Production 环境；这不是浏览器问题 |
| MCP 显示活动状态但无法读取数据 | 这仅证明进程与工具存在，不能证明 OAuth；必须实际读取一次 |

资料来源：[官方 xurl](https://github.com/xdevplatform/xurl)、[官方 X MCP](https://github.com/xdevplatform/docs/blob/main/tools/mcp.mdx)。
