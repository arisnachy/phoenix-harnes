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
4. 使用 `mcp__browser__status`，然后使用 `mcp__browser__tabs`、`mcp__browser__navigate` 和 `mcp__browser__read_page`。

默认阻止修改页面的操作。只有在明确同意后才设置 `PHOENIX_BROWSER_ALLOW_ACTIONS=true` 来启用 `navigate`/`click_text`。`DSH_CHROME_*` 仅作为旧版兼容别名保留。

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

只有在连接器获得明确的操作批准后，`navigate` 和 `click_text` 工具才对模型可见。它们的结果报告请求的 URL 或点击结果，且不会包含凭据。

#### Token 影响

操作结果是简短状态消息；页面内容只有在单独调用 `read_page` 后才进入上下文。

#### KV Cache 影响

操作结果追加到工具记录，不会重写此前的系统提示词；后续 `read_page` 结果是独立的动态内容。

## 已知限制与暂缓事项

- 连接器需要用户启动的 CDP 会话，不提供浏览器程序、登录流程、截图捕获或任意 JavaScript 执行工具。
