# Phoenix Business Engine — núcleo comercial inicial

Español | [中文](phoenix-business-engine.zh.md)

**Alcance incorporado:** biblioteca local persistente fuera de entornos temporales; productos genéricos; capítulos estructurados para libros; archivos con SHA-256; precalificación editorial; compilación real de EPUB3 (ZIP, índice, metadatos, XHTML) y manuscrito Markdown; generación de una galería HTML local; preparación de fichas comerciales; clasificación de herramientas MCP candidatas y fallback de navegación; registro de ingresos declarados sin atribuirles validación comercial inexistente. **No** incluye todavía un botón integrado en la barra lateral ni un publicador autónomo para Amazon. No confundir «preparado» con «publicado».

## Ejecución

```bash
node scripts/phoenix-business.mjs help
node scripts/phoenix-business.mjs init book "Mi primera novela"
node scripts/phoenix-business.mjs list
node scripts/phoenix-business.mjs chapter ID 1 path/to/capitulo-1.md
node scripts/phoenix-business.mjs asset ID path/to/ebook.epub --role ebook
node scripts/phoenix-business.mjs check ID --chapters 24 --words 60000
node scripts/phoenix-business.mjs compile ID --author "Nombre real" --chapters 24 --words 60000
node scripts/phoenix-business.mjs route amazon-kdp --tools mcp__servidor__publicar,mcp__servidor__buscar
node scripts/phoenix-business.mjs prepare ID amazon-kdp 4.99 --currency USD
node scripts/phoenix-business.mjs gallery
node --test scripts/phoenix-business.test.mjs
```

La `gallery` se guarda en `~/.dsh/business-library/gallery.html` (Windows: `%USERPROFILE%\.dsh\business-library\gallery.html`). Un solo `library.json` conserva todos los productos y sus referencias, con escritura atómica y exclusión por archivo lock. Directorios de producto: `products/ID/`. Configurar `PHOENIX_BUSINESS_HOME` si se requiere otro destino persistente. Los archivos registrados se copian, no dependen de la ruta temporal original. Todo queda local; la copia a Google Drive es una operación distinta autorizada.

## Enrutamiento comercial

1. Descubrir servidores MCP en la galería existente, comprobar `ready` y la capacidad de escritura real en la API. La salida `mcp-candidate` **solo** expresa compatibilidad aparente por nombre, no autorización ni éxito.
2. Verificar el esquema y la política de la tienda. Si no existe una integración usable, evaluar el mininavegador **con login del usuario y vault**, sin eludir mecanismos de seguridad.
3. Preparar y comprobar formatos, metadatos, derechos y declaración de IA. `prepare` no ejecuta transacciones externas.
4. Solicitar aprobación interactiva antes de enviar, publicar, iniciar publicidad pagada o aceptar contratos; recopilar comprobante real de la plataforma y guardarlo en el expediente.
5. Medir visitas, pedidos, regalías y beneficio neto con procedencia. El comando `sale` representa una observación *no verificada* hasta contrastarla con el canal oficial.

## Mi Biblioteca dentro de la interfaz (rama Business Studio)

Phoenix presenta la biblioteca real como una pestaña de los ajustes de Plugins. Usa `pluginInventory.businessLibrary`, una proyección de solo lectura del índice del Host, con búsqueda, filtros, contadores de capítulos, archivos, planificación y frescura de compilación. El cliente recibe **únicamente metadatos depurados**: ni rutas locales, ni pedidos, ni contraseñas, ni textos de los libros. Limita la respuesta a 300 productos y rechaza índices inválidos. Es una integración funcional de consulta, no un nuevo panel comercial público ni una confirmación de ventas.

## Límites intencionales y siguiente integración

- `compile` produce EPUB3 validado estructuralmente en pruebas locales, **no** una cubierta de impresión, DOCX ni PDF final. El EPUB debe comprobarse en Kindle Previewer y pasar revisión tipográfica y editorial.
- `check` compara extensión de capítulos y la estructura; **no verifica** estilo literario, continuidad narrativa real, originalidad, maquetación ni conteo de páginas del PDF. Esas pruebas siguen pendientes hasta disponer de motores y validadores dedicados.
- `prepare amazon-kdp` exige capítulos, cubierta y EPUB/DOCX/KPF y deja la publicación en revisión; la subida a KDP y el estado de tienda deben implementarse como adaptadores gobernados, no como simulación de envío.
- La galería HTML estática se puede abrir de inmediato, pero para convertirla en una pestaña nativa de Phoenix se necesitan un gateway local con operaciones seguras y una vista de cliente conectada al almacenamiento host.
- Antes de activar canales de venta, integrar conciliación verificada, permisos con auditoría, control de presupuesto de anuncios, material fiscal, país y métodos de cobro.
- Se necesitan pruebas en Windows y CI de monorepo además de las pruebas autónomas de Node.

La instrucción de operación para Kira está en `.agents/skills/phoenix-business/SKILL.md`, que el proveedor local de habilidades detecta al ejecutar Phoenix desde el repositorio con su configuración predeterminada.

