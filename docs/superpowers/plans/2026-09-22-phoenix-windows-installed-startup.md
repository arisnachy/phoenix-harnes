# Arranque instalado de Phoenix para Windows: plan de implementación

> **Para agentes de ejecución:** subskill requerida: usar superpowers:subagent-driven-development para implementar cada tarea y hacer una revisión independiente por tarea.

**Objetivo:** hacer que la copia instalada abra la ventana, inicie el runtime administrado correcto, sobreviva a fallos recuperables y quede verificada mediante el instalador real en CI de Windows.

**Arquitectura:** el runtime fuente solo se selecciona con PHOENIX_SOURCE_ROOT explícito; la instalación normal usa el runtime administrado empaquetado. La prueba de aceptación instala el EXE de Inno Setup en el runner Windows y arranca esa copia desde una carpeta de perfil limpia.

**Stack:** .NET 8 WinForms, PowerShell para el smoke de CI, Inno Setup, GitHub Actions y pruebas de contrato en C#.

**Especificación:** [Phoenix Windows: arranque, Computer rápido, credenciales y aprendizaje](../specs/2026-09-22-phoenix-windows-desktop-launch-design.md).

## Restricciones globales

- No selecciones un checkout de desarrollo salvo que PHOENIX_SOURCE_ROOT identifique uno explícitamente.
- La instalación normal no ejecuta PowerShell, pnpm, tsx ni archivos de un checkout del usuario.
- La ventana aparece antes de que el runtime esté listo y muestra progreso o un error recuperable.
- Solo detén el árbol de procesos iniciado y poseído por esta instancia de Phoenix.
- Un listener ajeno o incompatible no se adopta ni se detiene; el shell puede conectarse a un runtime Phoenix compatible solo tras validar su PID, su comando y su identidad.
- La reparación prepara y valida una copia nueva antes de reemplazar la última copia sana.
- Comprueba el SHA remoto de main y stable por separado; conserva sus historiales divergentes.

## Enfoque de revisión

- Checkout convencional presente sin PHOENIX_SOURCE_ROOT: la instalación elige el runtime administrado; lo prueba la prueba de contrato de DesktopSourceCheckout.
- Supervisor que termina entre la última respuesta HTTP y MarkRuntimeReady: Phoenix rechaza readiness y conserva el estado recuperable; lo prueba el test de vida del proceso servidor.
- Puerto 3080 servido por otra aplicación: Phoenix no adopta el listener ni lo termina; un proceso Phoenix ya compatible se valida por PID y se deja vivo al cerrar el shell.
- Instalador ejecutado con /VERYSILENT: los comandos [Run] con skipifsilent no se consideran probados; el smoke ejecuta explícitamente la copia instalada y comprueba la clave Run y los accesos directos.
- Runtime anterior con archivos abiertos o semilla inválida: la reparación conserva la última copia sana; lo prueba la instalación sintética de DesktopRuntimeSeedInstaller.

## Orden de integración

Este cambio entra primero porque establece el arranque instalado y el smoke del instalador que usarán las siguientes fases. Después se integra el driver nativo, luego el broker y por último el aprendizaje; los planes posteriores esperan a que este cambio esté integrado en main y backportado a stable porque comparten el workflow Windows.

---

### Tarea 1: hacer explícita la selección entre modo fuente y modo instalado

**Archivos:**

- Modificar: apps/desktop-windows/Program.cs, método PhoenixApplicationContext.StartAsync.
- Modificar: apps/desktop-windows/DesktopStartupContracts.cs, métodos DesktopSourceCheckout.ShouldUseSourceCheckout y DesktopSourceCheckout.Resolve.
- Prueba: apps/desktop-windows/Phoenix.Desktop.Tests/Program.cs.

**Interfaces:**

- Consume: DesktopSourceCheckout.ShouldUseSourceCheckout(bool developerConsoleVisible) y DesktopSourceCheckout.Resolve(string stateRoot, bool includeConventional = false).
- Produce: DesktopStartupContract.ResolveSourceRoot(string stateRoot, bool sourceModeRequested) retorna null en modo instalado y resuelve solo una raíz explícita en modo fuente; StartAsync usa este método.

- [ ] **Paso 1: añadir la regresión del checkout convencional**

