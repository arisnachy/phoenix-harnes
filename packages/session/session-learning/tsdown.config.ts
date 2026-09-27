import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'lib/types/index.js',
    invariant: 'lib/types/invariant.js',
    ledger: 'lib/types/ledger.js',
  },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
