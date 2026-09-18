import { describe, expect, it } from 'vitest'
import { getLocalModelCatalog, getRuntimeManifest } from '../src/local-model/catalog.js'

describe('Phoenix Local catalog', () => {
  it('ships revision-pinned Gemma 4 E2B as the recommended default and keeps Qwen selectable', () => {
    const catalog = getLocalModelCatalog()
    const model = catalog.find(entry => entry.recommended)
    expect(model).toMatchObject({
      id: 'gemma-4-e2b-it-q4-0',
      displayName: 'Gemma 4 E2B-it Q4_0',
      modelFileName: 'gemma-4-E2B-it-Q4_0.gguf',
      sourceUrl: 'https://huggingface.co/ggml-org/gemma-4-E2B-it-GGUF/resolve/64ef033dc9f85a88f88e70cceb0a7457366bea64/gemma-4-E2B-it-Q4_0.gguf?download=true',
      sha256: '8e30dff3ac4c8434c49a7036fa15564bdbb6044e42bf04550bf1a096ad7e6a52',
      sizeBytes: 2841481184,
      contextWindow: 131072,
      maxTokens: 2048,
      recommended: true,
    })
    expect(catalog).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'qwen3.5-4b-q4-k-m',
        displayName: 'Qwen3.5-4B Q4_K_M',
        contextWindow: 262144,
        maxTokens: 2048,
        recommended: false,
      }),
    ]))
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