## Iteración en rama `feat/business-engine-studio` — planificación y trazabilidad (sin publicar)

Esta versión añade `scripts/phoenix-business-studio.mjs` y mantiene `main`/`stable` intactas durante la revisión. El registro de productos sigue siendo compatible con la biblioteca versión 1.

```bash
node scripts/phoenix-business.mjs blueprint PRODUCT_ID path/to/plan.json
node scripts/phoenix-business.mjs progress PRODUCT_ID
node scripts/phoenix-business.mjs compile PRODUCT_ID --author "Nombre del autor" --chapters 24 --words 60000
node scripts/phoenix-business.mjs audit PRODUCT_ID
```

- **Blueprint persistente:** exige `schemaVersion: 1`, `premise`, `audience`, `genre`, `targetWords`, `characters`, `chapters` con `number`, `title`, `purpose`, `targetWords` y `beats`; admite `series`, `worldRules` y `timeline`. Los objetivos de capítulos deben sumar el total con tolerancia de 15 %. Las secuelas pueden conservar biblia y cronología en la biblioteca sin inventar continuidad.
- **Progreso comprobable:** señala capítulos ausentes/cortos, palabras redactadas y compilaciones obsoletas. El 85 % del objetivo por capítulo es una regla de gestión, no una garantía literaria.
- **Compilación mejorada:** EPUB3, manuscrito Markdown, DOCX real con WordprocessingML e interior HTML de 6 × 9 pulgadas listo para impresión a PDF con un motor externo. **No** afirma crear un PDF paginado hasta que un motor de impresión valide páginas, fuentes y sangrado.
- **Auditoría:** comprueba SHA-256 de capítulos y archivos, detecta alteraciones posteriores, y reporta revisión de derechos/estilo/originalidad todavía requerida. `prepare` bloquea fichas con activos alterados (`integrity-failed`). El código **no publica**, no simula MCP comerciales activos y no inventa ventas.
- **Pruebas:** `pnpm test:business` ejecuta la batería autónoma de Node, sin red. Se necesita además ejecución de CI del monorepositorio y ensayo de escritorio Windows antes de promoción a ambas ramas.

El trabajo sigue siendo una base para desarrollar una UI nativa de Biblioteca, investigación de oportunidades, conversión a PDF/portadas, conectores MCP con permisos reales y seguimiento conciliado de ventas. Los productos no están listos para publicarse por el simple hecho de contar con EPUB/DOCX.
## Cola comercial gobernada (fase de preparación)

Se incorpora `scripts/phoenix-business-commerce.mjs` como cola separada y duradera de borradores de publicación; **NO** publica, no invoca tiendas, no inicia anuncios ni declara ventas verificadas. Los comandos son:

```bash
pnpm business:commerce plan PRODUCTO_ID amazon-kdp
pnpm business:commerce plan PRODUCTO_ID shopify
pnpm business:commerce list
pnpm business:commerce inspect pub-ID
pnpm business:commerce cancel pub-ID
pnpm business:commerce route shopify --inventory mcp-snapshot.json
pnpm test:commerce
```

- `plan` requiere ficha `review-required`, archivos existentes e íntegros, precio/moneda válidos y, para KDP eBook, EPUB, portada y compilación editorial vigente. Los mínimos internos de 50 000 palabras y 15 capítulos son **criterios conservadores actuales de Phoenix, no requisitos de KDP**; deberán convertirse en objetivos configurables por proyecto.
- Se registra una revisión por huella SHA-256 del manifiesto. Repetir exactamente el mismo plan devuelve el mismo trabajo; cancelar permite crear otro. `inspect` vuelve a verificar que los archivos, capítulos y precio siguen coincidiendo.
- El índice `publication-queue.json` se guarda junto a `library.json`, con bloqueo por archivo y escritura atómica. La vista pública de trabajos nunca transporta ruta de archivo, manuscrito, datos del comprador o credenciales.
- `route` admite un inventario de `pluginInventory.mcpConnectorHubState`; `ready` + nombre de herramienta de escritura solo constituye **candidato MCP**, jamás autorización o publicación confirmada. Si no hay candidato se propone mininavegador, sin abrirlo ni efectuar acciones automáticamente.
- Esta cola termina en `awaiting-approval`. No existe comando `publish` o `submit`; falta conectar el adaptador con la aprobación interactiva del host, una API real o sesión autenticada de navegador y los recibos de plataforma. No registrar ingresos externos a partir de este estado.

Pruebas: `node --test scripts/phoenix-business-commerce.test.mjs` cubre idempotencia, cancelación, precio cambiante, modificación de activos, symlinks, estructura de índice, rutas y detección MCP. Se mantiene pendiente el CI completo, compilación Windows y pruebas de publicación real.


## Product Factory universal — producción verificable por categoría (fase en desarrollo)

Comandos: `pnpm business:factory catalog`, `pnpm business:factory plan ID`, `pnpm business:factory check ID --platform direct`, `pnpm business:factory package ID --platform direct`, `pnpm business:factory metrics ID`. La versión preliminar incorpora requisitos explícitos para `book`, `course`, `software`, `game`, `design`, `research`, `video`, `audio`, `service` y `other`. Permite registrar servicios además de los productos ya presentes.

