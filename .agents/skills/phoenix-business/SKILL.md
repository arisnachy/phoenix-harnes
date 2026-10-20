---
name: phoenix-business
description: Crear productos comerciales completos y duraderos, gestionar Mi Biblioteca, preparar publicaciones y buscar herramientas MCP de tiendas antes de usar el mininavegador.
whenToUse: El usuario pide monetizar, escribir libros completos, publicar en Amazon KDP, generar productos digitales, organizar entregables o revisar ingresos.
---

# Phoenix Business Engine — protocolo operativo de Kira

**Producción visual universal:** cuando el producto necesite portada, catálogo, publicidad, póster, presentación o identidad, invoca también la habilidad phoenix-design-intelligence. No confundas enlace Canva con archivo exportado ni suplantes el motor editorial/comercial.

## Detección de intención y orquestación de conectores (Business Mission)

Cuando esté expuesta la herramienta nativa `business_plan_mission`, úsala con la petición comercial exacta. Lee en cada llamada el inventario MCP real desde el host y devuelve rutas candidatas por intención, categoría y canal. No pases ni inventes credenciales. Si no aparece, usa el CLI `pnpm business:mission` como alternativa y declara que la conectividad en vivo está sin comprobar. Un MCP `ready` no garantiza permisos ni publicación; comprueba el esquema, la sesión y las condiciones reales antes de operar. Requiere confirmación para publicar, cobrar, contratar o gastar.

Antes de crear un proyecto comercial, ejecuta `pnpm business:mission plan --request "PETICIÓN EXACTA DEL USUARIO"` y usa `plan.intent` como **hipótesis explicable**, no como sustituto del juicio de Kira. Si la intención es ambigua, conserva los objetivos del usuario y resuélvela sin inventar decisiones comerciales.

**Conectores reales.** Obtén la fotografía actual del servicio `pluginInventory.mcpConnectorHubState` (`runtime`), directamente desde el host si está accesible. Guarda SOLO `serverName`, `status` y `toolNames` en un JSON temporal seguro; pásalo al planificador con `--inventory ruta.json`. Nunca copies cabeceras, tokens, cookies o URL privadas a ese archivo. Un MCP listado en la galería, o `managed`, NO prueba autorización. `status=ready` más coincidencia por nombre sigue siendo candidato hasta revisar esquema, identidad, ámbito, permisos y condiciones de la API. No inventes el esquema ni los nombres de las herramientas.

Orden correcto: (1) reutiliza conector instalado/autenticado apto para la acción, (2) si está `auth-required`, solicita que el usuario conecte o repare usando el flujo del host, (3) si no existe, descubre MCP del registro oficial y ofrece instalarlo con aprobación, (4) si no hay MCP oficialmente utilizable, usa mininavegador con sesión de usuario y vault, sin eludir CAPTCHA/2FA ni políticas. Una tarea comercial que no puede publicarse puede avanzar hasta el entregable, guardar el bloqueo y seguir cuando se autorice.

**Obligatorio:** no declares publicación, ventas ni cobros sin respuesta de plataforma; antes de publicar, contratar, cobrar o gastar solicita aprobación explícita. No vuelvas a ejecutar un envío irreversible sin reconciliar recibos e identificadores previos. Si la clasificación falla, prueba investigación/conversación razonada en vez de finalizar con una negativa genérica.

**Meta: un producto realmente terminado y verificable, no una demostración.** Aplica esta habilidad cuando el usuario busque crear bienes/servicios vendibles. Utiliza el sistema UME existente para planificación, ejecución, persistencia y verificación. Evita promesas de ventas o publicaciones sin comprobantes.

## Primera acción

1. Investiga necesidades y mercado con las fuentes de búsqueda y MCP disponibles; declara qué datos son estimaciones y qué fuentes los sustentan. No inventes demanda, rankings ni tendencias.
2. Consulta la galería MCP de Phoenix para localizar herramientas comerciales o creativas. Prioriza capacidades instaladas y autenticadas; no confundas «MCP listado» con «MCP autorizado». Descubre *los nombres y esquemas reales* antes de llamar herramientas.
3. Si no hay un MCP con autorización/capacidad comprobada, utiliza el mininavegador integrado y el vault de secretos **solo** si las condiciones de servicio y permisos lo permiten. No intentes eludir captchas, 2FA ni verificaciones humanas.
4. Toda publicación, campaña de pago, contrato, cobro o cambio público irreversible se somete a la aprobación interactiva explícita del usuario y a los permisos de la plataforma.

## Biblioteca persistente (fuera de runtimes o staging)

`node scripts/phoenix-business.mjs help`

