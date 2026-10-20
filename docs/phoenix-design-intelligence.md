# Phoenix Design Intelligence — referencia operativa

## Alcance

Servicio visual transversal sobre los motores actuales de Phoenix: planea rutas entre Canva MCP y proveedores locales, registra diseños reales, guarda copias exportadas y comprueba integridad. **No incorpora un cliente autónomo de Canva, un publicador de terceros ni un editor visual independiente**. La orquestación de MCP corre mediante herramientas existentes disponibles a Kira, descritas en [la habilidad](../.agents/skills/phoenix-design-intelligence/SKILL.md).

### Capacidades comprobables

- plan: clasifica libros, cómics, investigación, educación, catálogos, branding, marketing y vídeo a partir de solicitudes naturales. Inspecciona un inventario MCP reducido y presenta herramientas concretas disponibles y bloqueos.
- start: crea una misión persistente en ~/.dsh/design-intelligence/jobs/JOB/manifest.json, sin ejecutar una herramienta externa ni registrar secretos.
- link: guarda un ID y URL Canva obtenidos de una respuesta real. Un enlace registrado **no** verifica exportación.
- export: comprueba firma de archivo, extensión, tamaño y SHA-256 y conserva una copia bajo jobs/JOB/artifacts; no certifica contenido, maquetación ni licencias.
- inspect: vuelve a calcular integridad y reporta archivos alterados.

El motor es general: no hay una plantilla de género impuesta ni un modelo visual fijo.

## Ejecución y pruebas

En la raíz del repositorio:

~~~bash
node scripts/phoenix-design-intelligence.mjs plan --request "Crea una portada profesional para una novela"
node scripts/phoenix-design-intelligence.mjs start --request "Genera un catálogo de 20 productos"
node scripts/phoenix-design-intelligence.mjs plan --request "Diseña un póster científico en PDF" --inventory runtime-mcp.json
node scripts/phoenix-design-intelligence.mjs link JOB --design D0123456789 --url https://www.canva.com/design/D0123456789/view --tool get_design
node scripts/phoenix-design-intelligence.mjs export JOB ruta/archivo.pdf --format pdf --role final
node scripts/phoenix-design-intelligence.mjs inspect JOB
node --test scripts/phoenix-design-intelligence.test.mjs
~~~

El archivo runtime-mcp.json contiene solamente:

~~~json
[{"serverName":"canva","status":"ready","toolNames":["mcp__canva__create_design","mcp__canva__get_design"]}]
~~~

No incluir token, credenciales, cookies, sesiones ni cabeceras en el inventario. Los comandos no contactan Canva; Kira debe usar la herramienta MCP auténtica. Cambiar PHOENIX_DESIGN_HOME permite escoger un almacenamiento durable alternativo.

## Estado y calidad

Una misión inicia como pending; link produce design-linked-unverified; export produce export-signature-verified; inspect devuelve integrity-failed si falta el archivo o cambió su huella. No existe el estado «publicado» ni «ventas». La firma de PDF/PNG/PPTX, etc. no reemplaza inspección visual, verificación semántica, validación editorial, cumplimiento de formatos de imprenta ni derechos de uso.

### Restricciones importantes

- Un servidor ready no prueba acceso a una funcionalidad Pro, créditos de IA restantes ni permiso para modificar un diseño.
- El MCP disponible puede no incluir exportación directa. En ese caso, la descarga se resuelve mediante un exportador verificado, no fingiendo una respuesta.
- autofill_design requiere un esquema confirmado de campos y permisos de la cuenta.
- Las ediciones Canva se hacen en transacciones; antes de guardar cambios deben mostrarse previsualizaciones y obtener aprobación.
- La publicación comercial, uso de recursos sujetos a licencia y anuncios pagados requieren revisión y autorización separadas.
- El estado de la misión no reemplaza el control de ejecución de UME y su memoria; hay que conservar JOB al cambiar de conversación.

## Mejoras posteriores

Quedan por integrar: botón nativo en conversación para estado de diseño, proveedor Canva con exportación verificada si la API lo permite, revisión visual automatizada con imágenes de páginas, plantillas por producto, ejecución programada por lotes y ensayos E2E reales con una cuenta Canva autorizada.