~~~csharp
Environment.SetEnvironmentVariable("PHOENIX_SOURCE_ROOT", null);
False(DesktopSourceCheckout.ShouldUseSourceCheckout(developerConsoleVisible: false),
    "installed launch ignores a conventional source checkout", failures);
var startupContract = typeof(DesktopSourceCheckout).Assembly.GetType("Phoenix.Desktop.DesktopStartupContract");
var resolver = startupContract?.GetMethod(
    "ResolveSourceRoot",
    System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);
True(resolver is not null, "source root resolver exists", failures);
if (resolver is not null)
{
    Environment.SetEnvironmentVariable("PHOENIX_SOURCE_ROOT", null);
    Equal(null, resolver.Invoke(null, new object?[] { sourceInstallRoot, false }),
        "installed launch ignores a conventional source checkout", failures);
    Environment.SetEnvironmentVariable("PHOENIX_SOURCE_ROOT", sourceTestRoot);
    Equal(Path.GetFullPath(sourceTestRoot), resolver.Invoke(null, new object?[] { sourceInstallRoot, true }),
        "source mode resolves the explicit checkout", failures);
}
~~~

- [ ] **Paso 2: ejecutar la prueba C# y confirmar el fallo de selección**

Ejecutar: dotnet run --project apps/desktop-windows/Phoenix.Desktop.Tests/Phoenix.Desktop.Tests.csproj -c Release.

Esperado antes del cambio: la prueba compila y falla con la aserción "source root resolver exists"; una excepción de compilación o de ejecución no cuenta como RED válido.

- [ ] **Paso 3: limitar StartAsync al modo fuente explícito**

En StartAsync, pasa el resultado de ShouldUseSourceCheckout a DesktopStartupContract.ResolveSourceRoot; ese helper solo consulta PHOENIX_SOURCE_ROOT cuando el modo fuente es explícito y nunca incluye raíces convencionales o el puntero verificado sin esa petición.

- [ ] **Paso 4: verificar modo fuente explícito y modo instalado**

Ejecutar: dotnet run --project apps/desktop-windows/Phoenix.Desktop.Tests/Phoenix.Desktop.Tests.csproj -c Release.

Esperado: pasa el caso con PHOENIX_SOURCE_ROOT apuntando a un checkout arrancable y pasa el caso sin esa variable, aunque exista una raíz convencional sintética.

- [ ] **Paso 5: confirmar el diff y registrar el cambio**

Ejecutar: git diff --check.

Confirmar que el cambio no altera el launcher de desarrollo cuando PHOENIX_SOURCE_ROOT sí está definido.

### Tarea 2: hacer que readiness pertenezca al supervisor vivo

**Archivos:**

- Modificar: apps/desktop-windows/Program.cs, métodos StartOwnedRuntimeAsync, IsStableReadyAsync y StopOwnedRuntime.
- Modificar: apps/desktop-windows/DesktopStartupContracts.cs, contratos de identidad Phoenix y proceso iniciado.
- Prueba: apps/desktop-windows/Phoenix.Desktop.Tests/Program.cs.

**Interfaces:**

- Consume: el Process guardado por StartOwnedRuntimeAsync y DesktopRuntimeLaunchContract.LooksLikePhoenixProcessCommandLine.
- Produce: MarkRuntimeReady solo ocurre si el proceso supervisor iniciado por esta instancia sigue vivo y dos respuestas consecutivas identifican Phoenix, o si el listener existente pertenece a un proceso Phoenix compatible que sigue vivo; StopOwnedRuntime termina únicamente el árbol que esta instancia inició.

- [x] **Paso 1: añadir pruebas para salida del supervisor y listener ajeno**

~~~csharp
var runtimeContractType = typeof(DesktopRuntimeLaunchContract);
var canMarkReady = runtimeContractType.GetMethod(
    "CanMarkReady",
    System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);
var canAdoptListener = runtimeContractType.GetMethod(
    "CanAdoptListener",
    System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);
True(canMarkReady is not null, "runtime readiness decision exists", failures);
True(canAdoptListener is not null, "listener adoption decision exists", failures);
if (canMarkReady is not null)
    Equal(false, canMarkReady.Invoke(null, new object?[] { true, 2 }),
        "an exited owned supervisor cannot mark Phoenix ready", failures);