- `init book "Título de la obra"` crea el proyecto y devuelve ID.
- `chapter ID 1 ruta/capitulo-001.md` añade o reemplaza un capítulo. Redacta todos los capítulos previstos y guarda la biblia de personajes, cronología, escenas y reglas del mundo como archivos `source`.
- `asset ID archivo.ext --role ebook` registra el archivo comercial; roles: `source`, `manuscript`, `ebook`, `print`, `cover`, `promo`, `other`. Nunca guardes contraseñas ni tokens como activos.
- `compile ID --author "Autor real" --words 60000 --chapters 24 --lang es` ensambla el manuscrito Markdown y un archivo **EPUB3 auténtico** a partir de los capítulos y los añade a la biblioteca.
- `check ID --words 60000 --chapters 24` informa del umbral **estructural**. No equivale a revisión humana de originalidad, estilo, coherencia ni páginas impresas.
- `prepare ID amazon-kdp 4.99 --currency USD` abre una ficha comercial **pendiente**. No sube el libro ni confirma una venta.
- `route amazon-kdp --tools mcp__servidor__publicar,mcp__otro__listar` clasifica candidatos a MCP. Verifica en vivo permisos reales y esquema antes de usarlos.
- `gallery` escribe una galería HTML estática local, y `list`/`show ID` consultan su registro.
- `sale ID 12.99 1 --source referencia-del-pedido` registra una entrada **declarada**, no validada externamente; concilia después contra la tienda.

Ruta predeterminada: `~/.dsh/business-library`; configurable con `PHOENIX_BUSINESS_HOME`. Usa rutas de archivo locales, nunca enlaces falsos. Verifica hashes de recursos y entrega siempre la ubicación real y los formatos producidos.

## Pipeline editorial profesional

1. Brief comercial: público, subgénero, límites de extensión, canales permitidos, originalidad y criterios de éxito.
2. Biblia de serie: reglas, personajes, voces, cronología, promesas al lector, arcos, misterios, pistas, continuidad y secuelas.
3. Escaleta por escenas con dependencias y recuentos objetivo. Evita llenar capítulos artificialmente.
4. Escribe TODOS los capítulos completos, verificando su coherencia con la biblia antes de cerrar cada uno. Guarda entregables mientras avances, con estados recuperables; no reinicies el manuscrito desde cero por fallo de una etapa.
5. Ejecuta corrección de estilo, revisión de continuidad, verificación antiplagio y revisión humana cuando corresponda. No declares originalidad comprobada si no hay evidencia.
6. Construye EPUB3 mediante `compile` si la novela supera los controles estructurales. Después prepara manuscrito DOCX, PDF interior a tamaño de corte, cubierta del eBook y cubierta de impresión con lomo/sangrado real. Verifica páginas renderizadas, fuentes y sumario. Si no existe una herramienta de conversión, instala o utiliza una permitida; no cambies un archivo de extensión para simular un formato.
7. Cumple requisitos actuales KDP: contenido generado por IA, licencias, territorios, precio, ISBN cuando corresponda, metadatos, categorías, límite de publicaciones y derechos. Revalida políticas al publicar.
8. Prepara sinopsis y paquete de marketing; sugiere precio con regalías, comisiones, competencia y costes explícitos. Pide aprobación final al usuario antes de pulsar «Publicar» o comprometer dinero.
9. Verifica un enlace/identificador REAL de publicación y registra los resultados. Si no se pudo, reporta `pendiente` con causa y próximo paso, no `publicado`.

## Flujo comercial universal

Para cursos, software, juegos, diseño, vídeo o investigación, sustituye el pipeline editorial por pruebas correspondientes al producto, conservando la misma biblioteca y gates de publicación. Usa la tienda y MCP adecuados tras confirmar autorización. La venta efectiva no se presume de una publicación; consulta métricas oficiales y separa facturación, comisiones, reembolsos y cobros netos.

## Formato final de Kira

**RESULTADO / EVIDENCIA / RIESGO / ESTADO**. Incluye archivos verificables, capítulos/páginas comprobadas, estado del canal, precio recomendado y acciones permitidas para aumentar las ventas. Envía por Gmail o Telegram solamente si el usuario ha autorizado previamente el destino y la integración está operativa. No transmitas datos sensibles en un enlace público.

## Planificación y controles incorporados en Business Studio

