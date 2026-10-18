# Business Mission: intención y conectores comprobables

Español | [中文](phoenix-business-intent-routing.zh.md)

**Alcance:** planificación de misiones comerciales, sin publicar ni gastar. Rama de desarrollo; no constituye integración en producción.

## Iniciar

```powershell
pnpm business:mission intent --request "Kira, crea un SaaS de reservas"
pnpm business:mission plan --request "Investiga y crea un curso y publícalo en Shopify"
pnpm business:mission plan --request "Crea una novela y publícala en Amazon KDP" --inventory mcp-snapshot.json
pnpm test:business:mission
```

El inventario es la respuesta *sanitizada* de `pluginInventory.mcpConnectorHubState` del host:

```json
{"runtime":[{"serverName":"shopify","status":"ready","toolNames":["mcp__shopify__create_product"]}]}
```

Un ejemplo de inventario **no demuestra** que Shopify esté conectado ni que el esquema de la herramienta funcione. El plan entrega la clasificación y candidatos, no los ejecuta.

## Política de fallos y recuperación

- Distingue necesidades: `opportunity`, `create`, `validate`, `package`, `publish`, `market`, `analytics`.
- Detecta categorías: `book`, `course`, `software`, `game`, `design`, `research`, `video`, `audio`, `service`.
- Si hay varios dominios incompatibles o varias plataformas explícitas, Kira resuelve la ambigüedad y no envía a ninguna tienda por error.
- Consulta al host de nuevo antes de ejecutar: `ready` es requisito para candidaturas, `auth-required` exige OAuth y cualquier llamada exige inspección del esquema y pruebas de permisos. No aceptar conexiones a partir de coincidencias de texto.
- `minibrowser-candidate` significa que habría que comprobar disponibilidad del navegador, login y condiciones de la tienda; no es un formulario rellenado.
- La cola `business:commerce` es idempotente para borradores; **no realiza envío externo**. Para implementar publicación final faltan llamadas reales, aprobaciones, recibos, reconciliación, reintentos seguros y confirmación del destino.
- Si falla un conector, conserva el trabajo y su evidencia en la biblioteca. Nunca reinicies una publicación sin inspeccionar su estado remoto: evita duplicados.
- No se garantiza éxito absoluto: errores externos, sesiones vencidas o políticas de tiendas requieren recuperación o intervención humana.

## Pruebas y limitaciones

El planificador incluye 23 casos automatizados: nueve familias de producto, idioma español, órdenes frente a preguntas, negaciones, rutas MCP, estados de autenticación, herramientas inseguras, inyección de atributos secretos, y rechazo de symlinks del inventario. `pnpm test:business` incorpora ahora estos tests. Los conectores no se instalan ni autorizan solos; integración automática UME, navegador, endpoints reales y despliegues Windows/CI siguen pendientes de pruebas.
