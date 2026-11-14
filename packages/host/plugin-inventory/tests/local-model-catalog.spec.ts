import { describe, expect, it } from 'vitest'
import { getLocalModelCatalog, getRuntimeManifest } from '../src/local-model/catalog.js'

describe('Phoenix Local catalog', () => {
  it('recommends the existing CPU-friendly Ollama Qwen 2B and keeps native GGUF models selectable', () => {
    const catalog = getLocalModelCatalog()
    const model = catalog.find(entry => entry.recommended)
    expect(model).toMatchObject({
      id: 'qwen3.5-2b-ollama-q4-k-m',
      displayName: 'Qwen 3.5 2B Q4_K_M · Ollama',
      backend: 'ollama',
      ollamaModel: 'qwen3.5:2b-q4_K_M',
      contextWindow: 4096,
      maxTokens: 256,
      recommended: true,
    })
    expect(catalog).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'gemma-4-e2b-it-q4-0',
        backend: 'llama-server',
        sha256: '8e30dff3ac4c8434c49a7036fa15564bdbb6044e42bf04550bf1a096ad7e6a52',
        recommended: false,
      }),
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
