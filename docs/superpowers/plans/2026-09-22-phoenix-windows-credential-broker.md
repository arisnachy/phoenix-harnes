# Vault web protegido de Windows: plan de implementación

> **Para agentes de ejecución:** subskill requerida: usar superpowers:subagent-driven-development para implementar cada tarea y hacer una revisión independiente por tarea.

**Objetivo:** capturar credenciales fuera del composer y del modelo, guardarlas bajo una identidad AppContainer aislada y rellenar formularios reconocidos solo en el origen HTTPS autorizado, sin enviar el formulario.

**Arquitectura:** el proceso Node solo solicita browser_login con origen y acción; el host .NET autentica el runtime, presenta una tarjeta temporal en el chat por WebView2 y delega lectura/escritura a un broker AppContainer con capacidades vacías. El broker conserva datos en su perfil protegido; el host nativo entrega la credencial a WebView2 sin devolverla a Node ni al modelo. No se declara aislamiento same-user hasta que un proceso de prueba de confianza completa y un proceso hermano del mismo AppContainer fallen al leer el almacén y usar el pipe.

**Stack:** .NET 8, Windows AppContainer, DPAPI para cifrado en reposo, named pipes locales con identidad de proceso, WebView2, React, autorización write-only y pruebas Windows con credenciales sintéticas.

**Especificación:** [Phoenix Windows: arranque, Computer rápido, credenciales y aprendizaje](../specs/2026-09-22-phoenix-windows-desktop-launch-design.md); el driver y la versión 2 del canal se definen en [el plan de Computer](2026-09-22-phoenix-computer-native-latency.md).

## Orden de integración

Depende del driver y schema 2 del [plan de Computer](2026-09-22-phoenix-computer-native-latency.md). Se integra después de que ese plan y el [plan de arranque](2026-09-22-phoenix-windows-installed-startup.md) estén en main y backportados a stable; así workflow, instalador, Computer y contratos C# mantienen un solo orden de cambio.

## Restricciones globales

- La contraseña y la cuenta no aparecen en argumentos de Computer, mensajes del modelo, tool/call, tool/result, registro de sesión, transcript, telemetría, aprendizaje, logs ni pipe general.
- El broker almacena las credenciales en un proceso AppContainer independiente; el host principal y Node no leen su archivo.
- CurrentUserOnly y DPAPI por sí solos no demuestran aislamiento; tanto un proceso full-trust del mismo usuario como un proceso hermano que intente unirse al mismo AppContainer deben fallar al leer el almacén y al invocar el pipe del broker.
- El origen permitido es HTTPS canónico con esquema, host y puerto efectivo; redirects, iframe, otro puerto y HTTP remoto se rechazan.
- Guardar y autofill requieren autorización explícita; rellenar nunca envía el formulario ni pulsa un botón.
- MFA, passkeys, CAPTCHA, consentimiento, campos ambiguos y otros retos permanecen con la persona; sus valores no se almacenan ni se capturan.
- Las credenciales de proveedores LLM y el modo de credentials-local quedan fuera del cambio; los logins web no se escriben en .credentials.yaml.
- El broker no recibe red ni capacidades de Windows que no necesite; su pipe solo acepta el host y una capacidad de un uso, ligada al origen, operación y vencimiento.
- La dependencia del canal residente se valida en el plan de Computer; el plan de arranque instala el nuevo ejecutable broker en el payload Inno.

## Enfoque de revisión

- Un proceso full-trust del mismo usuario y otro proceso lanzado con el SID AppContainer del broker intentan abrir el almacén: ambos deben recibir acceso denegado; de lo contrario se detiene esta arquitectura.
- Un proceso del mismo usuario conecta al pipe privado con una capacidad ausente, expirada, repetida o para otro origen: el broker lo rechaza.
- El runtime Node llama browser_login: sus argumentos y respuestas contienen origen y estado, pero nunca cuenta ni contraseña.
- Navegación a otro esquema, host, puerto, redirect o iframe entre autorización y rellenado: el broker no libera el secreto.
- Un formulario con varios usuarios, múltiples password fields, MFA, passkey, CAPTCHA o submit: la tarjeta informa el caso y devuelve control a la persona sin completar la acción.