if (canAdoptListener is not null)
{
    Equal(false, canAdoptListener.Invoke(null, new object?[] { "python -m http.server 3080" }),
        "an unrelated listener is never adopted", failures);
    Equal(true, canAdoptListener.Invoke(null, new object?[] { "node scripts/phoenix-windows-supervisor.mjs" }),
        "a compatible Phoenix listener may serve the desktop without becoming owned", failures);
}
~~~

- [x] **Paso 2: ejecutar la prueba C# antes de implementar el contrato**

Ejecutar: dotnet run --project apps/desktop-windows/Phoenix.Desktop.Tests/Phoenix.Desktop.Tests.csproj -c Release.

Esperado antes del cambio: la prueba compila y falla con las aserciones de contrato ausente; una excepción de compilación o de ejecución no cuenta como RED válido.

- [x] **Paso 3: validar proceso, identidad y propiedad inmediatamente antes de readiness**

Mantén el Process asociado al árbol iniciado por Phoenix; tras la segunda respuesta HTTP y justo antes de MarkRuntimeReady, confirma HasExited == false y la identidad Phoenix. Si el puerto ya lo sirve una instancia Phoenix compatible, verifica su PID, línea de comando y endpoint dos veces; permite que el shell se conecte, pero no registra ese árbol como propio ni lo termina. Ante listener incompatible, conserva la pantalla de recuperación y ejecuta solo el fallback administrado.

- [x] **Paso 4: verificar la matriz de propiedad**

Ejecutar: dotnet run --project apps/desktop-windows/Phoenix.Desktop.Tests/Phoenix.Desktop.Tests.csproj -c Release.

Esperado: una identidad HTTP no Phoenix y un supervisor terminado nunca producen readiness ni provocan que Phoenix termine el listener ajeno; un servicio Phoenix compatible puede atender el shell sin ceder la propiedad de su árbol.

- [x] **Paso 5: revisar el ciclo de reparación**

Ejecutar: dotnet run --project apps/desktop-windows/Phoenix.Desktop.Tests/Phoenix.Desktop.Tests.csproj -c Release.

Esperado: una semilla inválida o una extracción fallida conserva la copia administrada sana y la ventana comunica recuperación.

### Tarea 3: instalar y probar el instalador Inno Setup en CI Windows

**Archivos:**

- Crear: scripts/windows-installed-smoke.ps1.
- Modificar: .github/workflows/phoenix-windows-desktop.yml.
- Prueba: scripts/windows-installer.spec.ts.
- Referencia de configuración: installer/windows/Phoenix.iss.

**Interfaces:**

- Consume: el Phoenix-Windows-Setup.exe producido por el paso Inno Setup y los argumentos -InstallerPath y -SmokeRoot del script.
- Produce: código de salida cero solo cuando la copia instalada, los assets, shortcuts, inicio de sesión, runtime administrado y ventana cumplen el smoke.

- [x] **Paso 1: añadir el contrato del smoke instalado**

Añade existsSync a los imports de Node; el test comprueba la existencia antes de leer el script y retorna si falta, de modo que RED sea una aserción y no un error de archivo ausente.

~~~ts ignore-check
it('runs the Inno installer against a temporary install root and checks autostart entries', () => {
  const scriptPath = resolve(root, 'scripts/windows-installed-smoke.ps1')
  const scriptExists = existsSync(scriptPath)
  expect(scriptExists).toBe(true)
  if (!scriptExists) return
  const smokeScript = readFileSync(scriptPath, 'utf8')
  expect(smokeScript).toContain('Phoenix-Windows-Setup.exe')
  expect(smokeScript).toContain('CurrentVersion\\\\Run')
  expect(smokeScript).toContain('--smoke-window')
})
~~~

- [x] **Paso 2: verificar que la prueba detecta un smoke ausente**

Ejecutar: pnpm exec vitest run scripts/windows-installer.spec.ts.

Esperado: falla hasta que exista el script conectado al workflow.

- [x] **Paso 3: implementar el smoke con instalación silenciosa y lanzamiento explícito**

El script ejecuta el instalador con /VERYSILENT, /SUPPRESSMSGBOXES, /NORESTART, /TASKS=desktopicon,autostart y /DIR en un directorio temporal; valida Phoenix.exe, runtime-seed.zip, Node, MinGit y WebView2Loader.dll; comprueba el acceso directo, HKCU Run y destino de instalación.

