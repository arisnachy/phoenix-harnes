# Computer nativo y latencia de Windows: plan de implementación

> **Para agentes de ejecución:** subskill requerida: usar superpowers:subagent-driven-development para implementar cada tarea y hacer una revisión independiente por tarea.

**Objetivo:** reducir el tiempo de Computer en Phoenix Desktop eliminando la compilación y el proceso PowerShell por acción, y publicar mediciones comparables con Computer de Codex en el mismo equipo.

**Arquitectura:** primero se mide cada etapa con datos que no incluyen texto, URL, formularios o imágenes. Luego Phoenix Desktop ejecuta Computer desde un driver C# residente y un canal versionado; el consumidor TypeScript conserva validación, permisos, cancelación y adjuntos.

**Stack:** TypeScript, Node.js, .NET 8 WinForms, WebView2, named pipes, vitest, pruebas de contrato C# y GitHub Actions Windows.

**Especificación:** [Phoenix Windows: arranque, Computer rápido, credenciales y aprendizaje](../specs/2026-09-22-phoenix-windows-desktop-launch-design.md).

## Orden de integración

Depende del smoke del instalador del [plan de arranque](2026-09-22-phoenix-windows-installed-startup.md) y debe integrarse después de ese cambio. Entrega schema 2 al plan del [broker](2026-09-22-phoenix-windows-credential-broker.md); workflow, BrowserContracts.cs y computer.ts no se trabajan en paralelo.

## Restricciones globales

- No declares paridad con Codex sin medir las mismas acciones en el mismo hardware, perfil y estado frío o cálido.
- En la ruta de Phoenix Desktop no compiles C# ni arranques PowerShell por acción.
- Conserva la aprobación actual, el permiso derivado del sandbox, la cancelación y el límite de operaciones concurrentes.
- Toda mutación conserva una observación nueva; status ok solo significa que Windows aceptó la operación.
- El canal no registra texto, campos, contenido web, rutas, query strings, fragmentos, imágenes ni valores de credenciales.
- Los timeouts que varían por despliegue se exponen en Config validada; los límites del protocolo permanecen constantes.
- El canal schema 2 transporta browser_login sin secretos; el pipe privado host-a-broker y su capacidad de un uso se especifican en [el plan del vault](2026-09-22-phoenix-windows-credential-broker.md).

## Enfoque de revisión

- Primera acción tras un arranque frío: el handshake inicial se mide aparte y no se confunde con latencia de acción cálida.
- Dos llamadas simultáneas al canal: se serializan sin mezclar requestId, screenshots ni respuesta.
- Cancelación durante una acción o una navegación: cierra la petición actual y no deja un proceso PowerShell ni un bloqueo del pipe.
- WebView2 todavía cargando: browser_open espera NavigationCompleted con timeout y cancelación, sin retardo fijo.
- Descriptor obsoleto o propietario reiniciado: el cliente reconecta solo al descriptor válido de Phoenix y rechaza otro proceso.

---

### Tarea 1: instrumentar línea base fría y cálida

**Archivos:**

- Modificar: packages/shell/tool-pwsh/src/computer.ts, funciones authorizeComputerAction, runWindowsComputerAction, runEmbeddedBrowserAction, executeComputerInvocation y attachDesktopScreenshot.
- Modificar: packages/shell/tool-pwsh/src/index.ts, Config.
- Prueba: packages/shell/tool-pwsh/tests/computer.spec.ts.
- Crear: scripts/windows-computer-benchmark.ps1.
- Crear: scripts/windows-computer-benchmark-fixture.html.

**Interfaces:**

- Produce: ComputerStageTiming { stage, durationMs } para las etapas approval, driver-start, descriptor, connect, host-dispatch, webview-ready, action, capture y attachment; no contiene args ni resultados.
- Config de tool-pwsh añade controlTimeoutMs opcional, entero entre 1000 y 60000, con valor predeterminado validado de 10000 ms; la clave de cordis.yml es tool-pwsh.controlTimeoutMs.
- El script produce CSV con acción, modo cold/warm, etapa, duración y resultado, sin texto de usuario ni contenido web; Codex se mide manualmente en el mismo equipo porque el runner de CI no lo instala.

- [ ] **Paso 1: añadir pruebas de nombres y redacción de medidas**

