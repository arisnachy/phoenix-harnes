# Agent Note: Video Engine 经授权的标签页录制与本地媒体分析

Status: implemented

[English](2026-10-12-video-engine-authorized-tab-capture.md) | 中文

## Problem

YouTube 有时拒绝在隔离、静音的 Chromium CDP 标签中播放。字幕为空、无法解码视频画面，以及页面内 `video.captureStream()` 超时后，Kira 只得到标题等元数据。重复调用已失败的播放器或延长超时，仍然不能产生真实的视听内容。

## Decision

Phoenix 保留受约束的 YouTube 字幕读取，同时增加另一条**由用户授权的标签页录制通路**。MiniBrowser 提供 `Compartir pestaña para Kira` 按钮；点击后通过 Chrome 原生 `getDisplayMedia` 选择器，让用户选择真正播放视频的标签页并明确启用音轨共享，而不是在后台自动录屏。MediaRecorder 最多录制 30 秒 WebM，上传限制 24 MB。仅允许本机同源请求的 MiniBrowser 端点拒绝非法和过大的文件，并以 UUID 命名写入私有临时目录。一小时后录制过期，后续录制时清理旧文件。Kira 不得自动选择其他标签页或录制私人会话。

Chrome 连接器新增 `video_media_inspect`，可处理最近一次有效的用户录制，或者父目录经 `PHOENIX_VIDEO_ALLOWED_DIRS` 明确授权的本地视频。解码使用 PATH、`PHOENIX_VIDEO_FFMPEG` 或通过 `uv`/`imageio-ffmpeg` 缓存的 FFmpeg。最多提取八张带时间戳的 JPEG 帧，将音轨转为单声道 WAV 并用本地 `faster-whisper` 转录。既有语音识别逻辑被拆分为可复用的本地文件转录函数。模型只接收经验证的画面和有时间戳的文字；原始音频仍留在本机，临时 WAV 会删除。

如果 YouTube 内置播放器失败，Kira 应请求用户通过原生 Chrome 选择器授权捕获，然后使用 `video_media_inspect`，而不是反复尝试或猜测无法访问的内容。

## Alternatives considered

拒绝不受限制地下载或抓取第三方流媒体，因为这可能绕过服务限制和内容授权。拒绝在没有用户操作时自动录制 Chrome 标签页，因为这侵犯隐私和浏览器授权。拒绝重复录制已经失败的无头播放器，因为不存在可解码的音轨。拒绝自动开放本地文件系统，必须使用目录白名单。

## Consequences

标签页录制需要用户参与，Chrome 原生窗口必须允许音轨共享，DRM 保护内容依然可能失败。独立的本地媒体工具可分析用户授权的 MP4/WebM/MOV/MKV，无需 YouTube 播放器；首次设置 FFmpeg/Whisper 环境可能需要联网。Web 应用和 MCP 连接器须共享同一操作系统临时目录。本方案不安装 Chrome 扩展，也不会未经同意在后台录制标签页。

## Verification

单元测试检查请求授权边界、WebM 容器头和大小限制、确定性帧时间戳与本地文件目录授权。CI 仍需通过类型检查和包级测试；Windows 上实际 Chrome 选择器、YouTube 播放、FFmpeg 和 Whisper 端到端仍需人工验收。标题或看似有效的 JPEG 不是视频转录证据，必须得到可解码真实画面以及有时间戳的非空识别语音，否则明确报告限制。
