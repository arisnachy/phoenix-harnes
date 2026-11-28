import { describe, expect, it, vi } from 'vitest'
import { parseOllamaLibrary, parseHubLibrary, searchLocalLibrary } from '../src/local-model/library.ts'
describe('local model library', () => {
  it('discovers explicit local tags, excluding cloud and MLX', () => {
    const html = '<a href="/library/qwen:2b">a</a><a href="/library/qwen:cloud">b</a><a href="/library/qwen:2b-mlx">c</a><a href="https://bad.example/library/qwen:4b">d</a>'
    expect(parseOllamaLibrary(html, 'qwen').map(row => row.installId)).toEqual(['ollama:qwen:2b'])
  })
  it('does not expose private, gated or non-GGUF repositories', () => {
    const row = {id:'owner/model-GGUF', private:false, gated:false, tags:['gguf']}
    expect(parseHubLibrary([row,{...row,private:true},{...row,gated:'manual'},{...row,tags:[]}])).toEqual([{name:row.id,url:'https://huggingface.co/'+row.id,installId:'ollama:hf.co/'+row.id}])
  })
  it('uses a fixed origin and does not send credentials', async () => {
    const fetcher = vi.fn(async (_url: URL | RequestInfo, _init?: RequestInit) => new Response('[]'))
    await searchLocalLibrary({source:'huggingface',query:'qwen'},fetcher as typeof fetch)
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('https://huggingface.co/api/models?')
    await expect(searchLocalLibrary({source:'ollama',query:'',family:'../evil'},fetcher as typeof fetch)).rejects.toThrow()
  })
})