La instalación silenciosa omite las entradas [Run] que tienen skipifsilent; por eso el script lanza Phoenix.exe por separado con --prepare-runtime, --prepare-webview, --enable-autostart, --smoke-webview-loopback y --smoke-window, espera cada proceso y verifica su log. No pasa varios flags a una sola instancia porque Program.MainCore termina tras el primer comando de preparación.

Después, arranca Phoenix.exe sin flags, espera en un log nuevo la ventana visible y el readiness administrado, verifica la identidad HTTP y demuestra que el listener pertenece al árbol de procesos iniciado por Phoenix. La comprobación incluye PID y tiempo de creación antes y después de la solicitud HTTP. El script detiene el árbol mediante el Process capturado y verifica que sus descendientes terminaron antes de desinstalar o eliminar el perfil aislado. El bloque finally ejecuta el desinstalador y retira solo los valores Run, accesos directos, registros y directorios creados por esta ejecución; ante una falla de propiedad o cierre, conserva la instalación y el perfil para diagnóstico.

- [x] **Paso 4: conectar el smoke después de compilar el instalador**

El workflow usa el artefacto de ISCC.exe ya generado, invoca scripts/windows-installed-smoke.ps1 con la ruta del instalador y SmokeRoot dentro de runner.temp antes de los lanzamientos sueltos que crean el perfil Phoenix. Si falla, publica los diagnósticos preservados; no cambia el comportamiento del instalador ni sus tareas autostart existentes.

- [x] **Paso 5: validar la prueba estática del instalador**

Ejecutar: pnpm exec vitest run scripts/windows-installer.spec.ts.

Esperado: pasa la comprobación del script, de la ruta de instalación y de los pasos ejecutados explícitamente.

- [ ] **Paso 6: ejecutar la aceptación Windows**

Ejecutar: dotnet run --project apps/desktop-windows/Phoenix.Desktop.Tests/Phoenix.Desktop.Tests.csproj -c Release; en CI, ejecutar el workflow phoenix-windows-desktop.

Esperado: el runner instala y ejecuta la copia desde SmokeRoot; el log demuestra ventana, identidad del servicio y readiness; el test no borra datos fuera de SmokeRoot.

### Tarea 4: documentar el contrato y el registro de decisión

**Archivos:**

- Modificar: docs/phoenix-windows.md, docs/phoenix-windows.zh.md y docs/phoenix-windows.i18n.yaml.
- Crear en la PR de implementación: .agents/notes/implemented/bug-fix/2026-09-22-windows-installed-desktop-startup.md y su contraparte china y sidecar.
- Modificar: apps/desktop-windows/Phoenix.Desktop.Tests/Program.cs si la revisión final añade casos de reentrada.

**Interfaces:**

- Consume: el contrato de modo fuente explícito y la readiness del supervisor propio.
- Produce: documentación actual que explica el arranque instalado, el inicio de sesión y la recuperación visible.

- [x] **Paso 1: actualizar el README de escritorio**

Documenta el modo fuente con PHOENIX_SOURCE_ROOT, el runtime empaquetado normal, el comportamiento del inicio con Windows y el diagnóstico del overlay de arranque; actualiza el texto chino y vuelve a registrar docs/phoenix-windows.i18n.yaml siguiendo docs/i18n/README.md.

- [x] **Paso 2: escribir el Agent Note como decisión implementada**

Registra el defecto de selección de checkout, la propiedad del supervisor y el requisito de instalar el EXE Inno en CI; expresa el estado que se envía, no una lista de deseos.

- [ ] **Paso 3: ejecutar los gates del área**

Ejecutar: dotnet run --project apps/desktop-windows/Phoenix.Desktop.Tests/Phoenix.Desktop.Tests.csproj -c Release; pnpm exec vitest run scripts/windows-installer.spec.ts; pnpm run doc-sync.

Esperado: pasan los contratos C#, el test del instalador y los gates de documentación.

- [ ] **Paso 4: separar integración de main y stable**

Abre primero el PR contra main; tras la integración y la verificación de su SHA, prepara el backport sobre stable sin fusionar los historiales divergentes. No declares la entrega completa hasta comprobar ambos SHAs remotos.

### Criterio de cierre

El EXE instalado se prueba desde el instalador de Inno en un perfil Windows limpio; la instalación normal no selecciona checkouts convencionales; el runtime solo marca readiness mientras el supervisor propio o un proceso Phoenix compatible validado sigue vivo; los procesos ajenos permanecen intactos; main y stable contienen el cambio integrado.
