import { defineConfig } from 'tsdown'

/** Emit each declared runtime export without introducing unpublished shared chunks. */
export default defineConfig(['lib/types/index.js', 'lib/types/invariant.js', 'lib/types/ledger.js'].map(entry => ({
  entry: [entry],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})))