~~~ts ignore-check
expect(timings.map(item => item.stage)).toEqual([
  'approval', 'driver-start', 'descriptor', 'connect', 'host-dispatch', 'webview-ready', 'action', 'capture', 'attachment',
])
expect(JSON.stringify(timings)).not.toMatch(/example\\.com|private-form|credential-value|base64/i)
~~~

- [ ] **Paso 2: ejecutar Computer tests antes de instrumentar**

Ejecutar: pnpm exec vitest run packages/shell/tool-pwsh/tests/computer.spec.ts.

Esperado: falla el test nuevo porque el resultado de medición todavía no existe.

- [ ] **Paso 3: medir con reloj monotónico y mantener datos fuera del protocolo de modelo**

Usa performance.now() para tiempos locales; envía únicamente nombre de etapa y duración al logger técnico configurado; no serialices args, URL, textos, screenshot, stdout, campos ni secretos. Mide driver-start solo en el arranque frío, registra la etapa como omitida en el camino cálido y mide webview-ready únicamente para acciones del navegador. Valida tool-pwsh.controlTimeoutMs al cargar Config y úsalo al conectar y esperar respuestas.

- [ ] **Paso 4: añadir un benchmark repetible**

El script sirve scripts/windows-computer-benchmark-fixture.html solo en loopback, inicia el runner instalado de Phoenix y lanza un lote fijo de screenshot, windows, click reversible y browser_open; registra 30 muestras en frío/caliente y percentiles p50/p95 por etapa. Limpia su directorio temporal y no captura datos de sitios reales.

- [ ] **Paso 5: ejecutar el test TypeScript**

Ejecutar: pnpm exec vitest run packages/shell/tool-pwsh/tests/computer.spec.ts.

Esperado: pasan las validaciones de esquema, tiempos por etapa y ausencia de datos sensibles.

### Tarea 2: añadir el driver C# residente y el protocolo versionado

**Archivos:**

- Crear: apps/desktop-windows/DesktopComputerDriver.cs.
- Modificar: apps/desktop-windows/BrowserContracts.cs.
- Modificar: apps/desktop-windows/DesktopBrowserControl.cs.
- Modificar: apps/desktop-windows/PhoenixDesktopWindow.cs.
- Prueba: apps/desktop-windows/Phoenix.Desktop.Tests/Program.cs.

**Interfaces:**

- El protocolo nativo usa schema 2, requestId único, action discriminada, parámetros validados y reply { schema, requestId, ok, details, screenshotBase64?, timings }.
- DesktopBrowserControlServer conserva una conexión viva, procesa una petición por vez y confirma el requestId antes de devolver respuesta.
- DesktopComputerDriver ejecuta windows, focus, move, click, double_click, drag, type, key, scroll y screenshot con Win32; no lanza procesos por acción.
- El server autentica que el named pipe lo abrió el runtime hijo de esta instancia; CurrentUserOnly por sí solo no autoriza comandos.

- [ ] **Paso 1: añadir tests C# para protocolo, orden y propietario**

~~~csharp
False(BrowserCommand.TryParse("{\"schema\":2,\"requestId\":\"r1\",\"type\":\"unknown\"}", out _),
    "unknown desktop action is rejected", failures);
False(DesktopBrowserControlServer.IsAllowedClient(clientPid: 999, runtimePid: 123),
    "same-user process outside the owned runtime is rejected", failures);
True(DesktopComputerProtocol.MatchesReply("r1", "r1"), "reply must match request id", failures);
False(DesktopComputerProtocol.MatchesReply("r1", "r2"), "reply cannot cross requests", failures);
~~~

- [ ] **Paso 2: ejecutar el contrato C# y confirmar los fallos**

Ejecutar: dotnet run --project apps/desktop-windows/Phoenix.Desktop.Tests/Phoenix.Desktop.Tests.csproj -c Release.

Esperado: fallan las comprobaciones de schema 2, identidad del cliente y correlación.

- [ ] **Paso 3: mover el driver del bloque Add-Type a DesktopComputerDriver**

Traslada la interoperabilidad Win32 actual de packages/shell/tool-pwsh/src/computer.ts a una clase C# compilada con Phoenix; preserva DPI, comprobación del foreground target, restauración segura de ventana y envío de teclado y mouse. Rechaza el comando cuando el target esperado no coincide con la ventana foreground.

- [ ] **Paso 4: mantener un canal vivo con backpressure y propiedad**

