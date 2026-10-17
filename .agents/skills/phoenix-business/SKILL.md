---
name: phoenix-business
description: Crear productos comerciales completos y duraderos, gestionar Mi Biblioteca, preparar publicaciones y buscar herramientas MCP de tiendas antes de usar el mininavegador.
whenToUse: El usuario pide monetizar, escribir libros completos, publicar en Amazon KDP, generar productos digitales, organizar entregables o revisar ingresos.
---

# Phoenix Business Engine — protocolo operativo de Kira

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
