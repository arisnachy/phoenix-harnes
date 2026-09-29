#!/usr/bin/env node
// Stable workspace/package bin target: pnpm links this file during install,
// before tsdown has emitted lib/bin.js. The compiled runtime remains the
// single implementation and exists before the command is executed.
await import('./lib/bin.js')