---

### Tarea 1: probar y crear el broker AppContainer y su almacén aislado

**Archivos:**

- Crear: apps/desktop-windows/Phoenix.CredentialBroker/Phoenix.CredentialBroker.csproj y Program.cs.
- Crear: apps/desktop-windows/Phoenix.CredentialBroker/CredentialVaultStore.cs.
- Crear: apps/desktop-windows/DesktopCredentialBrokerProcess.cs.
- Crear: apps/desktop-windows/CredentialBrokerContracts.cs.
- Prueba: apps/desktop-windows/Phoenix.Desktop.Tests/Program.cs.

**Interfaces:**

- DesktopCredentialBrokerProcess.StartAsync(string brokerExecutable, string profileName, CancellationToken cancellationToken) inicia el proceso con CreateAppContainerProfile y PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES con cero capacidades.
- El broker expone Store(origin, account, secret, remember), Has(origin), FillOnce(origin, capability) y Forget(origin); remember=false conserva el dato solo en memoria hasta un uso y remember=true es lo único que escribe el vault. Solo FillOnce devuelve valores por el pipe privado al PID host verificado.
- El almacén vive dentro del perfil per-user, per-app del AppContainer; la ACL permite acceso al SID AppContainer y no concede lectura al SID interactivo del usuario. DPAPI protege el archivo en reposo, no sustituye la ACL.
- DesktopCredentialRequest incluye schema, requestId, origin, operation, nonce y expiresAtUtc; el nonce es de un solo uso.

- [ ] **Paso 1: añadir la prueba negativa desde proceso same-user**

El fixture del test crea `profileName`, `storePath`, `pipeName` y `requestWithoutCapability` bajo un directorio temporal, y el helper `SameUserBrokerProbe` se implementa en Phoenix.Desktop.Tests/Program.cs; no se reutiliza un vault ni una pipe del perfil real.

~~~csharp
// The fixture first proves the broker is alive and its valid host capability can fill once.
True(await SameUserBrokerProbe.HostCanFillOnceAsync(pipeName),
    "the protected broker fixture is live before the attack probe", failures);
var probe = await SameUserBrokerProbe.TryReadStoreAsync(storePath);
False(probe.Readable, "same-user full-trust process cannot read the AppContainer vault", failures);
var sibling = await SameUserBrokerProbe.TryLaunchSiblingAppContainerAsync(profileName, storePath);
False(sibling.Readable, "same-user sibling AppContainer cannot read the vault", failures);
False(await SameUserBrokerProbe.TryCallPipeAsync(pipeName, requestWithoutCapability),
    "same-user process cannot invoke the broker without host capability", failures);
~~~

- [ ] **Paso 2: ejecutar el contrato C# antes de crear el broker**

Ejecutar: dotnet run --project apps/desktop-windows/Phoenix.Desktop.Tests/Phoenix.Desktop.Tests.csproj -c Release.

Esperado: las pruebas nuevas fallan porque el store y pipe aún no existen. No se acepta DPAPI de usuario o Credential Manager como sustituto de aislamiento.

- [ ] **Paso 3: iniciar un AppContainer por usuario y aplicación**

Implementa el perfil con CreateAppContainerProfile; si ya existe, recupera su SID con DeriveAppContainerSidFromAppContainerName; crea el store bajo su ruta app-specific, aplica una ACL que concede acceso al SID AppContainer sin concederlo al SID interactivo del usuario y lanza el worker con PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES sin capabilities de red, cámara, archivos compartidos ni micrófono. Conserva solo las ACE de sistema que Windows requiere y comprueba su efecto con el probe full-trust.

El worker usa DPAPI solo como cifrado en reposo; nunca presenta DPAPI como control de lectura frente al mismo usuario. La prueba hermano AppContainer determina si el perfil por sí solo sirve; si ese proceso puede leer el archivo, detén la integración y solicita una decisión antes de usar un servicio con SID independiente que requiera privilegios de administrador o de reducir explícitamente la amenaza fuera del modelo.

