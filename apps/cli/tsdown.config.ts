import { defineConfig } from 'tsdown'
import { fileURLToPath } from 'node:url'

/**
 * The dsh CLI ships one entry: the `bin` referenced by package.json `bin`.
 * The root tsdown builds only `lib/types/index.js`, so this override points at
 * `lib/types/bin.js` instead; its reachable mode modules bundle with it.
 * Declarations come from `tsc -b` (dts: false), matching every package.
 */
export default defineConfig({
  entry: ['lib/types/bin.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  // Emitted lib/types files retain this source-relative JavaScript import.
  // Bundle the one shared helper into the CLI instead of copying it into profiles.
  alias: {
    '../../../scripts/phoenix-git-safe-directory.mjs': fileURLToPath(new URL('../../scripts/phoenix-git-safe-directory.mjs', import.meta.url)),
  },
})
