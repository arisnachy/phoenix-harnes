# PHOENIX 浏览器连接器

[English](README.md) | 中文

本地 MCP 服务器，用于连接用户通过 Chrome DevTools Protocol（CDP）明确暴露的 Chrome 或 Microsoft Edge 会话。

## 启用

1. 使用与个人账户分离的浏览器实例和配置文件。
2. 使用以下任一命令启动 Chrome 或 Edge：

```powershell
chrome.exe --remote-debugging-port=9222 --user-data-dir="$env:TEMP\phoenix-chrome-profile"
msedge.exe --remote-debugging-port=9223 --user-data-dir="$env:TEMP\phoenix-edge-profile"
```

3. 将 `examples/mcp-chrome.cordis.yml` 作为 PHOENIX overlay 加载。
4. 常规检查可使用 `mcp__browser__status`、`mcp__browser__tabs`、`mcp__browser__navigate` 和 `mcp__browser__read_page`。对于“打开 YouTube 并搜索海绵宝宝”这类简单请求，只需调用一次 `youtube_search`（`query="海绵宝宝"`），然后展示结果。

默认阻止修改页面的操作。只有在明确同意后才设置 `PHOENIX_BROWSER_ALLOW_ACTIONS=true` 来启用 `navigate`、`click_text` 和 `youtube_search`。`DSH_CHROME_*` 仅作为旧版兼容别名保留。

连接器不会读取配置文件、cookies 或密码。必须由用户明确启用 CDP；普通浏览器标签不能被另一个进程自动接管。

## 模型体验

### 浏览器会话检查

#### 模型看到的内容

`status`、`tabs` 和 `read_page` 工具只暴露已连接的浏览器端点、可见标签元数据和有界的页面可见文本。Cookie、密码、配置文件和浏览器存储不会进入模型请求。

#### Token 影响

`tabs` 和 `status` 返回简短元数据；`read_page` 最多加入请求的 `maxChars` 个可见文本字符及一个小型 JSON 外壳。

#### KV Cache 影响

每个工具结果都是新的模型可见结果。此前的页面文本会保留在对话历史中，直到会话压缩或用户开始新回合。

### 浏览器导航与点击

#### 模型看到的内容

`navigate`、`click_text` 和 `youtube_search` 均受已配置的浏览器操作权限约束。`youtube_search` 生成 YouTube 搜索结果 URL，执行一次导航并仅检查一次标签元数据；结果明确区分最终 URL 已验证与仅启动导航。它不会自动选择或播放视频，也不会访问凭据。

#### Token 影响

操作返回简短状态；`youtube_search` 会直接返回有界的 URL 确认结果，无需额外调用 `read_page`。只有明确需要页面内容时才调用 `read_page`。

#### KV Cache 影响

操作结果追加到工具记录，不会重写此前的系统提示词；后续 `read_page` 结果是独立的动态内容。

## 已知限制与暂缓事项

- 连接器需要可用的 Chromium CDP 会话（已配置的本机端点或自动启动的独立 Chrome/Edge 配置文件）。它不提供浏览器安装程序、登录流程、截图捕获或任意 JavaScript 执行工具。
