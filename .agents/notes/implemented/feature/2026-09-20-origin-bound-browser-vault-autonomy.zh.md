# Agent Note: 按 origin 绑定的浏览器 Vault 自主能力

Status: implemented

[English](2026-09-20-origin-bound-browser-vault-autonomy.md) | 中文

## 问题

PHOENIX 已经能够在模型上下文之外保存人工输入的机密，也已经能够控制 Windows 桌面和内嵌浏览器，但这两种能力之前没有连通。重复执行的已授权任务一旦遇到登录或表单，要么再次依赖人工操作，要么有把凭据经过模型可见文本传递的风险。反复出现的审批提示也让定时表单、报表等工作无法真正表现为持久数字员工。

## 决策

凭据 seam 新增 `normalizeCredentialOrigin()` 与 `originCredentialRef()`。远程无人值守凭据绑定到规范化 HTTPS origin；本地开发允许回环地址 HTTP。`/secret login-set <origin> <account> <secret>` 会保存三个按 origin 派生的引用：account、secret 和 `autonomous` 标记。该命令继续保持仅人工可用并设置 `recordInput: false`，因此 account 与 secret 都不会进入持久命令事件或模型请求。

Windows `computer` 继续作为唯一面向模型的浏览器/桌面能力，而不是再引入第二套自动化栈。它新增结构化的 `browser_inspect`、`browser_fill_form`、`browser_click_text` 与 `browser_login`。模型只提供预期 origin 与普通非机密表单值。`browser_login` 会在真正使用前于内部从 `ctx.credentials` 解析 account/secret，并只通过 Phoenix Desktop 的 CurrentUserOnly named pipe 发送给 WebView2；模型永远拿不到真实值。

原生 Desktop 解析器默认拒绝来自 Phoenix 页面 bridge 的自动化命令；只有受信任 named-pipe 路径显式允许这些命令。runtime broker 与 WebView 脚本都会在 DOM 修改前再次核对实时 origin，从而关闭 host 检查与 DOM 注入之间的导航竞态。`browser_inspect` 永不返回输入框当前值；通用填表动作拒绝 password 与 file 字段，让机密和本地文件路径继续留在专用 broker 后面。

按 origin 保存的 `autonomous` 标记同时代表对该精确 origin 的一次性无人值守授权。在 workspace-write 下，该 origin 的高层 open/login/form/click 动作不再让已授权重复任务每一步都打断用户。其他 Computer Use 动作继续沿用原有 sandbox/审批规则；danger-full-access 仍是明确的全局 no-prompt 模式。

## 验证

凭据单元测试固定验证 HTTPS/回环规范化、防碰撞 origin 引用、命令日志脱敏、自主登录的登记/状态/删除以及不安全远程 origin 的拒绝。Computer Use 测试固定验证新动作 schema、浏览器命令映射、动作后截图策略以及 inspection 的只读属性。原生 Desktop 合约测试固定验证页面 bridge 默认不能调用自动化、named pipe 显式允许时可以调用、origin 规范化、表单解析、登录解析与不安全 origin 拒绝。PR CI 继续作为 TypeScript、.NET 编译及仓库级检查的集成门禁。

## 考虑过的替代方案

**给模型暴露读取密码的工具。** 拒绝，因为 prompt injection、会话记录、遥测路径或模型供应商都可能因此接触机密。

**通过独立 Chrome MCP connector 传递 vault 值。** 拒绝，因为这会增加新的进程/RPC 机密边界，同时重复现有原生 `computer` 浏览器能力。

**为定时任务全局关闭审批。** 拒绝，因为一个站点的重复登录不应该无声扩大到其他应用或 origin 的桌面权限。

**所有表单都靠坐标输入。** 只保留为后备路径。结构化 DOM 操作更快、更稳定，减少截图与模型轮次成本，并能确定性执行 origin 和受保护字段规则。

## 影响

完成一次显式登录登记后，已授权的重复 Phoenix 任务可以重新打开站点、检查当前表单、认证、填写非机密字段、点击/提交并验证可见结果，而无需反复向用户索要已保存凭据或相同的逐步批准。MFA、CAPTCHA、过期凭据、页面发生实质变化，或超出先前任务授权的新决策，仍可能需要恢复流程或人工介入。本功能没有更换底层本地凭据 provider；其现有主机存储保护要求仍然适用。