Extiende DesktopBrowserControlServer para aceptar conexiones del runtime hijo verificado, mantener el stream mientras el cliente y la instancia vivan, despachar serialmente y cerrar al cancelar o sustituir el descriptor. Obtén el PID del cliente del pipe con GetNamedPipeClientProcessId y compáralo con el Process hijo guardado por Phoenix.

- [ ] **Paso 5: ejecutar los contratos C#**

Ejecutar: dotnet run --project apps/desktop-windows/Phoenix.Desktop.Tests/Phoenix.Desktop.Tests.csproj -c Release.

Esperado: pasan parser, PID, correlación, serialización, desconexión, cierre y cancelación.

### Tarea 3: enrutar TypeScript por el canal residente

**Archivos:**

- Modificar: packages/shell/tool-pwsh/src/computer.ts, funciones browserCommandForAction, requestNamedPipeLine, runEmbeddedBrowserAction, windowsComputerInvocation, executeComputerInvocation y runWindowsComputerAction.
- Modificar: packages/shell/tool-pwsh/tests/computer.spec.ts.

**Interfaces:**

- Consume: DesktopBrowserControlDescriptor schema 2 y DesktopComputerProtocol request/response definidos en la Tarea 2.
- Produce: desktopComputerCommandForAction(args, requestId) devuelve el request schema 2 validado; runWindowsComputerAction conserva su firma y usa el canal residente cuando PHOENIX_DESKTOP_CONTROL_DESCRIPTOR existe; el modo sin Phoenix Desktop conserva el proveedor PowerShell existente.

- [ ] **Paso 1: añadir pruebas de despacho y compatibilidad de modo**

~~~ts ignore-check
expect(desktopComputerCommandForAction({ action: 'click', x: 12, y: 34 }, 'request-1')).toMatchObject({
  requestId: 'request-1', schema: 2, type: 'click', x: 12, y: 34,
})
expect(windowsComputerInvocation({ action: 'windows' }).file).toBe('powershell.exe')
~~~

- [ ] **Paso 2: ejecutar Computer tests para demostrar el fallo de enrutamiento**

Ejecutar: pnpm exec vitest run packages/shell/tool-pwsh/tests/computer.spec.ts.

Esperado: falla la aserción que requiere enviar acciones de escritorio al canal residente.

- [ ] **Paso 3: implementar el cliente persistente**

Mantén la conexión en una instancia por proceso; serializa peticiones con una cola; valida schema, requestId y tamaño de respuesta; al cambiar el descriptor o PID, cierra y vuelve a leer el descriptor; al timeout o abort, destruye la conexión y rechaza la operación sin repetir una mutación automáticamente.

- [ ] **Paso 4: enrutar acciones Windows normales al driver residente**

En modo Desktop, envía acciones generales a schema 2 y no llames executeComputerInvocation; conserva el fallback PowerShell únicamente cuando no se ejecuta bajo el host nativo. No cambies authorizeComputerAction, computerModeForSandbox ni el pipeline de aprobación.

- [ ] **Paso 5: probar secuencia, concurrencia, timeout y cancelación**

Ejecutar: pnpm exec vitest run packages/shell/tool-pwsh/tests/computer.spec.ts.

Esperado: no se mezclan respuestas paralelas, timeout produce error visible y una acción abortada no queda en cola.

### Tarea 4: reemplazar esperas fijas por finalización observable y adjunto fresco

**Archivos:**

- Modificar: packages/shell/tool-pwsh/src/computer.ts, POST_ACTION_SETTLE_MS, shouldCaptureAfterAction, runWindowsComputerAction y attachDesktopScreenshot.
- Modificar: apps/desktop-windows/PhoenixDesktopWindow.cs, ExecuteBrowserCommandCoreAsync y operaciones de navegación.
- Prueba: packages/shell/tool-pwsh/tests/computer.spec.ts.
- Prueba: apps/desktop-windows/Phoenix.Desktop.Tests/Program.cs.

**Interfaces:**

- El driver devuelve cuando termina la inyección Win32 y el screenshot solicitado, con la misma requestId.
- browser_open espera NavigationCompleted o falla con el timeout de Config; una cancelación cancela la espera.
- browser_login no captura campos protegidos; el broker seguro se implementa en [el plan del vault](2026-09-22-phoenix-windows-credential-broker.md).

- [ ] **Paso 1: añadir la regresión de finalización sin delay**

