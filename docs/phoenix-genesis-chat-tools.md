# PHOENIX Genesis integrado en el chat de Kira

## Problema resuelto

Antes, Genesis disponía de consola y SQLite pero **no estaba registrado
como una herramienta del agente**: \`tool_search\` devolvía
\`matched: 0\` para Genesis/Fabric. No bastaba con cambiar el prompt.

El nuevo paquete de PHOENIX \`@phoenix-ai/dsh-tool-genesis\` se monta
desde el **perfil base** mediante \`cordis.patch.yml\`, igual que
ORÁCULO o las herramientas de deportes. Por tanto, Kira puede
descubrir herramientas propias sin depender de un servidor MCP Genesis
ni de tener abierta la consola.

Las herramientas nativas son:

- \`genesis_status\`: verificar la presencia del motor local, base y demo.
- \`genesis_demo_create\`: crear un hospital ficticio **persistente y aislado**.
- \`genesis_organization_list\`: listar organizaciones realmente creadas.
- \`genesis_organization_create\`: registrar una institución con aprobación.
- \`genesis_organization_report\`: leer inventario, entrevistas, censo,
  informe ejecutivo, propuesta de despliegue y borrador POA.
- \`genesis_catalog_search\`: consultar las 60 áreas, 135 indicadores,
  comités, procedimientos, riesgos e informes de referencia.
- \`genesis_area_assess\`: evaluar una referencia hospitalaria con estado
  y evidencia, siempre con autorización explícita.
- \`genesis_unit_register\`: registrar una unidad aprobada; **no** instala
  agentes ni conecta sistemas.

## Prueba inmediata desde una conversación nueva

> PHOENIX Genesis: primero ejecuta **genesis_status** y dime si las
> herramientas nativas están activas. Después ejecuta
> **genesis_demo_create** y comprueba el recibo persistido.
> Usa **scope=demo** y **organization_id=hospital_genesis_demo**
> para ejecutar **genesis_organization_report** (snapshot, census,
> readiness y poa con period 2026-11), y **genesis_catalog_search**
> en las categorías areas, indicators y committees. Muéstrame
> los registros reales del hospital ficticio, sus dos sedes,
> siete unidades, 120 puestos agregados, 45 camas *de prueba*,
> tres áreas evaluadas, el borrador POA y los costos de ejemplo.
> Verifica que \`persisted\` sea verdadero en la creación.
> Nunca afirmes que Fabric, un HIS o agentes estén conectados.
> Si falta una herramienta, informa su nombre y el error
> exacto, sin simular la ejecución.

La demostración guarda su archivo **fuera** de la base institucional:

- Windows: \`%LOCALAPPDATA%\PHOENIX\institution\demos\interactive\genesis.sqlite\`
  (o bajo \`PHOENIX_INSTITUTION_DATA_HOME\`).
- Otros sistemas: \`~/.phoenix/institution/demos/interactive/genesis.sqlite\`.

Si la demo ya está creada, repetir \`genesis_demo_create\`
**no la borra ni duplica**: devuelve estado \`already-existing\`.
Para reiniciar deliberadamente una demo, el operador debe gestionar
su carpeta después de hacer copia de seguridad; Kira no elimina
carpetas ni pacientes mediante estas herramientas.

## Límites, acceso y actualización

El plugin requiere Node 24 y la presencia de \`scripts/phoenix-genesis-*.mjs\`
en el **runtime de PHOENIX**. El actualizador debe incorporar la nueva
versión y arrancarla para que el perfil base cargue el paquete.
Opcionalmente, \`PHOENIX_GENESIS_RUNTIME_ROOT\` puede apuntar a la raíz
activa del repositorio donde estén los scripts del Workbench.

No hay exposición LAN, conexión directa con HIS, descubrimiento de
equipos biomédicos ni acceso a información clínica. Las operaciones
trabajan con datos institucionales **agregados** y sujetos a
autorización, y devuelven recibos desde SQLite (no respuestas LLM
inventadas). Los informes siguen siendo borradores internos.

Si Kira todavía comunica \`matched: 0\` tras actualizar PHOENIX, el
primer diagnóstico debe ser comprobar el **registro efectivo de
\`tool-genesis\` en el perfil/carga real** y que los procesos se
reiniciaron a la versión nueva. Un archivo GitHub fusionado no
garantiza por sí solo que el Host local ya se actualizó.

### Pruebas de contrato

~~~powershell
pnpm test:genesis:chat
~~~

La suite usa directorios temporales y valida ausencia de efectos
secundarios del status, creación real e idempotente de demo aislada,
lectura de catálogo/censo/POA/informe, rechazo de escrituras sin
autorización y creación controlada de una institución de prueba.

**Pendiente de producción completa**: identidad por usuario/rol,
autorización independiente del modelo, bóveda cifrada, CAD/BIM,
integraciones clínicas y compilación/despliegue de instancias Fabric.
