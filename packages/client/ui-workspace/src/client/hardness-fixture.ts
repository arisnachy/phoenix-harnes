import type { CapabilityArtifact, CapabilityArtifactRenderModel } from './contract/slots.ts'

/** Browser-only fixture that demonstrates the HARDNESS artifact lifecycle. */
export interface HardnessBrowserFixture {
  readonly artifact: CapabilityArtifact
  readonly rendered: CapabilityArtifactRenderModel
  readonly trace: readonly string[]
}

/**
 * Build the explicit browser-only proof artifact; it is not a production capability.
 * @returns Frozen fixture containing the artifact, render model, and lifecycle trace.
 */
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
