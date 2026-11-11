#!/usr/bin/env node
/** Windows/pnpm must be able to link this CLI before the TS build emits lib/bin.js. */
await import('../lib/bin.js')