- [ ] **Paso 4: implementar el protocolo privado autenticado**

El worker crea un named pipe LOCAL con ACL limitada; obtiene GetNamedPipeClientProcessId y exige el PID Phoenix host que lo inició; verifica schema, origin, operation, expiración y nonce; rechaza replay, origen distinto, mensajes excesivos y campos desconocidos. El protocolo de error retorna códigos fijos sin valores ni excepciones originales.

- [ ] **Paso 5: guardar y borrar credenciales sintéticas**

La prueba escribe una cuenta y contraseña sintéticas para https://vault.test, verifica Has y el flujo FillOnce solo desde el proceso Phoenix host, verifica el segundo uso fallido y elimina la entrada al terminar.

- [ ] **Paso 6: volver a ejecutar pruebas de aislamiento**

Ejecutar: dotnet run --project apps/desktop-windows/Phoenix.Desktop.Tests/Phoenix.Desktop.Tests.csproj -c Release.

Esperado: un proceso full-trust del mismo usuario no puede abrir el archivo del broker ni recibir la respuesta; el host legítimo puede hacer una operación de un solo uso.

### Tarea 2: capturar el secreto en la interfaz nativa de chat

**Archivos:**

- Crear: packages/client/ui-conversation/src/client/native-credential-prompt.ts.
- Crear: packages/client/ui-conversation/src/client/conversation-nodes/ComputerCredentialPrompt.tsx y CSS module.
- Modificar: packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx.
- Modificar: packages/client/ui-conversation/src/client/index.ts.
- Modificar: apps/desktop-windows/PhoenixDesktopWindow.cs, HandlePhoenixMessage y registro de WebMessageReceived.
- Prueba: packages/client/ui-conversation/tests/computer-credential-prompt.client.spec.tsx.
- Prueba: apps/desktop-windows/Phoenix.Desktop.Tests/Program.cs.

**Interfaces:**

- Desktop host publica ephemeral prompt { kind: 'computer-credential', requestId, origin, legacyCredentialPresent } por PostWebMessageAsJson.
- El componente recibe secreto como input type=password con autoComplete=off y envía { requestId, origin, account, secret, remember } solo con window.chrome.webview.postMessage.
- El host responde { requestId, accepted: true } o un código genérico; no devuelve ni copia el secreto. Para un botón submit, publica un segundo mensaje temporal de confirmación humana y solo ejecuta el submit después de una pulsación real en esa tarjeta.

- [ ] **Paso 1: probar que la entrada no usa el composer ni la API RPC**

~~~ts ignore-check
expect(screen.getByLabelText('Contraseña')).toHaveAttribute('type', 'password')
expect(screen.getByRole('checkbox', { name: /guardar y rellenar/i })).not.toBeChecked()
expect(apiClient.authorization.answer).not.toHaveBeenCalled()
~~~

- [ ] **Paso 2: ejecutar el test de UI antes del componente**

Ejecutar: pnpm exec vitest run packages/client/ui-conversation/tests/computer-credential-prompt.client.spec.tsx.

Esperado: falla porque el prompt nativo y la tarjeta temporal aún no existen.

- [ ] **Paso 3: implementar el mensaje temporal fuera del transcript**

La raíz de conversación mantiene el prompt solo en estado de componente; no lo añade a session store, composer, conversation node durable, assistant message, local storage, telemetry ni context. El formulario muestra el origen registrable, permite uso de una vez o guardar y rellenar en ese origen, no renderiza el valor tras enviar y borra el estado al aceptar, cancelar o cerrar la ventana. Una tarjeta de confirmación separada permite que la persona decida si pulsa el submit visible.

- [ ] **Paso 4: validar el origen de mensajería nativo**

El host acepta el WebMessageReceived solo desde la página Phoenix exacta servida en el loopback canónico; valida requestId activo, origin HTTPS normalizado y tamaño máximo; rechaza mensajes de otro frame, navegación o pestaña.

