# Telegram — recepción y comunicación de Kira

## Configuración

1. En Telegram, crea el bot con [@BotFather](https://t.me/BotFather) usando `/newbot`.
2. En Phoenix, abre **Configuración → Conectores → Telegram · Kira**.
3. Guarda y verifica el token. Phoenix utiliza el almacén seguro de credenciales.
4. Pulsa **Generar código de vinculación (15 min)**. El código permanece en el vault durante esos 15 minutos, aunque se reinicie Phoenix. En el chat **privado** con tu bot escribe `/start 123456` reemplazando el número por el que aparece en Phoenix.
5. Cuando el bot confirme la vinculación, envíale una orden por texto. Phoenix la incorpora a una sesión real del harness, confirma la recepción y responde con el texto del resultado al terminar.
6. Pulsa **Actualizar estado** para ver si la cuenta está vinculada y el receptor está operativo.

## Qué hace y qué no hace

- El receptor usa `getUpdates` vía HTTPS y un único Host de Phoenix activo. No necesita registrar un webhook público.
- Si Phoenix está cerrado, no puede ejecutar tareas ni responder. Al volver, solicita los mensajes recientes que Telegram todavía conserve.
- Solo el ID de un usuario vinculado mediante un código temporal puede ejecutar órdenes; ignora chats grupales, bots y remitentes no autorizados.
- El offset se conserva en credenciales locales y las entradas se procesan en orden. Se evita reconocer un update antes de procesarlo.
- Los trabajos se envían mediante `agent.followup` y los resultados proceden de mensajes del agente, no de respuestas prefabricadas.
- El modo de voz nunca se activa por un mensaje de Telegram. Las llamadas programadas y la recepción de notas de voz **no están implementadas** en este canal.
- Al cambiar de token se borra la vinculación local anterior. «Desconectar» borra las credenciales locales; para revocarlas también en Telegram usa BotFather.

## Diagnóstico

- **Bot verificado, receptor no confirmado**: abre Phoenix y comprueba conectividad con `api.telegram.org`.
- **Falta vincular usuario**: genera un código nuevo, envía `/start CODIGO`, pulsa actualizar. En bots recién creados también debes iniciar el chat privado.
- **telegram-webhook-active**: otro servicio registró un webhook; `getUpdates` no funciona hasta desactivarlo en ese servicio.
- **telegram-polling-conflict**: otro proceso lee `getUpdates` con el mismo bot. Cierra ese proceso.
- **Recibo confirmación, pero no respuesta final**: Phoenix necesita que el agente y su proveedor de modelo estén operativos. Verifica el chat de Phoenix y sus registros.
- **No llega el mensaje**: comprueba que no haya otras instalaciones que estén consumiendo `getUpdates` con el mismo token. Solo una puede ser receptora.

No pegues tokens en chats, logs o repositorios.
