# Phoenix Business Engine — 初始商业引擎

[Español](phoenix-business-engine.md) | 中文

**已实现的范围：** 独立于临时运行目录的持久本地商品库、通用商品、图书章节结构、文件 SHA-256、编辑准备度检查、真正的 EPUB3 编译（ZIP、目录、元数据和 XHTML）、Markdown 手稿、本地 HTML 画廊、商品清单草稿、MCP 候选工具分类及浏览器后备方案，以及**未验证**的申报收入记录。早期版本没有完整侧栏商城或自主 Amazon 发布器。绝不能把“准备好”当作“已发布”。

## 运行方式

```bash
node scripts/phoenix-business.mjs help
node scripts/phoenix-business.mjs init book "Mi primera novela"
node scripts/phoenix-business.mjs list
node scripts/phoenix-business.mjs chapter ID 1 path/to/capitulo-1.md
node scripts/phoenix-business.mjs asset ID path/to/ebook.epub --role ebook
node scripts/phoenix-business.mjs check ID --chapters 24 --words 60000
node scripts/phoenix-business.mjs compile ID --author "Nombre real" --chapters 24 --words 60000
node scripts/phoenix-business.mjs route amazon-kdp --tools mcp__servidor__publicar,mcp__servidor__buscar
node scripts/phoenix-business.mjs prepare ID amazon-kdp 4.99 --currency USD
node scripts/phoenix-business.mjs gallery
node --test scripts/phoenix-business.test.mjs
```

`gallery` 位于 `~/.dsh/business-library/gallery.html`（Windows 为 `%USERPROFILE%\.dsh\business-library\gallery.html`）。`library.json` 持久保存商品和文件引用，使用原子写入及文件锁。商品目录为 `products/ID/`；可用 `PHOENIX_BUSINESS_HOME` 配置其他持久路径。注册的资产被复制到库中，不再依赖原始临时路径。所有内容默认保存在本地；上传 Google Drive 需要单独授权。

## 商业路由

1. 在现有目录发现 MCP 服务，检查 `ready` 状态和 API 真正的写入能力。`mcp-candidate` 仅表示名称看似兼容，**不**证明授权或成功。
2. 检查工具 schema 和商店政策。如果无可用集成，可考虑带用户登录和密钥库的内嵌浏览器，但绝不能绕过平台安全机制。
3. 校验文件格式、商品资料、权利和 AI 生成声明。`prepare` 不会调用外部交易。
4. 发送商品、发布、购买广告或签订合约前必须得到用户的交互式明确批准，并保留平台的真实凭证。
5. 基于来源可靠的数据记录访问量、订单、版税和净利润。`sale` 最初只是**未经平台验证**的观察记录。

## Phoenix 界面中的“我的图书馆”（Business Studio 分支）

Phoenix 在插件设置中显示真实持久商品库。它通过 `pluginInventory.businessLibrary` 获取 Host 的只读、过滤后投影，提供搜索、筛选、章节计数、文件、编辑计划及编译新旧状态。浏览器只接收**清理过的元数据**，绝不接收本地路径、订单、密码或手稿正文。结果限制为 300 项，并拒绝不合法的索引。这属于可用的只读集成，**不是**公开商城，也不是已成交的证明。

## 有意保留的限制和后续集成

- 早期 `compile` 生成结构上经本地测试的 EPUB3，但不是完成的封面、DOCX 或最终 PDF。需要 Kindle Previewer、排版和编辑检查。后续迭代增加了 DOCX 和打印用 HTML，仍未自动生成经过真实分页检查的 PDF。
- `check` 检查篇幅和结构，无法证明文风、叙事连续性、原创性、实际 PDF 页数或印刷质量。
- `prepare amazon-kdp` 要求章节、封面及 EPUB/DOCX/KPF，并保留待审核状态；必须通过受控适配器实现 KDP 上传，不可模拟成功。
- 初始 HTML 画廊可以打开；原生 Phoenix 集成需要安全本地网关和连接到 Host 存储的客户端视图（后续 Business Studio 版本已实现只读视图）。
- 开启商店前须完成真实对账、权限审计、广告支出控制、税务、国家与收款方式。
- 在提升到稳定分支前，必须通过 Windows 和整个 monorepo 的 CI，而不只是独立 Node 测试。