~~~ts ignore-check
const computerSource = await readFile(new URL('../src/computer.ts', import.meta.url), 'utf8')
expect(computerSource).not.toContain('POST_ACTION_SETTLE_MS')
expect(shouldCaptureAfterAction('click')).toBe(true)
expect(shouldCaptureAfterAction('move')).toBe(false)
~~~

- [ ] **Paso 2: ejecutar Computer tests**

Ejecutar: pnpm exec vitest run packages/shell/tool-pwsh/tests/computer.spec.ts.

Esperado antes del cambio: falla porque la ruta todavía incluye POST_ACTION_SETTLE_MS.

- [ ] **Paso 3: tomar screenshot al completar la acción y navegar por evento**

Retira delay(250) de la ruta caliente; el reply de C# incluye la observación posterior a la mutación. Para browser_open, completa al recibir NavigationCompleted y añade el screenshot después del evento; devuelve un error explícito si WebView2 no termina dentro del límite validado.

- [ ] **Paso 4: conservar la captura y el contrato visual**

Adjunta una observación nueva tras toda acción mutante. browser_login devuelve únicamente estado permitido y una captura cuya cuenta y contraseña ya fueron cubiertas por PhoenixDesktopWindow; nunca serializa la captura sin redacción previa. El texto de contexto dice que status ok solo acredita la operación del sistema. Mantén screenshot completo para otras aplicaciones y permite captura del panel WebView2 cuando la tarea sea exclusivamente web.

- [ ] **Paso 5: ejecutar vitest y contratos Windows**

Ejecutar: pnpm exec vitest run packages/shell/tool-pwsh/tests/computer.spec.ts; dotnet run --project apps/desktop-windows/Phoenix.Desktop.Tests/Phoenix.Desktop.Tests.csproj -c Release.

Esperado: pasan los contratos de screenshot, navegación, cancelación y timeout.

### Tarea 5: demostrar la mejora y publicar la comparación

**Archivos:**

- Modificar: scripts/windows-computer-benchmark.ps1.
- Modificar: .github/workflows/phoenix-windows-desktop.yml.
- Crear en la PR de implementación: .agents/notes/implemented/architecture/2026-09-22-resident-windows-computer-driver.md y su contraparte china y sidecar.
- Modificar: packages/shell/tool-pwsh/README.md, README.zh.md y README.i18n.yaml.

**Interfaces:**

- Consume: CSV sintético del benchmark sin texto, sitios externos, screenshots ni credenciales.
- Produce: reporte de p50/p95 por etapa y modo frío/cálido para las mismas acciones en Phoenix y Codex Computer sobre el mismo equipo.

- [ ] **Paso 1: registrar mediciones comparables**

En una máquina Windows interactiva, ejecuta 30 veces screenshot, windows, click reversible sobre el fixture y navegación loopback con Phoenix y Codex Computer bajo las mismas condiciones; separa startup frío, handshake y acción cálida; publica solo percentiles y configuración del equipo. CI ejecuta únicamente el benchmark de Phoenix y valida el formato CSV; no se afirma que Codex esté instalado en GitHub Actions.

- [ ] **Paso 2: comparar las mediciones y explicar cada etapa**

El reporte muestra la línea base anterior, el resultado con el driver residente y Codex Computer; si alguna etapa permanece más lenta, atribuye su latencia a su etapa medida y no afirma igualdad.

- [ ] **Paso 3: actualizar el contrato del paquete y el Agent Note**

Documenta el modo Desktop residente, fallback fuera del host, timeouts, cancelación, captura y el límite de comparación medido; registra los motivos de mantener el permiso existente y el canal autenticado por PID.

- [ ] **Paso 4: validar solo los gates afectados**

Ejecutar: pnpm exec vitest run packages/shell/tool-pwsh/tests/computer.spec.ts; dotnet run --project apps/desktop-windows/Phoenix.Desktop.Tests/Phoenix.Desktop.Tests.csproj -c Release; pnpm run doc-sync.

Esperado: pasan TypeScript, contratos nativos y documentación; CI ejecuta el instalador Windows de [el plan de arranque](2026-09-22-phoenix-windows-installed-startup.md).

### Criterio de cierre

En el Desktop instalado no hay proceso PowerShell ni compilación C# por acción; la cancelación y la captura siguen siendo correctas; el benchmark muestra p50/p95 por etapa en frío y caliente junto con Codex Computer, sin afirmar paridad si las medidas no la demuestran.
