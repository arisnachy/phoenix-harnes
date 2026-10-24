# PHOENIX 中的 GitHub MCP：创建和配置个人令牌

[English](github-mcp.md) | 中文

GitHub MCP 允许 Kira 从 PHOENIX 查询代码仓库、提交、议题、拉取请求、版本发布和 GitHub Actions 工作流。

**它不是 GitHub Copilot。** GitHub Copilot 是独立的模型提供商。GitHub 官方远程 MCP 服务位于 `https://api.githubcopilot.com/mcp/`，但这个域名不代表必须通过 GitHub Copilot 登录。

## 1. 创建细粒度个人访问令牌

1. 打开 **[创建 GitHub 令牌（Fine-grained PAT）](https://github.com/settings/personal-access-tokens/new)** 并登录。
2. 在 **Token name** 中输入 `Phoenix GitHub MCP`。
3. 在 **Expiration** 中选择有限有效期，例如 **90 天**。
4. 在 **Resource owner** 中选择自己的账户，或允许你使用其仓库的组织。部分组织要求审批。
5. 在 **Repository access** 中选择 **Only select repositories**，仅勾选 PHOENIX 需要使用的仓库。
6. 在 **Repository permissions** 中仅授予必要权限：

   | 权限 | 初始设置 | 何时扩大 |
   |---|---|---|
   | **Metadata** | Read（自动） | 无需扩大 |
   | **Contents** | Read-only | 创建或修改文件时使用 Read and write |
   | **Issues** | Read-only | 创建或修改议题时使用 Read and write |
   | **Pull requests** | Read-only | 创建或修改 PR 时使用 Read and write |
   | **Actions** | 仅在需要查看 CI 和工作流时启用 Read-only | 只有管理运行任务时才扩大权限 |

   特定操作可能要求 GitHub 授予额外权限。只读工作不要授予写权限。
7. 点击 **Generate token**。请立即复制，GitHub 不会再次显示完整值。

## 2. 在 PHOENIX 中连接

1. 更新 PHOENIX 至支持 GitHub MCP PAT 的版本，并重启 Host。
2. 打开 **设置 → 连接器 → GitHub**。
3. 如果尚未安装，请点击 **安装 GitHub MCP**。
4. 点击 **配置 GitHub 令牌**，**只在 GitHub 卡片的密码字段**中输入令牌，不要发送到聊天。
5. 点击 **继续**。PHOENIX 会将令牌存入本地保险库，对应引用 `GITHUB_MCP_TOKEN`，然后重新连接服务器。`managed.patch.yml` **仅保存引用名称**，不会保存实际令牌。
6. 确认状态为**正常运行**，MCP 工具已经可用，并通过只读查询尝试列出自己的仓库。

## 3. GitHub 仍然无法连接时

- **令牌被拒绝（401/403）**：检查过期时间、资源所有者、获准访问的仓库、组织策略以及细粒度权限。
- **已连接但没有工具**：检查 MCP 运行时的真实状态，而非仅检查 `gh auth status`。GitHub CLI 与 GitHub MCP 是不同的连接途径。
- **OAuth 动态注册被拒绝**：更新 Host。GitHub 远程服务器不支持 DCR；PHOENIX 应使用 PAT 令牌流程，而不是请求不存在的 OAuth 页面。
- **`managed MCP patch row N is invalid`**：更新至能识别当前 GitHub PAT 配置的版本。不要删除配置文件或将其内容粘贴出来（其中可能包含敏感引用或设置）。
- **令牌被撤销或已过期**：再次使用 **配置 GitHub 令牌** 进行替换，然后检查工具是否重新连接。

## 安全

- 不要在聊天、截图、代码仓库、日志或共享链接中发布令牌。
- 优先使用仓库访问范围受限的**细粒度 PAT**。
- 在 [GitHub → Settings → Personal access tokens](https://github.com/settings/personal-access-tokens) 中查看和撤销令牌。
- **GitHub Copilot（模型）**的 OAuth 登录与**GitHub MCP（仓库）**的访问令牌完全不同。

官方参考：
- [GitHub：管理个人访问令牌](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- [GitHub MCP Server](https://github.com/github/github-mcp-server)