- [ ] **Paso 5: verificar teclado, accesibilidad y redacción**

El test recorre focus/submit/cancel con teclado, comprueba label y estado de error genérico, y escanea session store, composer, API calls y el JSON de salida por las cadenas sintéticas del test; ninguna coincide.

- [ ] **Paso 6: ejecutar pruebas nativas y de UI**

Ejecutar: pnpm exec vitest run packages/client/ui-conversation/tests/computer-credential-prompt.client.spec.tsx; dotnet run --project apps/desktop-windows/Phoenix.Desktop.Tests/Phoenix.Desktop.Tests.csproj -c Release.

Esperado: solo la ruta PostWebMessageAsJson entrega el valor al host nativo.

### Tarea 3: enlazar browser_login con el broker y rellenar sin submit

**Archivos:**

- Modificar: apps/desktop-windows/BrowserContracts.cs.
- Modificar: apps/desktop-windows/DesktopBrowserControl.cs.
- Modificar: apps/desktop-windows/PhoenixDesktopWindow.cs, ExecuteBrowserCommandCoreAsync, RequireBrowserForOriginAsync, LoginBrowserAsync y BrowserLoginScript.
- Modificar: packages/shell/tool-pwsh/src/computer.ts, ComputerToolArgs, browserCommandForAction, browserActionPreauthorized y runOriginBoundBrowserLogin.
- Modificar: packages/credentials/secret-vault/src/index.ts.
- Prueba: apps/desktop-windows/Phoenix.Desktop.Tests/Program.cs.
- Prueba: packages/shell/tool-pwsh/tests/computer.spec.ts.
- Prueba: packages/credentials/secret-vault/tests/secret-vault.spec.ts.

**Interfaces:**

- El modelo llama computer con { action: 'browser_login', origin }; BrowserCommand no contiene Account, Secret ni submit para browser_login.
- El host resuelve la credencial a través de DesktopCredentialBrokerProcess; el runtime Node recibe solo { phase, origin, submitted: false }.
- El login legacy /secret login-set deja de aceptar cuenta o contraseña en texto crudo; inicia el mismo prompt nativo o informa que se requiere Phoenix Desktop.

- [ ] **Paso 1: añadir pruebas de ausencia de valores y submit**

~~~ts ignore-check
expect(browserCommandForAction({ action: 'browser_login', origin: 'https://example.com/login' }))
  .toEqual({ schema: 2, requestId: expect.any(String), type: 'phoenix.browser.login', origin: 'https://example.com' })
expect(JSON.stringify(browserCommandForAction({ action: 'browser_login', origin: 'https://example.com' })))
  .not.toMatch(/account|secret|submit/i)
~~~

- [ ] **Paso 2: ejecutar tests de Computer, vault y contratos nativos**

Ejecutar: pnpm exec vitest run packages/shell/tool-pwsh/tests/computer.spec.ts packages/credentials/secret-vault/tests/secret-vault.spec.ts; dotnet run --project apps/desktop-windows/Phoenix.Desktop.Tests/Phoenix.Desktop.Tests.csproj -c Release.

Esperado: fallan los casos que hoy esperan account/secret en BrowserCommand y submit por defecto.

- [ ] **Paso 3: quitar valores del runtime y del pipe general**

Elimina el parámetro login que resuelve ctx.credentials en Node; quita Account y Secret del BrowserCommand y del parser JSON; el comando browser_login transmite origen y acción únicamente. Authenticate al cliente del pipe con el PID del runtime hijo almacenado por Phoenix.

- [ ] **Paso 4: pedir y guardar desde el host**

Cuando Has(origin) es falso, pausa la petición del canal, muestra ComputerCredentialPrompt, manda account/secret al worker AppContainer desde PhoenixDesktopWindow y continúa solo con accepted. Si remember es falso, el worker conserva la entrada solo en memoria con vencimiento breve y un uso, sin escribirla al disco; si es true, persiste únicamente en el vault AppContainer.

- [ ] **Paso 5: reconocer y rellenar campos sin pulsar**