- Escribe un plan editorial JSON por obra (schemaVersion 1, premisa, audiencia, género, objetivo total de palabras, personajes con motivaciones/arcos, capítulos consecutivos con títulos, metas y escenas, y opcionalmente serie, reglas y cronología). Consérvalo con `blueprint ID archivo.json`.
- Consulta `progress ID` después de cada capítulo. Si un capítulo no existe o está bajo su extensión objetivo, complétalo realmente; no alteres las metas para aparentar finalización.
- `compile` genera EPUB3, DOCX y HTML para impresión, **no** un PDF automáticamente. El archivo HTML precisa renderizado y conteo real de páginas antes de usarlo para imprenta.
- Si un capítulo o la biblia cambia, cualquier compilación previa queda **stale**. Regenera los formatos. Usa `audit ID` antes de `prepare` para validar las huellas digitales, y detén la publicación ante `integrity-failed`.
- No declares terminado un libro por superar las métricas cuantitativas: la continuidad, los diálogos, la calidad de edición, originalidad, cubierta y derechos siguen necesitando revisión documental independiente.
- Mantén la compilación de esta rama separada de `main` y `stable` hasta superar pruebas de producto y escritorio; no des la sincronización por realizada antes de comprobar los SHA reales.
## Preparación durable de publicación comercial (sin envío todavía)

Tras crear y revisar un producto, ejecuta `pnpm business:commerce plan ID PLATAFORMA`. Usa `inspect pub-ID` antes de proponer aprobación, porque archivos, capítulos o precio pueden cambiar. Si el plan está obsoleto, regenera formatos, repite `business prepare` y crea un plan nuevo; no lo reutilices a ciegas.

La lista MCP se contrasta con la galería **en vivo**; un inventario `ready` con nombre coincidente es solo un candidato. Un envío real futuro deberá exigir autorización interactiva de Phoenix, esquema y autenticación comprobados, idempotencia, recibo remoto y consulta posterior del estado. No inventes ID de publicación, enlace, venta, ingreso ni aval de derechos. La cola no contiene un comando `publish`.


## Product Factory por categorías: no confundir una intención con un producto terminado

Antes de poner en cola cualquier artículo (libro, curso, software, juego, plantilla, informe, vídeo, audio o servicio), consulta `pnpm business:factory plan ID` y reúne **todos** los roles requeridos de su tipo. Ejecuta `pnpm business:factory check ID --platform direct`; corrige bloqueos y produce archivos completos de verdad, no cabeceras de prueba ni archivos renombrados. Genera después `pnpm business:factory package ID --platform direct` y conserva el ZIP y manifiesto SHA-256 en la biblioteca. La cola comercial `pnpm business:commerce plan ID PLATAFORMA` no aceptará productos estructuralmente incompletos. Los validadores de cabecera son mínimos: se necesita además QA con las herramientas del producto (reproducción, tests de app/juego, citas y método de investigación, revisión pedagógica, maquetación, licencias). `pnpm business:factory metrics ID` distingue declaraciones de ventas de recibos externos, cobros y beneficios. Un ZIP local NO significa que algo esté vendido, publicado o editorialmente aprobado. Para la primera venta efectiva siguen faltando conectores MCP reales o navegación autenticada permitida, confirmación humana y recibos verificables.

## Habilidad editorial avanzada (transversal, no exclusiva del Harness)

La edición es una **habilidad invocable** del sistema universal de Phoenix. Revenue Skill puede contratarla para monetizar, pero Kira también puede escribir y maquetar libros para tareas no comerciales. No sustituye UME, herramientas del navegador ni el resto de habilidades.

### Libro completo y atractivo

1. Investiga género y público con fuentes fechadas antes de definir posicionamiento. `pnpm business book-guide "thriller"` ofrece solo orientaciones creativas; **no** acredita ventas, rankings ni demanda actual. La longitud se adecua al formato (`novel`, `novella`, `nonfiction`, `children`) y al lector, sin rellenar capítulos.
2. Escribe en el blueprint `editorial: {"format":"novel"}` junto con premisa, audiencia, género, personajes con motivaciones y arcos, cronología, reglas, escenas y capítulos completos. Registra `kind: "interlude"` solo para pausas estructurales justificadas; no para esconder capítulos incompletos. Define la extensión total y objetivos individuales coherentes.
3. Usa la biblia de historia y una tabla de hechos por escena para registrar objetivos, conflicto, cambio emocional, pistas, cronología y consecuencias. Al cerrar cada capítulo verifica relaciones causales, quién sabe qué, nombres, ubicaciones y asuntos abiertos; reescribe contradicciones. Un algoritmo de longitud **no** certifica calidad narrativa.
4. Después de redactar todos los capítulos, ejecuta `pnpm business book-quality ID` y corrige **cada bloqueo** de capítulos ausentes, demasiado cortos, marcadores de borrador, repetición mecánica y falta de portada. El informe tiene estructura y metadatos sin filtrar escenas o manuscritos sensibles. El mínimo de formato es una política interna editable, **no una norma legal de KDP**.
5. Diseña la portada con herramientas gráficas disponibles (IA, Canva, Figma o editor humano). Debe ser original, legible como miniatura y coherente con el público; además de JPG/PNG y resolución, revisar derechos, tipografía, composición y contraste con un evaluador humano. La comprobación automática de dimensiones NO sustituye el control estético ni una prueba de decodificación/impresión.
6. Compila con `pnpm business compile ID --author "Autor"` para crear EPUB con portada válida incorporada, índice navegable, DOCX con índice y un HTML de interior 6×9 con índice. El HTML **no** es un PDF paginado: renderízalo con una herramienta real, inspecciona páginas y crea cubierta completa con lomo antes de imprenta. Un compilado hecho con umbrales manualmente reducidos para pruebas sigue siendo **borrador**.
7. Revisa desarrollo narrativo, estilo, originalidad, ortotipografía, portada, diseño, EPUB y política de IA mediante evidencias reales. Un reporte `structurallyReadyForReview=true` solo significa que puede entrar a revisión editorial; nunca que supera libros del mercado o garantiza ser bestseller.
8. Para marketing crea un JSON con 2–30 fuentes **reales** `[{ "title": "...", "url": "https://...", "date": "YYYY-MM-DD", "observation": "...", "metricType": "..." }]`; pasa `pnpm business book-marketing ID fuentes.json`. La ficha solo organiza señales cuya exactitud **debe** verificar Kira. Evitar números de venta, valoraciones o predicciones inventadas. Experimentar con cubiertas, sinopsis y muestras; atribuir pedidos e ingresos únicamente a recibos externos.
9. Antes de distribución ejecuta `pnpm business:factory check ID --platform direct` y luego `business:commerce plan`: una portada, archivo EPUB, extensión y capítulos verificados son condición estructural, pero el proceso necesita las revisiones profesionales, autenticación y permiso humano de publicación cuando se requiera.

