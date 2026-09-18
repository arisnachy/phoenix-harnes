import { describe, expect, it } from 'vitest'
import { getLocalModelCatalog, getRuntimeManifest } from '../src/local-model/catalog.js'

describe('Phoenix Local catalog', () => {
  it('ships a revision-pinned Qwen3.5-4B Q4_K_M as the recommended model', () => {
    const model = getLocalModelCatalog().find(entry => entry.recommended)
    expect(model).toMatchObject({
      id: 'qwen3.5-4b-q4-k-m',
      displayName: 'Qwen3.5-4B Q4_K_M',
      modelFileName: 'Qwen_Qwen3.5-4B-Q4_K_M.gguf',
      sourceUrl: 'https://huggingface.co/bartowski/Qwen_Qwen3.5-4B-GGUF/resolve/ba06320255db2dbec194dad738d066be90dabf29/Qwen_Qwen3.5-4B-Q4_K_M.gguf?download=true',
      sha256: '13c16f426047e2de38cd075bdade4a7bcbc8c774384876f677740cda65f8a983',
      sizeBytes: 3013027808,
      contextWindow: 262144,
      maxTokens: 2048,
      recommended: true,
    })
  })

  it('pins the verified Windows x64 llama.cpp runtime', () => {
    expect(getRuntimeManifest('win32', 'x64')).toEqual({
      version: 'b10964',
      archiveName: 'llama-b10964-bin-win-cpu-x64.zip',
      sourceUrl: 'https://github.com/ggml-org/llama.cpp/releases/download/b10964/llama-b10964-bin-win-cpu-x64.zip',
      sha256: '917f39c076402c421224824607397af20f53625a60defc20e8dd22446bf4c5d7',
      archiveSizeBytes: 18427629,
      executableRelativePath: 'llama-server.exe',
    })
  })

  it('does not invent an unverified runtime for unsupported targets', () => {
    expect(getRuntimeManifest('freebsd', 'x64')).toBeUndefined()
  })
})
