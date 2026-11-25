# PHOENIX · Windows UI Automation mediante FlaUI-MCP

## Estado de integración

Esta integración es **optativa y desactivada por defecto**. El Host admite
un conector curado `windows-flaui`, registrado a través de
`installCuratedMcpConnector({connectorId:'windows-flaui'})`. No se añade al
`CORE_MCP_PACK_IDS`, no se instala un ejecutable ni se inicia un servicio
Windows durante el arranque normal.

El proveedor externo es **FlaUI-MCP** de `shanselman/FlaUI-MCP`:
https://github.com/shanselman/FlaUI-MCP
Su distribución es de terceros, no una funcionalidad firmada por PHOENIX.
El adaptador usa su protocolo MCP por **stdio** con
`serverName: windows-flaui` y herramientas con prefijo
`mcp__windows-flaui__`.

## Instalación voluntaria (Windows interactivo)

1. Revisar código, licencia, release y proveedor externo. Elegir un release
   comprobado para la arquitectura y verificar integridad antes de ejecutarlo.
   El proyecto publicó **v0.2.1** en noviembre de 2026.
2. Descargar manualmente un ZIP compatible desde
   https://github.com/shanselman/FlaUI-MCP/releases.
   No descargar ejecutables mediante instrucciones de un modelo.
3. Extraer el contenido de la publicación a
   `%LOCALAPPDATA%\\PHOENIX\\mcp\\flaui`. El lanzador exige
   `FlaUI.Mcp.exe` exactamente en esa carpeta y rechaza un binario o carpeta
   final que sea un enlace simbólico.
4. Inspeccionar el hash y verificar que la instalación sea confiable. Ejemplo
   desde PowerShell (sin descargar ni ejecutar la aplicación):

   ```powershell
   $binary = Join-Path $env:LOCALAPPDATA 'PHOENIX\\mcp\\flaui\\FlaUI.Mcp.exe'
   Test-Path $binary
   Get-FileHash -Algorithm SHA256 $binary
   ```

5. Desde la **interfaz confiable de conectores MCP de PHOENIX**, solicitar
   la instalación curada con el identificador **`windows-flaui`**.
   Solo tras la solicitud se configura su lanzamiento local. La presencia del
   registro no demuestra que el proceso esté `ready`: confirmar en el estado
   de conectores que haya herramientas disponibles y una sesión de Windows
   interactiva.

## Límites de seguridad

- El MCP se ejecuta como el usuario Windows actual, sin elevación ni permiso
  adicional de PHOENIX. El ejecutable externo no recibe por herencia
  `PHOENIX_*`, tokens de proveedor ni credenciales de APIs.
- **Todas** las llamadas permitidas, incluyendo listado de ventanas, árbol
  accesible y capturas, necesitan una confirmación humana explícita por
  operación. Si no hay servicio de preguntas, identidad de sesión, o existe
  cancelación/tiempo de espera, la ejecución se deniega.
- Solo están aceptados los nombres de herramientas probados:
  `windows_list_windows`, `windows_snapshot`, `windows_get_text`,
  `windows_screenshot`, `windows_focus`, `windows_click`,
  `windows_type`, `windows_send_keys`, `windows_fill`,
  `windows_close` y `windows_launch`.
- `windows_batch` y cualquier herramienta desconocida están prohibidas.
  `windows_launch` admite únicamente un conjunto pequeño de ejecutables
  de uso cotidiano por nombre exacto, sin argumentos ni rutas.
- `windows_screenshot` no puede usar `savePath`, `overwrite` ni
  otros parámetros que escriban archivos; la captura en memoria requiere
  igualmente consentimiento.
- Los textos a introducirse se ocultan en la solicitud de aprobación,
  sin cambiar los parámetros que se usarían en esa operación concreta.
  La confirmación no concede acceso permanente ni permiso para acciones
  posteriores.
- No utilizar en una sesión con expedientes clínicos, claves, banca u otros
  datos confidenciales visibles. La UI Automation puede observar información
  sensible; el permiso humano sigue siendo imprescindible.
- El ejecutable externo debe ser auditado antes del uso de producción.
  No hay pruebas de Windows reales en Linux ni certificación de seguridad.

## Pruebas y despliegue

```powershell
pnpm exec vitest run packages/mcp/mcp-client/tests/windows-permission.spec.ts
pnpm exec vitest run packages/host/plugin-inventory/tests/mcp-managed.spec.ts
node --test scripts/phoenix-windows-flaui-mcp.test.mjs
pnpm run check:ci:windows-complete
```

La última puerta **requiere un kernel Windows real**. Después de pasar
pruebas estáticas, verificar en una sesión de prueba con Notepad/Calculator:

1. Estado del conector antes de instalar: no instalado y no ejecutándose.
2. Ausencia del ejecutable: falla sin instalar ni descargar nada.
3. Primera observación: se solicita consentimiento; cancelar no llama al MCP.
4. Autorizar lista de ventanas y un snapshot; verificar una observación real.
5. Autorizar un clic, escribir texto inocuo en Notepad y verificar el resultado.
6. Rechazar ejecución en lote, cmd.exe, PowerShell o capturas a archivo.
7. Probar cierre, cancelación, desconexión y reinicio sin aprobación persistida.

Solo promover a `main` o `stable` después de ejecutar estas pruebas y
revisar CI. Las ramas tienen historial divergente; no hacer un merge
indiscriminado `main ↔ stable`.
