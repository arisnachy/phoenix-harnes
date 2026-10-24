# Phoenix Design Intelligence — 运行参考

## 范围

该功能通过现有 Phoenix 引擎协调 Canva MCP 和本地设计工具，记录真正的 Canva 设计、保存导出文件副本并验证完整性。它不包含独立的 Canva 客户端、第三方发布器或可视化编辑器。Kira 的操作流程参见 [技能文件](../.agents/skills/phoenix-design-intelligence/SKILL.md)。

## CLI

- plan：识别图书、漫画、研究、教育、目录、品牌、营销和视频请求；列出真实 MCP 功能与阻碍。
- start：在 ~/.dsh/design-intelligence/jobs/JOB/manifest.json 新建持久任务；不调用外部工具，也不保存密钥。
- link：记录真实工具回应提供的 Canva 设计 ID 和 URL；链接并不意味着已导出。
- export：验证文件扩展名、签名、大小和 SHA-256，并复制到 jobs/JOB/artifacts。不会自动验证排版、内容或版权。
- inspect：重新检查持久文件，报告文件丢失或被修改的情况。

~~~bash
node scripts/phoenix-design-intelligence.mjs plan --request "Crea una portada"
node scripts/phoenix-design-intelligence.mjs start --request "Genera un catálogo"
node scripts/phoenix-design-intelligence.mjs inspect JOB
node --test scripts/phoenix-design-intelligence.test.mjs
~~~

可以通过 --inventory runtime-mcp.json 提供只包含 serverName、status 和 toolNames 的 MCP 清单。绝不将 token、cookie、账户密码或其他密钥加入该文件。通过 PHOENIX_DESIGN_HOME 可以指定持久存储目录。

## 状态与限制

任务的初始状态为 pending；link 将其变为 design-linked-unverified；export 将其变为 export-signature-verified；若文件丢失或校验失败，inspect 报告 integrity-failed。这些状态均不代表公开发布、成功销售、图像质量合格或拥有商业使用许可。

Canva 服务器处于 ready 状态不代表当前账号拥有 Pro 功能、剩余额度或修改权限。autofill_design 只能在字段结构和权限已经得到验证时使用。若当前 MCP 未提供导出功能，必须采用经过确认的其他导出方式，而不能伪造文件。

仍需要后续实现：原生聊天状态界面、可用时的 Canva 导出适配器、完整的页面视觉检查、批处理以及经过真实授权账号验证的端到端测试。