Kira 的操作指南位于 `.agents/skills/phoenix-business/SKILL.md`，使用默认配置从仓库运行 Phoenix 时可被本地技能提供器发现。

## `feat/business-engine-studio` 迭代 — 编辑计划与可追溯性（不发布）

版本引入 `scripts/phoenix-business-studio.mjs`，保留版本 1 商品库兼容性，并在验证过程中不修改 `main`/`stable`。

```bash
node scripts/phoenix-business.mjs blueprint PRODUCT_ID path/to/plan.json
node scripts/phoenix-business.mjs progress PRODUCT_ID
node scripts/phoenix-business.mjs compile PRODUCT_ID --author "Nombre del autor" --chapters 24 --words 60000
node scripts/phoenix-business.mjs audit PRODUCT_ID
```

- **持久编辑蓝图：** 需要 `schemaVersion: 1`、`premise`、`audience`、`genre`、`targetWords`、`characters` 及具有 `number`、`title`、`purpose`、`targetWords`、`beats` 的章节；可选 `series`、`worldRules`、`timeline`。章节目标总和允许偏离总目标 15%；系列续作可保留人物设定和时间线，但不能虚构一致性验证。
- **可审计进度：** 识别缺失、篇幅不足的章节、实际字数及已过期的编译。单章达到目标 85% 是管理规则，不代表文学质量。
- **改进的编译：** 真正的 EPUB3、Markdown、WordprocessingML DOCX 和适合 6×9 英寸版式的 HTML 印刷内页。必须使用外部排版引擎检查页码、字体和出血，**不能**声称已生成分页正确的 PDF。
- **完整性审计：** 对章节和文件验证 SHA-256，发现修改并提醒尚需版权、文风、原创性人工审核。文件损坏时 `prepare` 标记为 `integrity-failed`。不会发布、模拟商店 MCP 或伪造销售。
- **测试：** `pnpm test:business` 运行无网络的 Node 测试；提升分支前还需整个仓库的 CI 和 Windows 桌面验证。

这一阶段仍是用于原生商品库 UI、市场机会研究、PDF/封面、获授权的店铺 MCP，以及真实销售对账的基础。拥有 EPUB/DOCX 不代表商品已经合格。

## 受控商业队列（仅准备阶段）

`scripts/phoenix-business-commerce.mjs` 保存独立、持久的发布草稿队列；**不发布**、不调用真实商店、不投放广告，也不宣称验证收入。命令：

```bash
pnpm business:commerce plan PRODUCTO_ID amazon-kdp
pnpm business:commerce plan PRODUCTO_ID shopify
pnpm business:commerce list
pnpm business:commerce inspect pub-ID
pnpm business:commerce cancel pub-ID
pnpm business:commerce route shopify --inventory mcp-snapshot.json
pnpm test:commerce
```

- `plan` 需要 `review-required` 清单、完整且未被修改的文件、合法价格及货币，KDP 电子书还需 EPUB、封面和当前编辑编译。50,000 字及 15 章是 **Phoenix 内部保守阈值，并非 KDP 政策**；应由项目配置。
- 系统使用清单 SHA-256 标识版本。同一版本重复请求会复用工作；取消后可创建新的；`inspect` 会再次检查文件、章节和价格。
- `publication-queue.json` 与 `library.json` 一同保存在持久目录，使用文件锁及原子写入。对外的工作摘要不携带本地路径、手稿正文、买家资料或凭据。
- `route` 可以读取 `pluginInventory.mcpConnectorHubState` 的目录快照；`ready` 加上工具名称只代表**MCP 候选项**，绝非授权或发布成功。没有候选项时建议内嵌浏览器，但不自动开启或操作。
- 工作止于 `awaiting-approval`；没有 `publish` 或 `submit` 命令。要真正发布，还需 Host 的交互式批准、真实 API 或经过认证的浏览器，以及远端凭证。这个状态绝不能记作收入。

`node --test scripts/phoenix-business-commerce.test.mjs` 覆盖幂等性、取消、变价、文件变更、符号链接、索引结构、路径和 MCP 发现。完整 CI、Windows 和真实发布的端到端测试仍属于独立验收要求。

## 通用 Product Factory — 按类别验证商品（开发阶段）

