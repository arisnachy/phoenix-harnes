# Prebuilt Generative UI components

These are copies of the predesigned React components and schemas published in [react-generative-ui v0.4.6](https://github.com/hemasurya106/react-generative-ui), by Hema Surya. Original copyright is retained; used under the MIT license. This follows the upstream `npx react-generative-ui add` (shadcn-style) source-ownership approach, keeping React 18 and requiring no npm package or Tailwind upgrade. Adapt integration in Phoenix separately; do not execute model-generated code.

The visual template JSX originates upstream. Its Zod imports and metadata schemas are deliberately removed in this vendored adaptation: Phoenix already validates every declarative input through `parseCanvasSpec` and must remain compatible with its immutable pnpm lockfile. Props are explicitly typed to preserve static safety.