BrowserLoginScript solo considera controles visibles del top document en el origen exacto; exige como máximo un candidato de usuario y un password field, rechaza MFA, one-time-code, passkey, CAPTCHA y páginas ambiguas, usa setters DOM y eventos input/change; responde con estado y no lee valores. El broker rellena automáticamente en NavigationCompleted solo si la persona autorizó remember en ese mismo origen. En WebView2, computer.type también consulta el elemento activo y rechaza entrada cuando detecta un campo protegido; no uses computer.type para contraseñas en aplicaciones nativas.

browser_login nunca llama form.submit ni requestSubmit; browser_fill_form sigue rechazando password y file. Un click del modelo sobre botón submit dentro del login activo no llega al DOM; el host publica la tarjeta de confirmación y el submit solo ocurre por la acción física de la persona sobre esa tarjeta.

- [ ] **Paso 6: quitar captura con campos protegidos y añadir redacción**

Antes de cada screenshot del WebView2, PhoenixDesktopWindow consulta solo los rectángulos de campos username, password, current-password, new-password y one-time-code visibles en el documento superior y cubre esos rectángulos en la imagen en memoria antes de serializarla. La consulta no devuelve valores; el modelo y el canal general reciben únicamente la captura redactada. Se mantiene esta redacción para screenshots posteriores hasta que esos campos desaparezcan o cambie el origen. browser_login además devuelve origin, userFieldFilled, passwordFieldFilled y submitted:false. Si el host no puede verificar la redacción, devuelve un error fijo sin imagen y conserva el control para la persona.

- [ ] **Paso 7: actualizar el comando humano y probar la vieja ruta**

secret-vault ya no recibe valores web en rawInput; login-set solo dispara el prompt nativo con origin. Tests verifican que una cadena sintética no aparece en argumentos, session events, tool result, logs, telemetría, screenshot ni memoria.

- [ ] **Paso 8: ejecutar pruebas TypeScript y C#**

Ejecutar: pnpm exec vitest run packages/shell/tool-pwsh/tests/computer.spec.ts packages/credentials/secret-vault/tests/secret-vault.spec.ts; dotnet run --project apps/desktop-windows/Phoenix.Desktop.Tests/Phoenix.Desktop.Tests.csproj -c Release.

Esperado: el runtime jamás recibe valores del broker y browser_login nunca envía el formulario.

### Tarea 4: migrar explícitamente y probar WebView2 real

**Archivos:**

- Modificar: packages/credentials/secret-vault/src/index.ts y packages/credentials/secret-vault/tests/secret-vault.spec.ts.
- Modificar: apps/desktop-windows/DesktopCredentialBrokerProcess.cs.
- Modificar: apps/desktop-windows/PhoenixDesktopWindow.cs.
- Crear: apps/desktop-windows/Phoenix.Desktop.Tests/CredentialWebViewFixture.cs.
- Modificar: apps/desktop-windows/Phoenix.Desktop.Tests/Program.cs.
- Modificar: .github/workflows/phoenix-windows-desktop.yml.

**Interfaces:**

- La migración consulta solo metadatos de las refs web legacy; Phoenix no las resuelve ni auto-rellena.
- Después de guardar y verificar en el nuevo vault, Phoenix elimina las dos refs legacy del origen; si la verificación falla, conserva la entrada vieja sin usarla y muestra un resultado de migración fallida.
- El fixture prueba HTTPS localhost con certificado sintético confiado durante el test y restaurado al salir.

- [ ] **Paso 1: añadir los casos de migración y navegación**

Prueba los estados legacy-present, new-vault-written, legacy-removed y write-failed; comprueba redirect, cambio de puerto, HTTP remoto, iframe cross-origin, navegación entre autorización y fill, password field ambiguo, computer.type contra input password y OTP, screenshots del login y capturas posteriores con los marcadores de usuario y contraseña ausentes, y submit no ejecutado.

- [ ] **Paso 2: crear fixture WebView2 local sin cuentas reales**

El fixture sirve una página HTTPS en localhost con campos etiquetados, submit counter, formulario de destino cross-origin y variante SPA que monta el formulario tras NavigationCompleted; no llama un sitio externo ni usa datos de usuarios.

