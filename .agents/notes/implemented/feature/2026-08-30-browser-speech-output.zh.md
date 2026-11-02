# Agent Note: 浏览器原生语音输出

Status: implemented

[English](2026-08-30-browser-speech-output.md) | 中文

## 问题

PHOENIX 已能接受浏览器原生听写，但不能朗读已完成的智能体回复。

## 决策

当浏览器提供 SpeechSynthesis 和 SpeechSynthesisUtterance 时，智能体轮次操作显示朗读控件。适配器会在开始新朗读前取消排队内容，默认使用浏览器语言环境，提供明确的停止操作，并在操作行卸载时释放朗读。不会上传或持久化音频或转录内容。

## 考虑过的替代方案

**默认把回复文本发送到托管语音服务。** 这会为浏览器可本地提供的能力增加凭据、网络传输和同意界面。

**自动朗读每条回复。** 自动播放具有侵扰性，并且经常被浏览器的自动播放策略阻止，因此朗读保持为明确的用户操作。

## 后果

支持的浏览器可以免费本地朗读回复，并在失败后重试。不支持语音合成的浏览器保留现有操作行，但隐藏不可用的控件。跨浏览器离线语音和持久化音频导出仍是独立能力。

## 测试

`packages/client/ui-conversation/tests/speech-output.client.spec.ts` 验证能力检测、文本裁剪、语言选择、取消、生命周期隔离和错误恢复。`packages/client/ui-conversation/tests/speech-output.client.spec.tsx` 验证渲染的朗读和停止控件。聚焦的 conversation 套件通过了 4 个文件、125 个测试，ui-conversation TypeScript 程序通过。
