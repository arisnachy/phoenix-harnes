# Phoenix Social Engine（v1）——自有账号和跨平台营销

[English](phoenix-social-engine.md) | 中文

该模块不会在缺少凭据或提供方回执时声称注册账号或完成发布。它提供与 runtime/staging 分离的、**可持久保存且可审计**的品牌、已声明/已验证资料、自然流量营销活动、UTM、草稿、审阅、排程、官方 API 发布以及不确定结果记录。

## 接口

- CLI：`pnpm social help` 或 `node scripts/phoenix-social.mjs help`。
- 测试：`pnpm test:social`。
- MCP：`social-engine`，本地 stdio 服务器，提供规划、身份、草稿和报告工具。可从设置安装经过审查的连接器，**安装不代表授权成功**。
- 数据文件：`~/.dsh/social-engine/social.json`（Windows：`%USERPROFILE%\.dsh\social-engine\social.json`），或 `PHOENIX_SOCIAL_HOME`；不属于 staging。

## Phoenix 的品牌身份

`pnpm social init` 只会为“Phoenix IA”创建声明性的 `phoenix` 品牌资料和透明简介，**不会创建外部账号**。对各个平台可调用 `pnpm social account-plan x`、`... instagram`、`... youtube`、`... facebook`、`... tiktok` 或 `... linkedin` 查看官方注册链接与条件。服务条款、邮箱/电话、验证码、2FA、OAuth 等步骤必须由真实账号所有者完成。Kira 不得伪造验证或冒充人类。

成功创建真实账号后，再登记用户或频道：

```powershell
pnpm social init
pnpm social account-plan x
pnpm social account-register phoenix x PhoenixMiMarca
pnpm social account-verify phoenix x
```

`account-register` 只是本地声明，不是连接；`account-verify` 会使用已授权的官方 API 验证确切身份。客户的账号必须属于不同品牌（`brand-create`），未经明确委托不得使用。

## 使用官方 API 发布

| 网络 | 当前支持 | 必要条件 |
| --- | --- | --- |
| X | 核验账号、文本/UTM 链接、真实发布 ID 和回执 | 有写权限的 OAuth user token；API 可能收费 |
| Facebook Pages | 验证页面、文本及链接 | Meta App、Page Token、`pages_manage_posts` |
| Instagram Professional | 核验并发布公网 HTTPS 图片 | 专业账户、`instagram_content_publish` 及容器/发布流程 |
| YouTube | 核验频道、最大 2 GiB 的可续传视频上传 | OAuth `youtube.upload`、配额、隐私设置及适用的审核 |
| TikTok | 规划，实际发布尚待实现 | `video.publish`、明确许可及 TikTok 应用审核 |
| LinkedIn | 规划，实际发布尚待实现 | 账号/页面与相关应用权限 |

当用户把代理 token 放在**可信本地进程环境**而非聊天中时，CLI 可使用 HTTP 适配器。相应变量：`PHOENIX_SOCIAL_X_USER_TOKEN`、`PHOENIX_SOCIAL_FACEBOOK_PAGE_TOKEN`、`PHOENIX_SOCIAL_FACEBOOK_PAGE_ID`、`PHOENIX_SOCIAL_INSTAGRAM_TOKEN`、`PHOENIX_SOCIAL_INSTAGRAM_USER_ID`、`PHOENIX_SOCIAL_YOUTUBE_ACCESS_TOKEN`。

**重要 MCP 限制：** MCP 进程使用 `scrubbedParentEnv()`，不会自动继承 Host 的令牌变量。在每个平台接入加密凭据 broker、且不把凭据交给模型之前，不得声称 MCP 具备真正发布能力。Kira 可使用 MCP 准备内容与跟踪；经授权的操作员通过 CLI 或已验证的其他发布连接器执行。`social_publish_approved` 与 `social_execute_due_approved` 在 broker 尚未接入时可能返回“OAuth 未连接”，不能因安装而标示成功。

## 真实营销活动示例

```powershell
pnpm social init
pnpm social campaign phoenix "Lanzamiento Phoenix" "https://ejemplo.com/producto"
pnpm social draft phoenix x "Conoce nuestro nuevo producto" --campaign ID
pnpm social posts
pnpm social show POST_ID
# Solo tras aprobación humana explícita, registrada por la interfaz de autorización:
pnpm social approve POST_ID --by "Responsable humano"
pnpm social schedule POST_ID 2026-11-01T14:00:00-04:00
pnpm social run-due
# El planificador propio del Host puede ejecutar luego "run-due --execute".
```

`approve --by` 只存储批准者声明，**不能代替** Kira 真正询问用户。立即发布需要 `publish POST_ID --confirm CHECKSUM`；计划队列只有执行 `run-due --execute` 才会发送。默认没有常驻定时守护程序，必须安装系统任务或使用现有调度器。

## 安全、成本、故障与限制

