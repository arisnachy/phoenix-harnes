# Telegram para Kira — Configuración en Phoenix

**Estado de esta versión:** la pantalla Configuración → Conectores → «Telegram · Kira» permite validar con la Bot API oficial y guardar de forma segura un token de bot; **no** habilita todavía recepción automática de mensajes, ejecución del harness, audio, llamadas ni notificaciones proactivas. El estado «Bot verificado» no significa «Kira disponible en Telegram».

## 1. Crear tu bot

1. Abre [@BotFather](https://t.me/BotFather) en Telegram. Verifica que sea la cuenta oficial.
2. Envía `/newbot` y responde con un nombre (por ejemplo, «Kira Phoenix»).
3. Elige un nombre de usuario disponible que termine en `bot`.
4. BotFather te entrega un **token secreto**. No lo envíes a un chat, a GitHub ni a ninguna web que no sea tu instalación local de Phoenix.
5. En Phoenix abre **Configuración → Conectores**, busca **Telegram** y pulsa **Configurar Telegram**.
6. Pega el token en el campo de contraseña y pulsa **Guardar y verificar**. Phoenix llama únicamente a `https://api.telegram.org/bot<TOKEN>/getMe` por HTTPS y guarda el token en el proveedor de credenciales local.
7. Debes ver **Bot verificado · receptor pendiente** y el nombre de usuario. Abre el bot y pulsa **Iniciar**.

## 2. Qué falta antes de chatear con Kira

El receptor de mensajes de Telegram es una fase **pendiente**. Debe implementar: `getUpdates` con persistencia de offset y exclusión de webhooks, o un webhook HTTPS; vinculación con desafío de un solo uso y allowlist de usuario/chat ID; deduplicación y autorización por evento; publicación en la sesión de Phoenix como turno del usuario; respuesta usando `sendMessage`; audio como mensajes finitos; invitaciones a sesiones WebRTC Codex mediante interacción explícita; programación/proactividad con límites, consentimiento y horario silencioso.

**No** debe iniciarse una conversación de voz en segundo plano por recibir texto o nota de voz. Debe respetar el contrato de [ciclo de vida de voz](../telegram-voice-lifecycle.md), que limpia el micrófono al colgar.

## 3. Seguridad y solución de problemas

- La ruta es **Bot API de Telegram**, no «MCP oficial de Telegram» ni OAuth.
- En caso de token inválido no se reemplaza la credencial anterior; revisa que copiaste el token completo.
- «Telegram no respondió» puede significar bloqueo de red o falta de servicio: no se confunde con «verificado».
- **Desconectar** borra la copia local del token. Para invalidarlo también en Telegram, usa `/revoke` con BotFather y genera uno nuevo.
- Los bots no pueden iniciar espontáneamente un chat con un usuario que nunca pulsó **Iniciar**.
- La autenticación Codex no es necesaria para verificar un bot y no se envía ningún token Codex a Telegram.
- La recepción/proactividad y llamadas no se deben presentar como listas hasta tener pruebas reales de envío y respuesta en un dispositivo.
