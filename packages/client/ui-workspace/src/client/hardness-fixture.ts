import type { CapabilityArtifact, CapabilityArtifactRenderModel } from './contract/slots.ts'
import type { UniversalArtifact } from './universal-artifacts.ts'

export interface HardnessBrowserFixture {
  readonly artifact: CapabilityArtifact
  readonly rendered: CapabilityArtifactRenderModel
  readonly trace: readonly string[]
}

/** Explicit browser-only proof artifact; it is not a production capability. */
export function createHardnessBrowserFixture(): HardnessBrowserFixture {
  const trace = Object.freeze(['UNKNOWN', 'BUILD', 'VERIFIED', 'APPROVAL', 'EXECUTE', 'ARTIFACT', 'RENDER', 'LEARN'])
  const artifactData: UniversalArtifact = {
    id: 'hardness-fixture-universal',
    title: 'HARDNESS · Universal Artifact Gallery',
    status: 'verified',
    version: '1',
    evidence: [{ source: 'browser-fixture', trace }],
    blocks: [
      { type: 'markdown', text: 'Una respuesta puede combinar texto, código, datos, gráficos, archivos y miniapps.' },
      { type: 'code', language: 'json', filename: 'result.json', text: '{ "kind": "universal", "ready": true }' },
      { type: 'code', language: 'python', filename: 'analysis.py', text: 'print("resultado verificable")' },
      { type: 'table', columns: ['Equipo', 'Victorias'], rows: [['Tigres', '92'], ['Leones', '88']] },
      { type: 'chart', spec: { data: [12, 18, 15, 26, 31, 29] } },
      { type: 'candles', symbol: 'BTCUSD', interval: '1h', points: [{ time: 1, open: 20, high: 24, low: 18, close: 23 }, { time: 2, open: 23, high: 25, low: 21, close: 22 }, { time: 3, open: 22, high: 28, low: 20, close: 27 }] },
      { type: 'image', src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', alt: 'Imagen de ejemplo segura' },
      { type: 'app', entry: 'index.html', files: { 'index.html': '<main style="font:16px system-ui;padding:20px"><h2>Miniapp segura</h2><p>Vista declarativa dentro del artefacto.</p></main>' } },
    ],
  }
  return Object.freeze({
    artifact: Object.freeze({ id: artifactData.id, mime: 'application/vnd.hardness.artifact+json', data: artifactData }),
    rendered: Object.freeze({ kind: 'universal-artifact', artifactId: artifactData.id, label: artifactData.title }),
    trace,
  })
}
