# Phoenix Identity & Access Engine — V1

[English](phoenix-identity-access-engine.md) | 中文

## Propósito

Phoenix 的私有身份代理按照**精确的 HTTPS 来源地址**区分用户的个人身份与 Kira 的服务身份。不同域名和子域名绝不共享秘密。聊天中的受保护界面是唯一允许输入新凭据的地方；代理和 MCP 只能看到已经清理的结果。

## Flujo

1. MiniBrowser 检查网站是否需要登录。
2. 如果已有有效会话，则不打开 Secure Ask。
3. 如果会话已过期，则查询 `/phoenix-secure-login/status?origin=...`。
4. 选择活动身份（已有个人身份时默认 `personal`；只有 Kira 身份存在或用户明确选择它时使用 `kira`）。
5. 若该身份允许自动登录，Host 代理将使用加密保险库在同一标签页尝试登录。
6. 没有自动授权时，Secure Ask 展示可用身份，让用户选择已保存凭据或登记新的凭据。
7. 只有验证登录入口确实消失，才能关闭 Secure Ask；点击登录按钮本身不能证明已建立会话。
8. 进行中的任务与草稿不属于保险库，也不得因登录而作为附带操作被发送或重复执行。

## Almacenamiento

- 个人身份保留 `<sha256(origin)>.dpapi.json` 文件及原始熵值，以保障现有登录继续可用。
- Kira 使用 `<sha256(origin)>.kira.dpapi.json`，其 DPAPI 熵值与个人身份分离。
- 当前首选身份保存在 `<sha256(origin)>.primary.json`。
- 从旧保险库继承的凭据按个人身份读取。迁移不会自动删除旧凭据。
- 删除操作必须指定一个身份，绝不影响另一个身份。
- 秘密文件绝不提交到 Git，也不得经由模型传递。

## API privada del host

这些端点位于 `/phoenix-secure-login` 下，仅允许 localhost 使用，并要求受保护的请求头和有效请求来源。

- `GET /status?origin=...` 返回可用身份、登录能力与首选项，绝不返回密码。
- `POST /select` 根据标签页和来源保存用户选择的现有身份。
- `POST /save` 在选中的身份下保存新秘密。
- `POST /use` 尝试使用已保存且获授权的身份登录。
- `POST /delete` **只**删除指定身份。
- `POST /detect` 检查登录状态而不泄露字段内容。
- `POST /provision-eligibility` 在不创建账户的情况下检查先决条件。

## Creación de cuentas Kira

不得将已保存的身份等同于第三方网站实际创建的账户。V1 支持保存、使用已存在的 Kira 账户，并以受保护方式登记凭据。

此外，自主开通还需要具体网站适配器支持注册、用户事先明确授权、可验证的邮箱或身份，以及遵守该网站的服务条款。用户保持沉默**不等于**授权。金融、博彩或要求身份验证的网站不能通过本引擎自动注册。没有获准的适配器时，`provision-eligibility` 返回 `site-adapter-required`，不创建账户也不模拟成功。

## Criterios de aceptación

- 现有个人账户无需强制迁移即可继续使用。
- Kira 与个人身份同时存在，密码互不覆盖。
- 切换身份只能使用选中的凭据，不得使用另一个身份的凭据。
- 删除一个身份不会破坏另一个身份。
- 身份已经保存时，Secure Ask 不会显示空白输入界面。
- 未验证真实状态，不得宣布登录成功。
- 不得因等待超时或缺少同意而注册任何账户。