命令：`pnpm business:factory catalog`、`pnpm business:factory plan ID`、`pnpm business:factory check ID --platform direct`、`pnpm business:factory package ID --platform direct`、`pnpm business:factory metrics ID`。初步支持 `book`、`course`、`software`、`game`、`design`、`research`、`video`、`audio`、`service` 和 `other`，并可登记服务类商品。

各类有明确必需角色、扩展名和文件数量：课程要求大纲、三节课及考核；应用要求代码、安装包和文档；游戏要求工程、构建产物及预览；研究要求报告、方法和来源；影音要求最终媒体及无障碍材料；服务要求提案、范围和履约材料。系统验证资产 SHA-256、无符号链接的安全路径、PDF/ZIP/PNG/MP4 等文件头，以及真实章节数。这**不能替代**软件运行测试、学术质量、人工编辑、版权审查或平台合规。

`package` 仅在 `business-library/releases/ID/` 构建包含 `manifest.json`、哈希和实际资产的可复用 ZIP，并检测既有发布包是否遭修改。清单固定 `externalPublished=false`、`salesVerified=false`、`commerciallyApproved=false`；不能含凭据、订单正文或绝对路径。发布、支付及营销活动仍需要人工审查与批准。`metrics` 区分申报数额和确实有远端凭证的金额；`direct` 仅表示本地打包发行，**不是**已售出。

`business:commerce plan ID PLATAFORMA` 在接受草稿前调用 Product Factory 的结构检查，不能只靠一个看似真实的 `source` 文件通过。不应把尚未开发的八类全自动生成流程、商店发布适配器或银行对账标成已完成。结构测试使用 `pnpm test:business`；整个仓库、Windows 和真实商业交易测试仍待验收。

## Kira 原生工具 — 意图和当前 MCP（开发阶段）

`@phoenix-ai/dsh-tool-business` 作为 `tool-business` 安装到基础 bundle，通过 `business_plan_mission` 暴露给代理。每次调用都从 Host 的 `mcpConnectors` 读取状态和公开工具名称，识别九类商品以及研究、创建、验证、打包、发布、推广和分析阶段。它不调用连接器，也不泄漏凭据。

`ready` 连接器只是一项候选，不意味着具备发布权。任何真正的经济操作都要检查 schema、身份认证及用户许可。内嵌浏览器是可能的后备路线，而不是已存在的已登录会话。目标测试命令为 `node --experimental-strip-types --test packages/core/tool-business/tests/mission.test.mjs`，包含在 `pnpm test:business` 中。UME 执行、完整发布、Windows/CI 和收入对账仍需验证。

## 首个真实店铺 API 适配器：Shopify（草稿，不是公开销售）

`scripts/phoenix-business-shopify.mjs` 导出 `createShopifyDraft(settings, product, {approval,fetchImpl})` 和 `inspectShopifyDraft(...)`。它使用 Shopify Admin GraphQL `2026-10`、`status:DRAFT` 的 `productCreate`、`productByIdentifier` 读取，以及绑定确定性 handle 的 SHA-256 商品版本。响应不确定时不会自动重复变更；拒绝非 `*.myshopify.com` 域名、验证返回的 ID，并从不记录或返回 token。

**授权与凭据：** 该模块不是发布 CLI。只有可信 Host 可以从 vault 将当前会话 token 注入，并且必须在 Host 边界验证交互式批准；`approval.granted === true`、`approval.action === 'shopify:create-draft'`、`approval.productId` 和 `approval.revision` 必须与请求完全一致。这个对象只是输入凭证，**本身不是独立的密码学证明**；任何用户输入或子代理都不得伪造它。不能将其授予自主模型权限。没有经过验证的 Host 时，队列保持 `awaiting-approval`，禁止变更。测试采用模拟传输，并未接入真实商店。

**重大限制：** DRAFT 不包含价格、公开发布、数字交付、支付、税务或已验证订单。生产环境需要有权限的 Host 适配器、账户配置、商品变体和价格、媒体、销售渠道、交付、远端收据和真实对账。不能把 `created:true` 当作上线或收入。公开前须在经过认证的开发店铺测试。官方 `productCreate` 需要 `write_products` 权限，公开商品另需独立步骤和权限。技术资料：https://shopify.dev/docs/api/admin-graphql/latest/mutations/productCreate

`pnpm test:shopify` 执行六项本地测试：权限、数据格式、防重复、对账、不确定错误和只读查询。这些测试不能替代使用真实认证店铺的端到端测试。
