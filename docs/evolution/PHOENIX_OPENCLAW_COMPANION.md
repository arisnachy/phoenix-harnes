# OpenClaw junto a los Conectores y Skills existentes

PHOENIX no necesita una pestaña adicional de OpenClaw. **Settings → Conectores → OpenClaw** contiene el diagnóstico de su runtime (CLI, Gateway, navegador, canales, plugins). Las rutas OpenClaw de Google Workspace y GitHub se resuelven en las fichas canónicas ya existentes.

Las habilidades basadas en SKILL.md se administran mediante el registro de Skills del agente. La integración previa de ClawHub continúa usando ese registro, sin una segunda tienda.

El resultado de un comando externo solamente demuestra que la CLI respondió. **No** habilita por sí mismo las herramientas para Kira, ni da acceso a pantallas, cámaras, OAuth o plugins nativos. Estos requieren adaptadores y permisos propios. Un servidor MCP de registro que ya tenga una ficha principal curada no se duplica en los resultados de descubrimiento.

El script explícito `scripts/phoenix-openclaw-companion.mjs` queda disponible para diagnóstico. La captura del navegador administrado por OpenClaw exige `--approve-capture`.

El puente de búsqueda de lectura, descrito a continuación, ya se registra en `ctx.tools` cuando el propietario lo habilita. Un adaptador **general** para plugins nativos, navegador y acciones con efectos externos continúa pendiente: requiere permisos, trazabilidad y un contrato por herramienta.

## Conexión de búsqueda real al Gateway (optativa)

El Gateway oficial admite solicitudes `POST /tools/invoke`. PHOENIX registra automáticamente la herramienta `openclaw_external_search` en el **registro de herramientas existente** cuando su propietario configura estas variables en el entorno del proceso PHOENIX:

```text
PHOENIX_OPENCLAW_READ_BRIDGE=1
PHOENIX_OPENCLAW_GATEWAY_TOKEN=<token privado del Gateway>
PHOENIX_OPENCLAW_GATEWAY_PORT=18789
```

También se admite `OPENCLAW_GATEWAY_TOKEN` si ya existe en el entorno. El puerto es opcional; solamente se admite `127.0.0.1`, nunca un host arbitrario. No introduzcas el token en un chat ni lo incluyas en GitHub. La herramienta permanece ausente si falta autorización. El Gateway debe estar funcionando, permitir explícitamente `memory_search` o `web_search` y contar con su proveedor configurado.

Para evitar duplicaciones, Kira conserva sus propias herramientas y Skills. El puente es una única herramienta de consulta externa con dos fuentes explícitas: memoria de OpenClaw y búsqueda web de OpenClaw. No importa plugins ni añade nuevas pestañas. Los errores de conexión no bloquean el arranque de PHOENIX.

El token del Gateway representa privilegios de operador: el puente solo permite dos herramientas de lectura y jamás expone al modelo nombres arbitrarios, comandos, una URL del Gateway o cabeceras. El resultado se trunca y no se devuelve ninguna respuesta de error de autenticación con secretos. Esta incorporación **no autoriza** control del navegador, cámaras, shell, envíos ni trading.

Referencia: https://docs.openclaw.ai/gateway/tools-invoke-http-api

## Skills de OpenClaw detectadas automáticamente

El proveedor de Skills de PHOENIX observa la carpeta compartida `~/.openclaw/skills` (o `OPENCLAW_STATE_DIR/skills` si el usuario configuró otra ubicación). Sus archivos `SKILL.md` se ofrecen mediante el registro **ya existente** de Kira: no hay una nueva tienda, una segunda lista ni copias de archivos. Las Skills PHOENIX instaladas por el usuario conservan prioridad sobre las de OpenClaw, y dos Skills con el mismo nombre se resuelven a una sola entrada.

La importación de instrucciones no convierte binarios, autenticaciones, plugins ni herramientas propietarias de OpenClaw en herramientas ejecutables dentro de PHOENIX. Cada Skill debe utilizar herramientas que Kira tenga realmente disponibles; no se fuerza un Gateway nuevo ni se concede acceso a dispositivos.

## Mantenimiento automático de ClawHub CLI

