# Phoenix Windows: arranque, Computer rápido, credenciales y aprendizaje

Fecha: 2026-09-22

## Objetivo

Dejar Phoenix Desktop para Windows instalado y utilizable desde el primer inicio: el acceso directo y el inicio de sesión abren la aplicación nativa, el runtime administrado se recupera por sí solo y Computer permite trabajar con la aplicación y el navegador embebido con una respuesta comparable a Codex.

El usuario también autorizó que Computer aprenda automáticamente flujos reutilizables y preferencias. Esa memoria nunca contiene contraseñas, códigos de un solo uso, contenido privado de formularios ni tokens.

Para iniciar sesión en un sitio, Phoenix pide la cuenta y la contraseña mediante un campo protegido presentado en la interfaz de chat. Esa respuesta va directamente al servicio de credenciales, nunca al texto del chat ni al modelo. La persona puede guardarla para que Phoenix rellene el formulario al volver al mismo origen HTTPS. Rellenar no envía el formulario.

## Evidencia verificada

### Arranque instalado

El archivo local `Phoenix-Windows-Setup-1.0.20.exe` coincide con el asset `windows-v1.0.20` publicado: SHA-256 `68EF381EBA403C10AD8D012A73C644EA31ABAEEF89FBB8C1CDF041E5CBB85E12`. No tiene firma Authenticode; eso afecta la confianza de descarga, pero no explica el fallo de arranque observado.

