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

### YouTube 视频分析与 MiniBrowser 可见性

`youtube_video_inspect` 可处理公开视频 URL 或已有的 `tabId`、JSON3/XML 字幕、最多 12 张真实 Chromium 截图（默认 6 张），以及 0–9 秒的可选音频样本（默认 8 秒）。字幕为空时，它尝试捕获真正的 Chromium 视频音轨并在本机识别语音。`youtube_video_listen` 用 `startSeconds` 与 `durationSeconds` 继续收听每段 3–9 秒的内容，返回有时间戳的文本与下一段起点。Kira 不得声称听过尚未处理的长视频部分。音频仅在临时目录保存、随后删除，不会发送给外部付费转录 API。受保护视频、浏览器禁止自动播放或缺少可捕获音轨时仍可能无法使用。无头 Chromium 保持系统声音静音，聊天中的可见播放器仅由用户点击启动。


### 本地语音引擎与验收

没有字幕时，Phoenix 在 PATH 中调用 `uv`，按需建立包含 `faster-whisper` 的隔离 Python 环境，首次使用时缓存 Whisper `base` 模型，后续复用。首次下载需要网络。可以用 `PHOENIX_VIDEO_WHISPER_MODEL=tiny|base|small` 调整模型，或通过 `PHOENIX_VIDEO_PYTHON` 指定已经配置好的 Python。用于浏览器导航和音频捕获的授权仍是 `PHOENIX_BROWSER_ALLOW_ACTIONS=true`。验收需要真实可读的截图、带时间戳的真实转录片段，或明确的错误代码，不应猜测私有或 DRM 视频内容。


### Video Engine 2.0：主动共享标签页与本地文件

当无头 Chromium 无法播放 YouTube、读取字幕或得到画面时，Kira 不应反复重试。用户在 MiniBrowser 点 **«Compartir pestaña para Kira»**，在 Chrome 自带的选择器中选中真正播放视频的标签，并启用 **Compartir audio**。授权后，浏览器通过 `getDisplayMedia` 和 MediaRecorder 最多录制 30 秒、24 MB 的 WebM。录制仅保存在用户本机私有临时目录，一小时后失效，旧文件在后续录制时清理。声音不会被发送至付费转录 API。随后 Kira 不传 `path` 调用 `video_media_inspect`，由 FFmpeg 抽取真实画面和音轨，Whisper 最多识别 90 秒内容。未分析片段不能推测。

`video_media_inspect` 还可以分析用户本人合法持有的 MP4/WebM/MOV/MKV 文件，但必须先用 `PHOENIX_VIDEO_ALLOWED_DIRS` 明确授权包含该文件的目录（Windows 使用分号分隔多个目录），不会从非授权目录读取媒体或下载 YouTube 视频。FFmpeg 使用 `PHOENIX_VIDEO_FFMPEG`、PATH 中的现有程序或通过 `uv` / `imageio-ffmpeg` 缓存安装。Whisper/FFmpeg 首次安装可能需要联网。分享音轨必须经 Chrome 原生权限窗口确认；受到 DRM 保护的内容仍可能无法捕获。

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