1. token 不写入 `social.json`；只在可信本地进程中通过环境传递，或使用 Host 凭据 broker，绝不打印秘密。
2. API 调用前先记录 `sending`；只有收到提供方真实 ID 才标记成功。报错/中断是 `uncertain`，重试前必须与提供方核对，避免重复发布。
3. 每个品牌/平台每日最多三条。禁止买粉、批量回复机器人、垃圾邮件及绕过平台控制。
4. 自然流量活动不等于付费广告；没有账号所有者的明确许可，不能投广告或花钱。
5. 不得编造浏览量、转化、销售额或 ROI。首版只确认官方发布 ID/URL，Insights 与商业对账尚待完善。
6. YouTube 上传可在授权条件下运行，但可续传字节级会话尚未持久化；发生故障应直接检查 YouTube。
7. Windows Host 需要更新并运行 Node；发布前要做 Node、MCP 控制器测试和 Host/Client 编译。

## 后续路线图

- 按平台支持 refresh 和 scopes 的 OAuth vault/broker，保留明确用户授权，同时避免让 MCP 继承敏感环境变量。
- 浏览器辅助注册流程记录 captcha/2FA 状态，由人完成平台强制步骤。
- 原生嵌入式日历、任务队列与发布预览。
- 经应用审核的 TikTok、LinkedIn，以及 Reels、Shorts 和轮播。
- 可核验 Insights、归因/转化与内容优化。
- 明确启用后，向文件库、邮箱或 Telegram 导出审批和营销报告。

## 参考来源

- X API：https://docs.x.com/x-api
- Instagram/Meta：https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api
- YouTube 上传：https://developers.google.com/youtube/v3/docs/videos/insert
- TikTok Direct Post：https://developers.tiktok.com/docs/en/content-posting-api-get-started

## X/Meta 连接与 Kira 自有身份注册（2026 年 10 月修复）

### X 的诊断

以下组件必须分别处理：

- `x-docs`：免费公共文档 MCP，不需要个人账号，只能访问文档。
- `x-api`：借助 `@xdevplatform/xurl` 和用户 OAuth 的官方 X MCP，与公共 MCP 注册表不同，可在设置 → 连接器 → X 中安装。
- `x-api-phoenix`：品牌自有 X 账号的**独立身份**；不能共用个人身份的 token。
- `social-engine`：Phoenix 自建的品牌、活动、草稿及身份验证服务器，与官方 X MCP 不同。

Windows 上通过带严格参数的 `cmd.exe /d /c npx` 启动官方 bridge，修复之前直接执行 `npx` 二进制的路径错误。X MCP 属于可选服务，因为开发者应用、OAuth、政策及费用可能影响可用性；安装不代表已认证。即使公共 MCP Registry 出错，也可以从固定卡片安装 X、Meta。

### Kira 创建品牌身份并准备自有账号

1. 调用本地 `social-engine` MCP 的 `social_phoenix_onboarding`，或在 CLI 执行 `pnpm social init`。
2. 引擎建立 `Phoenix IA` 品牌资料，并返回 X、Instagram、Facebook Page、YouTube、TikTok、LinkedIn 的官方注册入口。
3. Kira 可在用户指导下准备网页表单和透明的 AI 品牌说明；服务条款、所有者信息、邮箱/SMS、2FA、captcha 必须由真人处理。
4. 注册后运行 `social_account_register` 和 `social_account_verify`，只有官方 API 真正确认后才算已连接。
5. X 使用与个人 `x-api` 分离的 `x-api-phoenix`；Meta DevTools MCP 与 Graph 发布 token 是不同机制，后者需要已授权页面或 Instagram 专业账户。

当前 `social_phoenix_onboarding` 必须返回 `externallyCreated:0`：它**不**会谎称外部注册成功，亦不承诺自动完成 MFA。账号存在与所有权只有提供方核验后才能确认。

### 建议测试

```powershell
pnpm exec vitest run packages/host/plugin-inventory/tests/mcp-managed.spec.ts
pnpm exec vitest run packages/mcp/mcp-client/tests/platform.spec.ts
pnpm exec vitest run packages/client/ui-settings-models/tests/connector-catalog.client.spec.ts
pnpm test:social
pnpm exec tsc -b tsconfig.host.json
```

生产验收仍需 Windows、真实 X OAuth、Meta 权限与可用工具的端到端测试。单元测试或提交记录不能证明 Phoenix 已在外部社交网络创建品牌账户。

### Phoenix 内的安全 X OAuth 设置

在**设置 → 连接器 → X 用户账号 → 配置**中填写 **Client ID** 和 **Client Secret**，且仅在 Host 表单中填写。通过 `ctx.credentials.set()` 以 `X_CLIENT_ID`、`X_CLIENT_SECRET` 保存，不在响应中暴露，也不写入 MCP `managed.patch.yml`。

- **连接个人 X 账号**：安装 `x-api` 并在浏览器内完成该用户 OAuth。
- **连接 Kira 的品牌 X 账号**：仅在官方品牌账号真实创建后，填写真实 @用户名，单独安装 `x-api-phoenix`。可以使用同一个开发者 App，但代理身份和授权必须各自独立。
- `xurl` 的推荐回调为 `http://localhost:8080/callback`，须在 X Developer Console 中精确登记。首次连接通过浏览器进行 OAuth，填写配置本身不等于写权限生效。
- 创建账号始终需要真人所有者、邮箱/电话验证、服务条款与平台强制步骤；引擎可以辅助流程，不能伪造结果。
