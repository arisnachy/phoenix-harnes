import { describe, expect, it } from 'vitest'
import { getLocalModelCatalog, getRuntimeManifest } from '../src/local-model/catalog.js'

describe('Phoenix Local catalog', () => {
  it('ships Qwen3.5-4B Q4_K_M as the recommended model', () => {
    const model = getLocalModelCatalog().find(entry => entry.recommended)
    expect(model).toMatchObject({
      id: 'qwen3.5-4b-q4-k-m',
      displayName: 'Qwen3.5-4B Q4_K_M',
      modelFileName: 'Qwen_Qwen3.5-4B-Q4_K_M.gguf',
      sha256: '52d8d3e626382bddf8327cbdd71c08901cbd9d9b4879c9fb625d5d5903edf2e2',
      contextWindow: 8192,
      maxTokens: 4096,
      recommended: true,
    })
    expect(model?.sourceUrl).toContain('huggingface.co/bartowski/Qwen_Qwen3.5-4B-GGUF')
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
