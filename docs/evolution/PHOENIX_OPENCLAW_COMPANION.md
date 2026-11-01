# OpenClaw junto a los Conectores y Skills existentes

PHOENIX no necesita una pestaña adicional de OpenClaw. **Settings → Conectores → OpenClaw** contiene el diagnóstico de su runtime (CLI, Gateway, navegador, canales, plugins). Las rutas OpenClaw de Google Workspace y GitHub se resuelven en las fichas canónicas ya existentes.

Las habilidades basadas en SKILL.md se administran mediante el registro de Skills del agente. La integración previa de ClawHub continúa usando ese registro, sin una segunda tienda.

El resultado de un comando externo solamente demuestra que la CLI respondió. **No** habilita por sí mismo las herramientas para Kira, ni da acceso a pantallas, cámaras, OAuth o plugins nativos. Estos requieren adaptadores y permisos propios. Un servidor MCP de registro que ya tenga una ficha principal curada no se duplica en los resultados de descubrimiento.

El script explícito `scripts/phoenix-openclaw-companion.mjs` queda disponible para diagnóstico. La captura del navegador administrado por OpenClaw exige `--approve-capture`.

El adaptador de ejecución OpenClaw → `ctx.tools` con autorización y auditoría sigue siendo una fase pendiente.

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