### Contrato de calidad

**Completo ≠ extenso; estructuralmente válido ≠ literariamente excelente; compilado ≠ impreso; listado ≠ vendido.** Informar por separado longitud real, capítulos, continuidad revisada, portada verificada por dimensiones, arte revisado, derechos, impresión y métricas del mercado. Si falta una prueba, conservarla como `pendiente`, no como `aprobado`.

## Producción editorial avanzada: PDF y continuidad comprobables

Estas funciones siguen siendo **habilidades opcionales dentro del Harness universal**, disponibles para cualquier encargo literario, monetizado o no. Revenue Skill puede utilizarlas cuando el proyecto incluya venta, pero no transforma Phoenix en una plataforma editorial exclusiva.

- `pnpm business story-ledger ID escenas.json` registra un diario de cambios de estado `{schemaVersion:1,events:[{id,chapter,sequence,actor,field,before,after,quote,chapterSha256}]}`. Cada cita tiene que aparecer literalmente en el texto del capítulo cuyo SHA identifica el evento. Kira debe construir y actualizar el diario con información real de las escenas, no inventar referencias. Reemplazar un capítulo invalida sus eventos antiguos; regenerarlos con una revisión verificada. `pnpm business story-audit ID` detecta contradicciones de estado, escenas no referenciadas, citas inexistentes y versiones obsoletas.
- `pnpm business book-quality ID` incorpora los resultados de continuidad cuando existe un blueprint. `business:factory check` detiene la preparación comercial si un diario registrado se contradice o está obsoleto; la interpretación literaria sigue requiriendo lectura crítica independiente.
- `pnpm business book-pdf ID --author "Autor" --lang es` convierte un libro estructuralmente completo en **PDF real de interior 6×9** con portadilla, tabla de contenidos paginada, títulos de capítulo, encabezados y numeración de páginas. Requiere Python 3 y dependencias `reportlab` y `pymupdf`; permite configurar `PHOENIX_PYTHON` y `PHOENIX_BOOK_TTF` para una fuente Unicode autorizada. Si falta la dependencia o la fuente, devuelve error explícito; nunca simula PDF. Conserva SHA del PDF, número de páginas verificadas y huella de origen en la biblioteca.
- El PDF es un **interior paginado**, no una prueba definitiva de impresión. Para vender en papel aún faltan revisión visual, márgenes y sangrado específicos de imprenta, portada completa con lomo calculado, tipografía/licencias, ISBN cuando aplique y prueba impresa. No indicar `print_ready` sin esas pruebas.
- Después de generar PDF/EPUB/DOCX, Kira debe comparar el PDF renderizado con el texto fuente, revisar el índice, corregir huérfanas/viudas y ejecutar inspección profesional. La extracción de texto y la cantidad de páginas son pruebas automáticas limitadas: no certifican calidad literaria, ausencia de plagio o diseño atractivo.
- Las salidas se describen como `borrador`, `estructura-verificada`, `revisión-editorial-pendiente`, `maquetado-verificado` o `publicado-con-recibo`, con evidencia separada por etapa. Nunca inventar marketing, demanda, pedidos o regalías.
