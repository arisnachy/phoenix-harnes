import type { CapabilityArtifact, CapabilityArtifactRenderModel } from './contract/slots.ts'

export interface HardnessBrowserFixture {
  readonly artifact: CapabilityArtifact
  readonly rendered: CapabilityArtifactRenderModel
  readonly trace: readonly string[]
}

/** Explicit browser-only proof artifact; it is not a production capability. */
export function createHardnessBrowserFixture(): HardnessBrowserFixture {
  const trace = Object.freeze(['UNKNOWN', 'BUILD', 'VERIFIED', 'APPROVAL', 'EXECUTE', 'ARTIFACT', 'RENDER', 'LEARN'])
  return Object.freeze({
    artifact: Object.freeze({
      id: 'hardness-fixture-weather',
      mime: 'text/plain',
      data: `HARDNESS LAB FIXTURE\n${trace.join(' → ')}\nweather forecast: sunny`,
    }),
    rendered: Object.freeze({
      kind: 'hardness-fixture',
      artifactId: 'hardness-fixture-weather',
      label: 'HARDNESS LAB FIXTURE',
    }),
    trace,
  })
}
