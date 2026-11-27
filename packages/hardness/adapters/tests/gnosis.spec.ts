import { describe, expect, it } from 'vitest'
import type { HardnessService } from '@phoenix-ai/dsh-hardness'
import { buildGnosisGraph, checkGnosis, searchGnosis, traceGnosis } from '../src/gnosis.ts'
type Atlas = ReturnType<HardnessService['snapshot']>
function atlas(capabilities: unknown[] = [], evidence: unknown[] = []): Atlas {
  return { formatVersion: 1, capabilities, evidence } as Atlas
}
const schemas = [
  { name: 'image_generation', description: 'Create a raster photo or image' },
  { name: 'web_search', description: 'Search public web pages' },
  { name: 'file_read', description: 'Read a file document' },
]
function descriptor(name: string, dependencies: string[] = [], status = 'verified') {
  return { id: 'tool:' + name, version: '1.0.0', status, dependencies }
}
function proof(name: string, outcome: string, version = '1.0.0') {
  return { capabilityId: 'tool:' + name, descriptorVersion: version, outcome, inputSummary: 'PRIVATE', artifactRefs: ['PRIVATE'] }
}
describe('PHOENIX GNOSIS', () => {
  it('finds bilingual tool concepts without a model call', () => {
    const graph = buildGnosisGraph(schemas, atlas())
    expect(searchGnosis(graph, 'quiero crear una imagen')[0]?.name).toBe('image_generation')
    expect(searchGnosis(graph, 'buscar')[0]?.name).toBe('web_search')
    expect(searchGnosis(graph, 'file_read')[0]?.name).toBe('file_read')
    expect(searchGnosis(graph, 'no-such-entity')).toEqual([])
  })
  it('does not disclose hidden capability records, evidence payloads or raw descriptions', () => {
    const graph = buildGnosisGraph(schemas, atlas([descriptor('image_generation', ['tool:hidden']), descriptor('hidden')], [proof('image_generation','passed'), proof('hidden','passed')]))
    expect(graph.nodes).toHaveLength(3)
    expect(JSON.stringify(graph.nodes)).not.toContain('PRIVATE')
    expect(JSON.stringify(graph.nodes)).not.toContain('tool:hidden')
    expect(graph.nodes.find(n => n.name === 'image_generation')?.unresolvedDependencies).toBe(1)
    expect(checkGnosis(graph,'image_generation').state).toBe('recheck-required')
  })
  it('separates conflicting, stale and current version evidence', () => {
    const graph = buildGnosisGraph(schemas, atlas(schemas.map(s => descriptor(s.name)), [
      proof('image_generation','passed'), proof('image_generation','failed'),
      proof('web_search','passed','0.1.0'), proof('file_read','denied'),
    ]))
    expect(graph.nodes.find(n => n.name === 'image_generation')?.evidence).toBe('conflicting')
    expect(graph.nodes.find(n => n.name === 'web_search')?.evidence).toBe('stale')
    expect(graph.nodes.find(n => n.name === 'file_read')?.evidence).toBe('denied')
    expect(checkGnosis(graph,'file_read').state).toBe('recheck-required')
  })
  it('does not claim execution or authorization from historical success', () => {
    const graph = buildGnosisGraph(schemas, atlas([descriptor('image_generation')], [proof('image_generation','passed')]))
    expect(checkGnosis(graph,'image_generation').state).toBe('registered-not-probed')
    expect(checkGnosis(graph,'imagen').state).toBe('candidates')
    expect(checkGnosis(graph,'unobtainium').state).toBe('unknown')
  })
  it('traces declared visible dependencies and terminates cycles', () => {
    const graph = buildGnosisGraph(schemas, atlas([descriptor('image_generation',['tool:file_read']),descriptor('file_read',['tool:image_generation'])]))
    expect(traceGnosis(graph,'image_generation').nodes.map(n => n.name)).toEqual(['image_generation','file_read'])
    expect(traceGnosis(graph,'hidden').nodes).toEqual([])
    expect(traceGnosis(graph,'image_generation').truncated).toBe(false)
  })
  it('reflects removal on the next observation and bounds returned candidates', () => {
    const many = Array.from({length:60},(_,i)=>({name:'tool_'+i,description:'image'}))
    expect(searchGnosis(buildGnosisGraph(many,atlas()),'image',100)).toHaveLength(20)
    expect(searchGnosis(buildGnosisGraph([],atlas()),'image')).toEqual([])
  })
})