La CLI independiente **ClawHub** (no el Gateway OpenClaw) admite Node 22.13+ y se prepara automáticamente mediante `scripts/phoenix-clawhub-bootstrap.mjs --ensure --update` en los tres flujos de PHOENIX: instalación, actualización y arranque `pnpm phoenix`. La consulta de nueva versión está limitada a una vez cada seis horas; el usuario puede solicitar reparación explícita desde **Settings → Conectores → Tienda ClawHub**. No se solicita ni se instala un Gateway para explorar e instalar Skills.

El instalador valida la CLI ejecutándola, consulta `npm view clawhub version`, instala en una carpeta de preparación y solo sustituye la CLI anterior después de comprobar el arranque. Si el proceso falla conserva la versión anterior. Un lock evita instalaciones simultáneas; las cerraduras de procesos interrumpidos se recuperan después de seis minutos.

El diagnóstico persiste en el directorio de usuario `DSH_HOME/toolchains/clawhub-status.json`: estado, versión, última comprobación y motivo controlado de fallo, sin credenciales ni salida npm. Los fallos de red o npm no bloquean el arranque de PHOENIX. La tienda sigue siendo navegable mediante su API pública si la CLI no está disponible, pero las instalaciones quedan deshabilitadas hasta recuperar el ejecutable.

Los plugins nativos no se activan sin revisión ni permisos. ClawHub CLI ≠ OpenClaw Gateway; este último requiere Node y configuración independientes.

## Plugins nativos: autorización y ejecución desde Kira

PHOENIX mantiene a Kira como agente central; **no** crea otro agente de OpenClaw. En
**Settings → Conectores → Tienda ClawHub**, la sección «Herramientas OpenClaw → Kira»
inspecciona los plugins que el runtime local declara cargados, muestra sus herramientas
registradas y permite autorizar o revocar cada herramienta individualmente.

La autorización se almacena en
`DSH_HOME/toolchains/openclaw-routing.json` como identidades `pluginId + toolName`
(sin secretos). Al instalar un plugin no se autoriza su ejecución desde Kira.
Una vez aprobada, Kira utiliza las herramientas
`openclaw_plugin_catalog` y `openclaw_plugin_invoke`. El ejecutor:

- vuelve a validar el par exacto contra la política local y la inspección del plugin;
- solo envía llamadas al Gateway de bucle invertido `127.0.0.1:18789`;
- no permite al modelo modificar el destino, el token, los comandos ni los permisos;
- bloquea explícitamente ejecución de shell, escritura de archivos, sesión, Gateway,
  nodos y automatización sensible;
- registra una constancia acotada del resultado, sin token ni argumentos.

El token de operador del Gateway se guarda en la bóveda de PHOENIX desde
**Conectores → ClawHub → Conectar Gateway OpenClaw** y se resuelve en cada llamada.
La conexión se utiliza sin reiniciar el registro de herramientas de Kira. También se
admiten las variables de entorno anteriores. El secreto **no** debe enviarse por chat.
El panel de administración del Gateway local está en `http://127.0.0.1:18789/`
cuando se ejecuta con su configuración predeterminada.

**OAuth y permisos del proveedor.** Cada plugin administra sus credenciales y
permisos con el procedimiento oficial de su proveedor en OpenClaw; no existe
un OAuth genérico para todos los servicios. PHOENIX no asume que un plugin
está autorizado simplemente por cargarlo. Un error HTTP 401/403/404 del
Gateway se informa como conexión/permisos/herramienta no disponible, sin copiar
los mensajes privados de error. Los canales, proveedores de modelos y plugins
sin herramientas de agente no se convierten artificialmente en funciones
invocables de Kira; requieren un adaptador específico para su superficie.

La CLI de OpenClaw precisa un Node compatible, independiente de la CLI ClawHub.
La inspección de CLI es evidencia de sus registros, no prueba por sí sola de que el
Gateway haya cargado el mismo módulo. La llamada efectiva al Gateway es la
comprobación final; si el plugin se retira o deshabilita, no se invoca.

Documentación oficial:
- https://docs.openclaw.ai/gateway/tools-invoke-http-api
- https://docs.openclaw.ai/cli/plugins/inspect-and-diagnose
- https://docs.openclaw.ai/concepts/oauth
