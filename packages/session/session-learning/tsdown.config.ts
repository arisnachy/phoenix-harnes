import { defineConfig } from 'tsdown'

/** Emit each declared runtime export without introducing unpublished shared chunks. */
export default defineConfig(['index', 'invariant', 'ledger'].map(name => ({
  entry: [`lib/types/${name}.js`],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})))
