# 预制生成式 UI 组件

[English](README.md) | 中文

这些组件是 Hema Surya 在 [react-generative-ui v0.4.6](https://github.com/hemasurya106/react-generative-ui) 发布的预设计 React 组件与模式的副本。原始版权声明保留，遵循 MIT 许可证。这种做法延续上游 `npx react-generative-ui add`（类似 shadcn）的源码归属模式，保持 React 18 兼容，不要求升级 npm 包或 Tailwind。应当另外适配 Phoenix 集成，绝不执行模型生成的代码。

视觉模板 JSX 来源于上游。此处的内置适配有意移除了其 Zod 导入和元数据模式：Phoenix 已通过 `parseCanvasSpec` 验证每份声明式输入，并且必须与固定的 pnpm 锁文件兼容。Props 均有明确类型声明，以维持静态类型安全。
