---
name: phoenix-design-intelligence
description: Producción y revisión visual universal con Canva MCP o motores locales, tareas duraderas y archivos verificables.
whenToUse: El usuario solicita un diseño, portada, contraportada, cómic, catálogo, póster científico, material educativo, branding, infografía, anuncio, presentación o edición visual.
---

# Phoenix Design Intelligence — habilidad transversal de Kira

Esta habilidad NO sustituye Business Engine, Comic Studio, Research Studio, Game Studio ni el motor editorial. Se activa para las partes visuales de cualquier misión. Conserva la intención del usuario; no conviertas toda petición en una plantilla Canva ni en una visita al MiniBrowser.

## Primeras acciones reales

1. Comprueba el inventario MCP del host mediante mcpConnectorHubState / mcpConnectors y el catálogo real de herramientas. No confundas instalación, ready, permiso de escritura, cuota ni licencia. No enumeres credenciales.
2. Ejecuta node scripts/phoenix-design-intelligence.mjs start --request "PETICION" para obtener un expediente durable. Si puedes exportar un inventario secret-free, pásalo por --inventory archivo.json (array de serverName, status, toolNames).
3. Usa plan con el mismo argumento para ver capacidades de Canva realmente anunciadas y bloqueos. Si Canva no está listo, crea con el motor gráfico local disponible; no afirmes que existe una alternativa hasta comprobarla.
4. Emplea mcp__canva__create_design o equivalente anunciado solo cuando el trabajo sea un diseño editable. Para imágenes independientes, usa el generador de imágenes apropiado; para mantener personajes, utiliza primero las referencias aprobadas del motor de cómics.
5. Cuando Canva entregue un trabajo asíncrono, conserva job_id y continuation_token y consulta el resultado según la política de espera real. pending no es «hecho». Captura el ID de diseño y URL únicamente después de una respuesta confirmada.
6. Registra el diseño con node scripts/phoenix-design-intelligence.mjs link JOB --design DESIGN_ID --url URL --tool get_design (usa el nombre real de herramienta que verificó el diseño). Este registro acredita el enlace reportado, NO demuestra que el archivo se exportó ni que exista permiso de descarga.
7. Inspecciona páginas reales, contenido, legibilidad, márgenes, ortografía, contraste, imágenes, citas, licencia y continuidad. Cuando edites, usa transacción Canva y previsualización; muestra los cambios y solicita aprobación explícita antes de commit_editing_transaction. No sobrescribas una obra preexistente sin instrucción.
8. Si el MCP no anuncia exportación, usa un exportador realmente disponible (del motor local, flujo autorizado o UI de Canva con consentimiento). **No inventes una herramienta de exportación MCP.** Copia y valida cada resultado con node scripts/phoenix-design-intelligence.mjs export JOB RUTA --format pdf --role final. Un PDF debe existir físicamente; el comando verifica firma/tamaño/SHA-256, no exactitud editorial ni derechos.
9. Termina con node scripts/phoenix-design-intelligence.mjs inspect JOB. Entrega URL real y/o archivo real (copias persistentes). Reporta RESULTADO / EVIDENCIA / RIESGO / ESTADO, incluyendo qué validaciones no se pudieron realizar.

## Enrutamiento por contenido

- **Libros:** autoría, continuidad, capítulos, maquetación interior y pruebas de impresión siguen bajo Publishing Studio. Canva aporta cubierta, contracubierta, recursos promocionales y composición compatible.
- **Cómics:** la biblia visual, personajes, escenas, diálogos y viñetas irregulares pertenecen a Comic Studio. Canva es opcional para retoques, promoción o maquetación compatible. No simplificar viñetas irregulares a rectángulos por la herramienta elegida.
- **Investigación:** los datos, referencias y métodos proceden de Research Studio; no se deben inventar estadísticas para llenar diseños atractivos.
- **Cursos:** comprobaciones de objetivos, evaluación y exactitud didáctica fuera de Canva.
- **Catálogos:** comprobar acceso y nivel del plan antes de autofill_design. Si no hay acceso, usar plantilla y proceso local comprobados. Los precios deben provenir de datos proporcionados.
- **Marca, publicidad y producto comercial:** guardar derechos, versiones, origen de recursos y aprobación antes de campañas, anuncios pagados o publicación pública.

## Coste y permisos

Prioriza herramientas gratuitas/capacidades existentes. El inventario nunca es prueba de créditos restantes ni acceso Pro; ante bloqueo de plan/cuota, conserva el trabajo y propone alternativa. No cargar dinero, contratar Canva Pro, comprar recursos, publicar o automatizar anuncios sin autorización explícita. Por defecto, guardar el diseño como borrador privado.

## Estado y reanudación

start registra una intención pending; link registra design-linked-unverified; export genera export-signature-verified; inspect detecta integrity-failed si se alteraron archivos. Ninguno de estos estados significa publicación, ventas ni aprobación de calidad. Los trabajos se guardan bajo PHOENIX_DESIGN_HOME o ~/.dsh/design-intelligence fuera de runtime y staging. Reutiliza el identificador JOB ante interrupciones, nunca dupliques operaciones irreversibles.