- [ ] **Paso 3: realizar la migración con reentrada humana**

Cuando existen refs web legacy, informa que Phoenix no las usará; pide que la persona reintroduzca la credencial en la tarjeta protegida; tras guardar y verificar Has(origin), elimina las refs account/secret antiguas mediante unset sin llamar resolve. No escribe un archivo intermedio ni una copia YAML nueva.

- [ ] **Paso 4: validar seguridad en runtime**

El test captura los mensajes del pipe, WebView, logs, sesión, transcript, aprendizaje y telemetría durante un login con marcadores sintéticos; valida que el DOM recibe los valores, las capturas ocultan los rectángulos y el submit counter permanece en cero hasta que la persona activa la tarjeta de confirmación.

- [ ] **Paso 5: ejecutar acceptance Windows**

Ejecutar: dotnet run --project apps/desktop-windows/Phoenix.Desktop.Tests/Phoenix.Desktop.Tests.csproj -c Release; pnpm exec vitest run packages/credentials/secret-vault/tests/secret-vault.spec.ts packages/shell/tool-pwsh/tests/computer.spec.ts.

Esperado: WebView2 rellena solo localhost HTTPS autorizado; todos los casos de redirect/origen/iframe/replay y el probe same-user son rechazados.

### Tarea 5: empaquetar el broker y documentar el límite de seguridad

**Archivos:**

- Modificar: .github/workflows/phoenix-windows-desktop.yml.
- Modificar: installer/windows/Phoenix.iss.
- Modificar: packages/credentials/secret-vault/README.md, README.zh.md y README.i18n.yaml.
- Modificar: docs/phoenix-windows.md, docs/phoenix-windows.zh.md y docs/phoenix-windows.i18n.yaml.
- Crear en la PR de implementación: .agents/notes/implemented/architecture/2026-09-22-windows-web-credential-isolation.md y su contraparte china y sidecar.

**Interfaces:**

- Consume: Phoenix.CredentialBroker.exe self-contained win-x64 y el perfil AppContainer por usuario.
- Produce: el instalador entrega broker, broker tests, prompt, permiso de autofill por origen y estado de migración; no requiere administrador ni añade credenciales web a credentials-local.

- [ ] **Paso 1: construir y empaquetar el broker**

El workflow publica Phoenix.CredentialBroker.exe junto al runtime desktop; el instalador lo copia y verifica su SHA dentro de dist antes de instalar.

- [ ] **Paso 2: comprobar arranque degradado seguro**

Si Windows no permite crear o iniciar el AppContainer, la ventana y Computer general arrancan; el broker no usa YAML como fallback y la UI indica que el vault web está deshabilitado.

- [ ] **Paso 3: actualizar documentación y Agent Note**

Explica que DPAPI cifra datos en reposo pero la separación de lectura depende del SID AppContainer y el pipe autenticado; documenta el permiso por origen, el no-submit, los casos humanos y la migración de las refs legacy. Si la prueba hermana puede reutilizar el SID y leer el store, no publiques el vault: entrega al usuario la evidencia y la decisión de servicio con instalación elevada o amenaza reducida.

- [ ] **Paso 4: validar gates del vault, host y docs**

Ejecutar: pnpm exec vitest run packages/credentials/secret-vault/tests/secret-vault.spec.ts packages/shell/tool-pwsh/tests/computer.spec.ts; dotnet run --project apps/desktop-windows/Phoenix.Desktop.Tests/Phoenix.Desktop.Tests.csproj -c Release; pnpm run doc-sync.

Esperado: el worker, las pruebas negativas de aislamiento, la tarjeta de chat, el WebView fixture y docs pasan en Windows CI.

### Criterio de cierre

Un proceso full-trust del mismo usuario no puede leer el archivo del broker ni solicitar valores; Node y el modelo solo ven origen y estado; la segunda visita a un origen autorizado rellena campos reconocidos, oculta sus valores y mantiene submit en false; una migración incompleta nunca usa las refs YAML.
