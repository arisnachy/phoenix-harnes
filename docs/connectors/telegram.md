# Telegram — recepción y comunicación de Kira

## Configuración

1. En Telegram, crea el bot con [@BotFather](https://t.me/BotFather) usando `/newbot`.
2. En Phoenix, abre **Configuración → Conectores → Telegram · Kira**.
3. Guarda y verifica el token. Phoenix utiliza el almacén seguro de credenciales.
4. Pulsa **Generar código de vinculación (15 min)**. El código permanece en el vault durante esos 15 minutos, aunque se reinicie Phoenix. En el chat **privado** con tu bot escribe `/start 123456` reemplazando el número por el que aparece en Phoenix.
5. Cuando el bot confirme la vinculación, envíale una orden por texto. Phoenix crea o recupera una sesión mediante el gateway habitual del chat, incluyendo modelo, preset y herramientas, confirma la recepción y responde con el texto visible al terminar.
6. Pulsa **Actualizar estado** para ver si la cuenta está vinculada y el receptor está operativo.

## Qué hace y qué no hace

- El receptor usa `getUpdates` vía HTTPS y un único Host de Phoenix activo. No necesita registrar un webhook público.
- Si Phoenix está cerrado, no puede ejecutar tareas ni responder. Al volver, solicita los mensajes recientes que Telegram todavía conserve.
- Solo el ID de un usuario vinculado mediante un código temporal puede ejecutar órdenes; ignora chats grupales, bots y remitentes no autorizados.
- El offset se conserva en credenciales locales y las entradas se procesan en orden. Se evita reconocer un update antes de procesarlo.
- Los trabajos se envían mediante el gateway apiProxy.sessions.prompt, sin crear un agente desconfigurado. Los resultados vienen del agente y los fallos de ejecución se notifican sin confundirlos con éxito.
- El modo de voz nunca se activa por un mensaje de Telegram. Las llamadas programadas y la recepción de notas de voz **no están implementadas** en este canal.
- Al cambiar de token se borra la vinculación local anterior. «Desconectar» borra las credenciales locales; para revocarlas también en Telegram usa BotFather.

## Diagnóstico

- **Bot verificado, receptor no confirmado**: abre Phoenix y comprueba conectividad con `api.telegram.org`.
- **Falta vincular usuario**: genera un código nuevo, envía `/start CODIGO`, pulsa actualizar. En bots recién creados también debes iniciar el chat privado.
- **telegram-webhook-active**: otro servicio registró un webhook; `getUpdates` no funciona hasta desactivarlo en ese servicio.
- **telegram-polling-conflict**: otro proceso lee `getUpdates` con el mismo bot. Cierra ese proceso.
- **Kira no pudo abrir la sesión (`telegram-session-*`)**: después de actualizar desde una versión antigua, el identificador guardado podía apuntar a una sesión sin directorio de trabajo ni preset. La recuperación ahora distingue sesiones creadas por el gateway, migra automáticamente las heredadas incluso tras reinicios y crea una nueva si el proyecto original cambió. No elimines ni desvincules el bot; las sesiones previas conservan su historial. El texto de error incluye un código seguro que puedes usar para el diagnóstico.
- **Recibo confirmación, pero no respuesta final**: versiones antiguas creaban agentes Telegram sin modelo ni preset; el receptor corregido crea sesiones configuradas desde el gateway y reemplaza las sesiones activas antiguas sin borrar su historial. Actualiza y reinicia Phoenix; no hace falta revincular el bot. Si persiste, comprueba el proveedor de modelo y los registros del Host.
- **No llega el mensaje**: comprueba que no haya otras instalaciones que estén consumiendo `getUpdates` con el mismo token. Solo una puede ser receptora.

No pegues tokens en chats, logs o repositorios.