El catálogo define roles, extensiones y cantidad mínima de materiales por categoría: por ejemplo curso con temario, tres lecciones y evaluación; aplicación con código, paquete y documentación; juego con proyecto, ejecutable y vista previa; investigación con informe, metodología y fuentes; audiovisual con archivo final y accesibilidad; servicio con propuesta, alcance y cumplimiento. Los controles verifican SHA-256 de cada activo, rutas seguras sin symlinks, señales básicas de formatos (PDF, ZIP, PNG, MP4, etc.) y recuentos reales de capítulos. No reemplazan pruebas semánticas, funcionamiento de software, revisión editorial humana, derechos o políticas de plataforma.

`package` solo construye un ZIP local reutilizable con `manifest.json`, huellas verificables y archivos completos en `business-library/releases/ID/`; detecta paquetes existentes modificados en lugar de reutilizarlos. El manifiesto establece explícitamente `externalPublished=false`, `salesVerified=false`, `commerciallyApproved=false`. Los paquetes nunca contienen credenciales, texto de pedidos ni rutas absolutas. Se requiere revisión y aprobación humana para publicaciones, pagos o campañas. `metrics` separa los importes declarados de los recibos realmente verificados, sin afirmar cobros. El modo `direct` significa distribución empaquetada **local**, no una venta realizada.

La cola `business:commerce plan ID PLATAFORMA` invoca ahora los controles del Product Factory antes de aceptar un proyecto comercial: ya no basta un único archivo `source` de apariencia plausible. No se han construido todavía los pipelines de generación autónoma de contenido de las ocho categorías, ni los adaptadores de tienda activos, ni la conciliación bancaria; no marcar estas tareas como completas. Las pruebas estructurales locales se ejecutan con `pnpm test:business`; siguen pendientes build del monorepositorio, Windows y pruebas integrales de publicación real.

## Herramienta nativa de Kira — intención y MCP activos (en desarrollo)

El paquete `@phoenix-ai/dsh-tool-business`, montado en el bundle base como `tool-business`, expone `business_plan_mission` al agente. Lee el inventario `mcpConnectors` del host en cada llamada (solo estado y nombres públicos), detecta nueve categorías comerciales y las fases de investigar/crear/validar/empaquetar/publicar/promocionar/analizar. No invoca herramientas ni revela credenciales.

Un conector `ready` es solo candidato; no implica derechos de publicación. La operación real exige inspeccionar esquema, autenticación y aprobación para efectos económicos. La ruta de mininavegador es una posibilidad, no una sesión garantizada. Las pruebas enfocadas se ejecutan con `node --experimental-strip-types --test packages/core/tool-business/tests/mission.test.mjs`, añadido a `pnpm test:business`. Quedan pendientes ejecución UME, publicación de punta a punta, Windows, CI y conciliación de ingresos.


## Primer adaptador de tienda real: Shopify (borradores, no venta pública)

`scripts/phoenix-business-shopify.mjs` exporta `createShopifyDraft(settings, product, {approval,fetchImpl})` y `inspectShopifyDraft(...)`. Usa la API oficial Shopify Admin GraphQL `2026-10`, `productCreate` con `status:DRAFT`, comprobación por `productByIdentifier` y una revisión SHA-256 ligada a un handle determinista. No reintenta mutaciones tras respuesta incierta. Rechaza dominios ajenos a `*.myshopify.com`, valida el identificador devuelto y nunca registra ni devuelve el token.

**Autorización y credenciales:** el módulo NO es un CLI de publicación. Solo el host de confianza debe inyectar el token de sesión desde el vault, y debe verificar en su propio límite la autorización interactiva: `approval.granted === true`, `approval.action === 'shopify:create-draft'`, `approval.productId` y `approval.revision` deben coincidir con la operación solicitada. Este objeto es un comprobante de entrada, no una prueba criptográfica independiente: ninguna ruta de usuario o subagente debe poder fabricar ese argumento. Mantenerlo fuera de los permisos autónomos. Si no existe host autorizado, conservar la cola en `awaiting-approval` y no ejecutar la mutación. Las pruebas usan transporte simulado, sin tienda real.

**Limitación esencial:** un DRAFT no tiene precio, publicación visible, entrega digital, pagos, impuestos ni pedidos validados. Para producción faltan el adaptador autorizado del host, configuración de cuenta, variantes/precios, medios, canal de venta, entrega, recibo remoto y conciliación real. No tratar `created:true` como lanzamiento ni ingreso. Probar con una tienda de desarrollo autenticada antes de habilitar operaciones públicas. La API oficial exige `write_products` para `productCreate`, y una publicación visible exige pasos y permisos separados. Fuente técnica: https://shopify.dev/docs/api/admin-graphql/latest/mutations/productCreate

`pnpm test:shopify` ejecuta seis pruebas locales de permisos, formato, no duplicación, reconciliación, tratamiento de errores y lectura sin mutaciones. Estas pruebas no sustituyen las end-to-end autenticadas.
