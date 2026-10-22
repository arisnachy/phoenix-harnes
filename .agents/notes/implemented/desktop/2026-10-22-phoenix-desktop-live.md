# Phoenix Desktop Live · visor nativo de aplicaciones (2026-10-22)

## Problema
El motor Computer Use de Windows ya ejecutaba acciones de teclado/mouse mediante un driver PowerShell protegido por política y adjuntaba capturas al siguiente paso del modelo, pero se encontraba desactivado por defecto. El ejecutable Windows enumeraba ventanas y capturaba el escritorio por un named pipe schema 1; no ofrecía una visualización nativa de las aplicaciones trabajadas dentro del panel lateral. El modelo podía declarar acciones sin que el usuario viera una superficie visual simultánea.

## Decisión y límites
- Reutilizar **computer** y sus permisos actuales; no crear un agente o driver de input alternativo.
- Activar la herramienta en Windows, con opt-out PHOENIX_DESKTOP_COMPUTER=0 y manteniendo aprobación por política.
- Antes de cada acción de escritorio relevante el runtime envía un preflight por named pipe, con el identificador de conversación y selector de ventana. El host devuelve rechazo explícito si el usuario pulsó Pausar o existe un arrendamiento reciente de otra conversación.
- Mostrar la ventana real mediante PrintWindow en la zona derecha del ejecutable y refrescar cada 850 ms. Mantener el navegador web como superficie separada, sin sustituir su motor ni modificar sus comandos.
- Cerrar el visor desde la barra impide su reapertura automática; el usuario lo reabre con Ctrl+F10. La barra permite pausar acciones nuevas. El rechazo de pausa/arriendo nunca se esquiva mediante PowerShell.
- Sin shell nativo, se conserva el actuador Computer Use anterior con las mismas aprobaciones. PrintWindow no ofrece vídeo perfecto de aplicaciones aceleradas: cuando no puede capturarlas muestra un estado de error, no inventa una imagen.

## Evidencia y pendientes
- Se añaden pruebas contractuales de parser, separación UI/pipe y preflight del modelo. Estas pruebas deben ejecutarse en CI Windows porque el entorno de edición no tiene SDK de .NET ni escritorio Windows.
- El arrendamiento evita que dos conversaciones emitan acciones simultáneas al visor compartido; **no es todavía una máquina virtual independiente por conversación**. El control del sistema sigue afectando al escritorio interactivo Windows.
- Una captura confirmada demuestra visibilidad, no éxito de una tarea gráfica completa: el agente debe revisar su captura posterior antes de afirmar que guardó un archivo.
