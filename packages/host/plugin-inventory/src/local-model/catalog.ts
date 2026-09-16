import type { LocalModelCatalogEntry, LocalRuntimeManifest } from './types.js'

const QWEN_35_4B_Q4_K_M: LocalModelCatalogEntry = Object.freeze({
  id: 'qwen3.5-4b-q4-k-m',
  displayName: 'Qwen3.5-4B Q4_K_M',
  modelFileName: 'Qwen_Qwen3.5-4B-Q4_K_M.gguf',
  sourceUrl: 'https://huggingface.co/bartowski/Qwen_Qwen3.5-4B-GGUF/resolve/main/Qwen_Qwen3.5-4B-Q4_K_M.gguf?download=true',
  sha256: '52d8d3e626382bddf8327cbdd71c08901cbd9d9b4879c9fb625d5d5903edf2e2',
  sizeBytes: 3_010_000_000,
  estimatedRamBytes: 4_500_000_000,
  contextWindow: 8192,
  maxTokens: 4096,
  recommended: true,
})

const WINDOWS_X64_LLAMA_CPP: LocalRuntimeManifest = Object.freeze({
  version: 'b10964',
  archiveName: 'llama-b10964-bin-win-cpu-x64.zip',
  sourceUrl: 'https://github.com/ggml-org/llama.cpp/releases/download/b10964/llama-b10964-bin-win-cpu-x64.zip',
  sha256: '3245342858a293854962cc631185ef56ba4cea943564ba32fb2bb24398958ff8',
  archiveSizeBytes: 64_672_927,
  executableRelativePath: 'llama-server.exe',
})

const LOCAL_MODEL_CATALOG: readonly LocalModelCatalogEntry[] = Object.freeze([
  QWEN_35_4B_Q4_K_M,
])

export const DEFAULT_LOCAL_MODEL_ID = QWEN_35_4B_Q4_K_M.id

export function getLocalModelCatalog(): readonly LocalModelCatalogEntry[] {
  return LOCAL_MODEL_CATALOG
}

export function getLocalModel(modelId: string): LocalModelCatalogEntry | undefined {
  return LOCAL_MODEL_CATALOG.find(entry => entry.id === modelId)
}

export function getRuntimeManifest(platform: string, arch: string): LocalRuntimeManifest | undefined {
  if (platform === 'win32' && arch === 'x64') return WINDOWS_X64_LLAMA_CPP
  return undefined
}