En el arranque normal, [Program.cs](../../../apps/desktop-windows/Program.cs#L471) busca un checkout y lo selecciona con `includeConventional: true`, aunque [DesktopStartupContracts.cs](../../../apps/desktop-windows/DesktopStartupContracts.cs#L208) define que el modo fuente requiere `PHOENIX_SOURCE_ROOT` explícito. El registro local confirmó que el EXE eligió un checkout de desarrollo, ejecutó `pnpm phoenix -- --no-open` y terminó con `ERR_MODULE_NOT_FOUND` para `tsx`.

El escritorio puede registrar un backend como listo y persistir su raíz antes de comprobar que el proceso hijo que inició continúa vivo. La recuperación también puede intentar reemplazar archivos que siguen abiertos por otro proceso.

El [workflow de Windows](../../../.github/workflows/phoenix-windows-desktop.yml) compila el EXE y el instalador, pero no instala el instalador y ejecuta esa copia en un perfil limpio.

### Computer y navegador

Computer usa el proveedor Windows de [computer.ts](../../../packages/shell/tool-pwsh/src/computer.ts): las acciones generales crean un proceso PowerShell y compilan el driver C#; las acciones mutantes esperan un retardo fijo y luego capturan otra vez la pantalla completa. No existe una medición del tiempo por etapa ni una comparación equivalente contra Computer de Codex.

El navegador embebido ya implementa inspección, relleno y login con validación del origen. [DesktopBrowserControl.cs](../../../apps/desktop-windows/DesktopBrowserControl.cs) permite esas operaciones con `allowAutomation: true` en un named pipe `CurrentUserOnly`, que excluye a otros usuarios de Windows pero no a procesos del mismo usuario. El runtime Node resuelve la cuenta y el secreto y los envía por ese pipe; el host los inyecta en WebView2. Además, `browser_login` envía el formulario por defecto. La brecha es el aislamiento y la autorización del canal, no la ausencia de automatización.

### Credenciales y aprendizaje

[secret-vault](../../../packages/credentials/secret-vault/README.md) evita que el comando humano `/secret` llegue al modelo, y la API de autorización tiene respuestas de solo escritura. Pero el comando se escribe en el composer normal y [credentials-local](../../../packages/credentials/credentials-local/README.md) guarda valores en YAML que procesos bajo el mismo usuario pueden leer. El flujo actual también resuelve cuenta y secreto en el runtime Node y los serializa en el pipe del navegador. El ACL `CurrentUserOnly` no impide que otro proceso de esa misma cuenta solicite comandos. DPAPI o Credential Manager por sí solos no demuestran aislamiento frente a procesos de modelo o herramientas.

El navegador no debe recibir valores de contraseña en argumentos de Computer. Hoy, `computer.type` admite texto libre que puede quedar en `tool/call` y en el registro canónico de sesión. El redactor de la memoria de aprendizaje no es una garantía para contraseñas o códigos arbitrarios.

[session-learning](../../../packages/session/session-learning/README.md) ya conserva memoria cognitiva y redacted, pero observa eventos genéricos de herramientas. El resultado exitoso de una llamada del sistema operativo no demuestra por sí solo que el objetivo del usuario se completó.

### Trabajo abierto relacionado

Al 22-09-2026 existen PR abiertos que se solapan con el trabajo: #302/#304 para el runtime de escritorio, #308/#309 para navegador y Full Access, #112/#113 para Computer, y #548 para interacción ligera. Sus bases están divergentes o sus ramas muestran conflictos. Antes de implementar hay que volver a comprobar sus estados, continuar la ruta que siga vigente y evitar correcciones paralelas sobre los mismos archivos.

## Diseño

### 1. Arranque de Windows

El modo fuente solo se activa con `PHOENIX_SOURCE_ROOT`; una preferencia de consola muestra u oculta diagnósticos, pero nunca elige el runtime. El arranque instalado usa únicamente el supervisor, Node y la semilla administrados por Phoenix, sin PowerShell, pnpm, tsx ni un checkout del usuario.

El instalador por usuario configura el acceso directo y el inicio de sesión para abrir el EXE instalado. Tras instalar, Phoenix queda abierto. Un inicio válido requiere un supervisor propio vivo o un runtime Phoenix compatible validado por PID, línea de comando e identidad del endpoint. Un listener ajeno o incompatible nunca se adopta ni se termina; al cerrar el shell, un runtime compatible que ya existía sigue vivo.

La reparación prepara y valida una copia nueva, detiene solo el árbol de procesos que Phoenix posee y conserva la última copia sana si falla. La ventana muestra progreso o un error recuperable mientras mantiene la interfaz nativa; WebView2 ausente no deja una ventana en blanco.

### 2. Computer rápido y comprobable

Primero se instrumentan, en Windows, el inicio frío y cálido y el tiempo de cada acción: aprobación, arranque del driver, lectura del descriptor, ida y vuelta por pipe, despacho al hilo de UI, disponibilidad de WebView2 y captura/adjunto. Se comparan las mismas acciones y condiciones con Codex Computer en el mismo equipo. La meta de latencia se fija a partir de esa línea base; no se declara paridad sin mediciones.

El camino caliente evita compilar C# y crear PowerShell para cada acción. Usa un driver de larga vida y reutiliza el canal nativo mientras su descriptor y dueño sigan válidos. Las esperas fijas se sustituyen por señales de que terminó la acción, con un límite de tiempo y un error visible.

Las capturas después de una acción siguen siendo frescas. Para el navegador se captura el panel o la ventana cuando sea suficiente; una acción de credenciales devuelve evidencia redacted que cubre los campos protegidos. La captura completa sigue disponible para otras aplicaciones.

La ruta de automatización WebView2 requiere una capacidad de corta duración, ligada a la instancia de Phoenix, al origen superior HTTPS exacto y a una sola operación autorizada. El host rechaza solicitudes sin esa capacidad; `CurrentUserOnly` no cuenta como autenticación suficiente. Conserva la aprobación existente y comprueba el origen en vivo inmediatamente antes de actuar.

### 3. Entrada y almacenamiento de credenciales web

Cuando falta una credencial durante un inicio de sesión, Phoenix presenta dentro de la conversación un formulario protegido fuera del composer. La cuenta y la contraseña se envían por una operación de autorización de solo escritura al host de escritorio; no forman parte del mensaje, argumentos de herramientas, sesión canónica, transcript, telemetría, logs, procesos hijos ni memoria. La UI confirma únicamente el sitio y que el secreto se guardó.

El runtime Node, las herramientas y el pipe de automatización general no reciben valores de cuenta o contraseña. Un broker dentro del host nativo lee el almacén de Windows y entrega los valores directamente al formulario de WebView2 después de verificar el origen HTTPS exacto —esquema, host y puerto efectivo—. El request del runtime lleva solo un identificador opaco y la capacidad de un solo uso. No se aceptan selectores arbitrarios del modelo y el acceso no deriva de `danger-full-access`.

Al guardar por primera vez, la persona autoriza explícitamente recordar y rellenar esa credencial en ese origen. En visitas posteriores, Phoenix puede rellenar automáticamente un formulario de inicio de sesión reconocido en el mismo origen. No pulsa “Entrar” ni envía el formulario. Una redirección, origen distinto, campo no reconocido o permiso ausente detiene la operación y devuelve el control a la persona.

Las capturas y resultados posteriores ocultan cuenta y contraseña. Phoenix no persiste credenciales web nuevas en `.credentials.yaml`. El broker y su IPC deben impedir que procesos de modelo/herramientas lean el almacén o suplanten una operación autorizada; el named pipe con ACL de usuario no basta. DPAPI o Credential Manager solo se aceptan si esa prueba de aislamiento también pasa. Los valores web anteriores en YAML requieren una migración explícita, verificable y sin crear copias nuevas en claro; si no puede completarse, Phoenix informa el estado y no los usa para autofill.

Computer no escribe contraseñas, cookies, tokens ni códigos en campos protegidos mediante `computer.type`. MFA, passkeys, CAPTCHA y consentimiento permanecen bajo control de la persona; Phoenix pausa la automatización y no incluye sus campos en capturas ni en memoria. El envío final del formulario necesita una acción humana.

### 4. Aprendizaje seguro de flujos y preferencias

Phoenix registra automáticamente preferencias y pasos reutilizables de tareas completadas. Cada recuerdo conserva su procedencia y evidencia; un `tool/result: ok` no cuenta como confirmación del objetivo. Si el resultado visible es ambiguo o fallido, la secuencia no se promueve como procedimiento exitoso.

Un recuerdo puede contener una secuencia de acciones abstractas y un origen web normalizado cuando sea necesario para reutilizarla. No guarda valores de formularios, texto privado de página, contraseñas, códigos, cookies, tokens, URL con ruta/query/fragmento ni capturas de credenciales. Los procedimientos recuperados son evidencia no confiable: no amplían permisos ni omiten confirmaciones. La persona puede revisar y olvidar los recuerdos de Computer.

## Aceptación

1. En un perfil Windows limpio, el instalador configura acceso directo e inicio de sesión y abre la copia instalada; después de cerrar o minimizar a la bandeja, ambos caminos vuelven a abrir Phoenix.
2. Un checkout convencional sin `tsx` no altera el runtime instalado. El estado “listo” requiere identidad y un proceso Phoenix compatible vivo; un listener ajeno o incompatible no cambia de dueño ni se detiene.
3. El workflow instala y ejecuta el instalador generado en un perfil temporal de Windows, comprueba la ventana, la navegación local de WebView2, reabrir desde bandeja y los diagnósticos de fallo.
4. Una medición Windows reproduce las mismas acciones de Computer antes y después, en frío y en caliente, y compara el mismo equipo con Codex. Publica percentiles y desglose por etapa; ninguna espera fija o compilación por acción permanece en la ruta caliente.
5. Un sitio HTTPS de prueba comprueba que una credencial nueva se pide fuera del composer, queda fuera de todos los datos visibles al modelo y se almacena mediante el broker. El runtime Node y el protocolo general nunca reciben sus valores. En la segunda visita, solo el origen autorizado recibe autofill; una redirección u otro puerto/origen se rechaza y la página no se envía automáticamente.
6. Pruebas de seguridad comprueban que un proceso del mismo usuario no puede leer el almacén ni emitir comandos sin capacidad, que cuenta y contraseña nunca aparecen en el pipe general, que el autofill solo las entrega al origen autorizado, y que resultados/capturas, migración, sesión, memoria y telemetría no filtran valores.
7. Una tarea de prueba completada puede enseñar una secuencia reutilizable; una tarea fallida no. Los pasos y preferencias se recuerdan, y contraseñas, códigos, contenido privado de formularios, tokens y capturas no aparecen en el ledger. La persona puede revisar y borrar el recuerdo.
8. PRs y verificaciones demuestran que el mismo comportamiento quedó integrado en `main` y `stable`, preservando sus historiales. Se comprueban los SHAs remotos exactos; un commit local o un instalador compilado no cuentan como publicación.

## Entrega en main y stable

Se trabaja primero sobre la cabeza vigente de `main`, continuando o actualizando los PR que sigan siendo la vía correcta. El arreglo de Windows, la ruta rápida de Computer, el broker de credenciales y el aprendizaje pueden revisarse en PRs separados si sus límites y dependencias lo permiten; no se agrupan cambios sin relación en un único parche.

Después de integrar y verificar cada cambio en `main`, se prepara su backport correspondiente a `stable` sin fusionar los historiales divergentes de ambas ramas. El candidato de instalación se genera desde el código integrado y se prueba en Windows antes de afirmar que el EXE está listo. La publicación de una nueva release Windows se decide con los PR existentes de instalación y firma, reflejando el estado real de Authenticode.

## Fuera de alcance

Phoenix no automatiza CAPTCHA, passkeys, MFA/OTP, consentimientos, pagos ni el envío de formularios. No se replican internamente las funciones de Codex; se iguala la rapidez de Computer en acciones comparables y se demuestra con mediciones.

Esta especificación cubre credenciales de inicio de sesión web. No cambia el formato ni la política de credenciales de proveedores LLM que usan otros consumidores.
