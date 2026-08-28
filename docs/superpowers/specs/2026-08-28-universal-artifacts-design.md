# HARDNESS Universal Artifacts — Diseño

## Objetivo

Convertir los resultados de HARDNESS en bloques visuales universales dentro del historial de la conversación, sin depender de meteorología ni de un tipo de contenido único.

## Referencias

- [LibreChat Artifacts](https://github.com/danny-avila/LibreChat/tree/main/client/src/components/Artifacts): separa tarjeta, preview, editor, tabs, versiones y artefactos producidos por tools.
- [OpenClaw Canvas](https://github.com/openclaw/openclaw): separa información de build, comandos Canvas, superficie alojada y ejecución aislada.

Estas referencias se usan como patrones públicos de arquitectura y UX; no se copia código propietario.

## Contrato universal

Un resultado publicado por una misión usa un sobre estable:

```ts
interface UniversalArtifact {
  id: string
  title: string
  status: 'experimental' | 'testing' | 'verified' | 'broken' | 'quarantined'
  blocks: readonly ArtifactBlock[]
  evidence: readonly ArtifactEvidence[]
  version?: string
}

type ArtifactBlock =
  | { type: 'markdown'; text: string }
  | { type: 'code'; language: string; text: string; filename?: string }
  | { type: 'image'; src: string; alt: string; width?: number; height?: number }
  | { type: 'table'; columns: readonly string[]; rows: readonly (readonly string[])[] }
  | { type: 'chart'; spec: JsonValue }
  | { type: 'candles'; symbol: string; interval: string; points: readonly Candle[] }
  | { type: 'map'; spec: JsonValue }
  | { type: 'document'; mime: string; text?: string; url?: string }
  | { type: 'file'; filename: string; mime: string; text?: string; url?: string }
  | { type: 'app'; entry: string; files: Readonly<Record<string, string>> }
  | { type: 'ui'; schema: UiSchema }
```

El sobre permite combinar bloques: por ejemplo, una explicación Markdown, una tabla MLB, un gráfico y un archivo JSON en una misma tarjeta.

## Renderizado

1. `ArtifactCard` se inserta como nodo `conversation.chat.node`, asociado al evento durable de resultado de tool/mission.
2. La tarjeta muestra título, estado, evidencia, resumen y preview inline.
3. `ArtifactViewer` ofrece tabs para `Preview`, `Code`, `Files` y `Data` cuando existan.
4. El renderer se selecciona por `block.type` y MIME, mediante un registro extensible.
5. Si un renderer no está disponible o falla, se muestra JSON/Markdown seguro del bloque, nunca una capa vacía ni texto sin formato pegado al shell.
6. Las apps complejas pueden abrir una superficie Canvas dentro del mismo workspace, no una ventana de Chrome.

## Componentes

- `markdown`: texto enriquecido sanitizado.
- `code`: JSON, YAML, XML, CSV, Python, JavaScript, TypeScript, SQL, Bash, PowerShell, HTML y lenguajes futuros; copiar/descargar, sin ejecución implícita.
- `image`: imagen remota permitida o data URL validada, alt obligatorio y galería.
- `table`: columnas y filas tipadas, scroll y accesibilidad.
- `chart`: especificación declarativa validada.
- `candles`: OHLCV validado y renderer financiero.
- `map`: especificación declarativa sin HTML ejecutable.
- `document/file`: preview por MIME y descarga controlada.
- `app`: archivos declarativos/estáticos ejecutados únicamente en sandbox autorizado.
- `ui`: reutiliza el schema declarativo actual y el registro de componentes seguro.

## Seguridad y ejecución

- No se aceptan funciones, scripts inline, `javascript:`, handlers arbitrarios ni URLs no permitidas en schemas.
- Código y archivos se muestran como contenido; ejecutar requiere una acción RPC explícita.
- La acción RPC pasa por `ApprovalService`, `tools.guard()` y `ctx.sandboxPolicy`/`ctx.sandbox`.
- Las apps usan iframe/superficie alojada aislada y comunicación RPC con allowlist.
- Cada ejecución registra capability, aprobación, sandbox, entradas, salida, versión y evidencia.
- Un renderer o capability roto pasa a fallback/quarantine; no se presenta como verificado.

## Datos y persistencia

- El evento de misión/tool result es la fuente durable del nodo conversacional.
- El cliente reconstruye `ArtifactCard` desde el evento y conserva versiones por `artifact.id` + `version`.
- No se usa `localStorage` como fuente de verdad; solo puede conservar preferencias visuales.
- La tarjeta se muestra en la conversación activa y no en `shell.overlay`.

## Pruebas y evidencia

- Tests unitarios para validación por bloque, MIME, sanitización y fallback.
- Tests de renderer para código, imagen, tabla, chart, candles, mapa, documento, app y UI.
- Tests de persistencia/replay del nodo `conversation.chat.node`.
- Tests de RPC y seguridad: aprobación, sandbox, rechazo y cuarentena.
- E2E browser en la misma pestaña: misión desconocida → tarjeta inline → preview; sin abrir otra ventana.
- Capturas en `.kira/audits/` y registro de evidencia en `.kira/evidence.md`.

## Criterio de aceptación

La misión solo se considera completa cuando una necesidad desconocida produce un `UniversalArtifact` real, se publica como nodo de conversación, se visualiza inline, permite abrir su viewer/Canvas dentro del workspace, y conserva fallbacks seguros para un renderer o capability roto. Debe existir evidencia ejecutable de cada frontera; fixtures aislados no cuentan como E2E.
