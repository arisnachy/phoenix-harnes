import { defineConfig } from 'tsdown'

const base = {
  outDir: 'lib',
  format: ['esm'] as const,
  platform: 'node' as const,
  target: 'es2024',
  fixedExtension: false,
  outputOptions: { codeSplitting: false },
  dts: false,
  clean: false,
}

/** Build every published runtime subpath as a self-contained package artifact. */
export default defineConfig([
  { ...base, entry: ['lib/types/index.js'] },
  { ...base, entry: ['lib/types/invariant.js'] },
  { ...base, entry: ['lib/types/ledger.js'] },
])
