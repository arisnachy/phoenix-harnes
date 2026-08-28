import { describe, expect, it } from 'vitest'
import { createHardnessBrowserFixture } from '../src/client/hardness-fixture.ts'

describe('HARDNESS browser fixture', () => {
  it('creates an explicitly labelled declarative artifact with no execution fields', () => {
    const fixture = createHardnessBrowserFixture()
    expect(fixture.artifact).toMatchObject({ id: 'hardness-fixture-universal', mime: 'application/vnd.hardness.artifact+json' })
    expect(fixture.rendered).toMatchObject({ kind: 'universal-artifact', artifactId: 'hardness-fixture-universal' })
    expect((fixture.artifact.data as { blocks: readonly unknown[] }).blocks).toHaveLength(8)
    expect(fixture.trace).toEqual(['UNKNOWN', 'BUILD', 'VERIFIED', 'APPROVAL', 'EXECUTE', 'ARTIFACT', 'RENDER', 'LEARN'])
    expect(fixture.artifact).not.toHaveProperty('execute')
    expect(fixture.rendered).not.toHaveProperty('execute')
  })
})
