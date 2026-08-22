import { defineConfig } from 'tsdown'

/**
 * The dsh CLI ships the `bin` referenced by package.json and the fork-owned
 * PHOENIX router exposed as a Loader plugin subpath.
 * Declarations come from `tsc -b` (dts: false), matching every package.
 */
export default defineConfig({
  entry: ['lib/types/bin.js', 'lib/types/phoenix-router.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
