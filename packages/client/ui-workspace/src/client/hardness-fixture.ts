import type { CapabilityArtifact, CapabilityArtifactRenderModel } from './contract/slots.ts'

export interface HardnessBrowserFixture {
  readonly artifact: CapabilityArtifact
  readonly rendered: CapabilityArtifactRenderModel
}

/** Explicit browser-only proof artifact; it is not a production capability. */
export function createHardnessBrowserFixture(): HardnessBrowserFixture {
  return Object.freeze({
    artifact: Object.freeze({
      id: 'hardness-fixture-weather',
      mime: 'text/plain',
      data: 'HARDNESS fixture: unknown need weather → BUILD → verified → workspace',
    }),
    rendered: Object.freeze({
      kind: 'hardness-fixture',
      artifactId: 'hardness-fixture-weather',
      label: 'HARDNESS LAB FIXTURE',
    }),
  })
}
