import type { LocalModelCatalogEntry, LocalRuntimeManifest } from './types.js'

const GEMMA_4_E2B_IT_Q4_0: LocalModelCatalogEntry = Object.freeze({
  id: 'gemma-4-e2b-it-q4-0',
  displayName: 'Gemma 4 E2B-it Q4_0',
  modelFileName: 'gemma-4-E2B-it-Q4_0.gguf',
  sourceUrl: 'https://huggingface.co/ggml-org/gemma-4-E2B-it-GGUF/resolve/64ef033dc9f85a88f88e70cceb0a7457366bea64/gemma-4-E2B-it-Q4_0.gguf?download=true',
  sha256: '8e30dff3ac4c8434c49a7036fa15564bdbb6044e42bf04550bf1a096ad7e6a52',
  sizeBytes: 2_841_481_184,
  estimatedRamBytes: 6_000_000_000,
  contextWindow: 131_072,
  maxTokens: 2_048,
  recommended: true,
})

const QWEN_35_4B_Q4_K_M: LocalModelCatalogEntry = Object.freeze({
  id: 'qwen3.5-4b-q4-k-m',
  displayName: 'Qwen3.5-4B Q4_K_M',
  modelFileName: 'Qwen_Qwen3.5-4B-Q4_K_M.gguf',
  sourceUrl: 'https://huggingface.co/bartowski/Qwen_Qwen3.5-4B-GGUF/resolve/ba06320255db2dbec194dad738d066be90dabf29/Qwen_Qwen3.5-4B-Q4_K_M.gguf?download=true',
  sha256: '13c16f426047e2de38cd075bdade4a7bcbc8c774384876f677740cda65f8a983',
  sizeBytes: 3_013_027_808,
  estimatedRamBytes: 8_500_000_000,
  contextWindow: 262_144,
  maxTokens: 2_048,
  recommended: false,
})

const WINDOWS_X64_LLAMA_CPP: LocalRuntimeManifest = Object.freeze({
  version: 'b10964',
  archiveName: 'llama-b10964-bin-win-cpu-x64.zip',
  sourceUrl: 'https://github.com/ggml-org/llama.cpp/releases/download/b10964/llama-b10964-bin-win-cpu-x64.zip',
  sha256: '917f39c076402c421224824607397af20f53625a60defc20e8dd22446bf4c5d7',
  archiveSizeBytes: 18_427_629,
  executableRelativePath: 'llama-server.exe',
})

const LOCAL_MODEL_CATALOG: readonly LocalModelCatalogEntry[] = Object.freeze([
  GEMMA_4_E2B_IT_Q4_0,
  QWEN_35_4B_Q4_K_M,
])

/** Stable id of the model Phoenix Local selects on first use. */
export const DEFAULT_LOCAL_MODEL_ID = GEMMA_4_E2B_IT_Q4_0.id

/**
 * Return Phoenix's immutable catalog of supported local models.
 * @returns The supported Phoenix Local model catalog.
 */
export function getLocalModelCatalog(): readonly LocalModelCatalogEntry[] {
  return LOCAL_MODEL_CATALOG
}

/**
 * Resolve one local-model catalog entry by id.
 * @param modelId - Stable Phoenix Local model identifier.
 * @returns The matching catalog entry, when supported.
 */
export function getLocalModel(modelId: string): LocalModelCatalogEntry | undefined {
  return LOCAL_MODEL_CATALOG.find(entry => entry.id === modelId)
}

/**
 * Return the pinned llama.cpp runtime manifest for a verified target.
 * @param platform - Node platform identifier.
 * @param arch - Node architecture identifier.
 * @returns The verified runtime manifest for the target, when supported.
 */
export function getRuntimeManifest(platform: string, arch: string): LocalRuntimeManifest | undefined {
  if (platform === 'win32' && arch === 'x64') return WINDOWS_X64_LLAMA_CPP
  return undefined
}
