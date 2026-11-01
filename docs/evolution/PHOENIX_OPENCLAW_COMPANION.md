# OpenClaw junto a los Conectores y Skills existentes

PHOENIX no necesita una pestaña adicional de OpenClaw. **Settings → Conectores → OpenClaw** contiene el diagnóstico de su runtime (CLI, Gateway, navegador, canales, plugins). Las rutas OpenClaw de Google Workspace y GitHub se resuelven en las fichas canónicas ya existentes.

Las habilidades basadas en SKILL.md se administran mediante el registro de Skills del agente. La integración previa de ClawHub continúa usando ese registro, sin una segunda tienda.

El resultado de un comando externo solamente demuestra que la CLI respondió. **No** habilita por sí mismo las herramientas para Kira, ni da acceso a pantallas, cámaras, OAuth o plugins nativos. Estos requieren adaptadores y permisos propios. Un servidor MCP de registro que ya tenga una ficha principal curada no se duplica en los resultados de descubrimiento.

El script explícito `scripts/phoenix-openclaw-companion.mjs` queda disponible para diagnóstico. La captura del navegador administrado por OpenClaw exige `--approve-capture`.

El adaptador de ejecución OpenClaw → `ctx.tools` con autorización y auditoría sigue siendo una fase pendiente.
