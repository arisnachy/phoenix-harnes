# Integración Microsoft Graph mediante OAuth y MCP

## Estado y alcance

- Estado: diseño aprobado por el usuario.
- Fecha: 2026-08-28.
- Servicios de la primera versión: Outlook Mail y Outlook Calendar.
- Acciones: lectura, borradores, envío de correo y creación, edición y cancelación de eventos.
- Teams, SharePoint, adjuntos complejos, cuentas multiusuario y almacenamiento persistente de tokens quedan fuera de esta versión.

## Objetivos

1. Añadir un flujo Microsoft OAuth reutilizando `ctx.authorization`.
2. Exponer operaciones de Mail y Calendar como herramientas MCP bajo un namespace estable.
3. Mantener access tokens, refresh tokens, códigos, verificadores y secretos fuera de archivos, logs, telemetría y resultados de herramientas.
4. Exigir aprobación humana antes de enviar mensajes o modificar eventos.
5. Documentar el registro en Microsoft Entra/Azure y la conexión de la cuenta.

## Arquitectura

### Broker OAuth y Graph

Crear `MicrosoftGraphBroker` en `packages/credentials/authorization` siguiendo `GoogleApiBroker`:

- Flujo Authorization Code con PKCE S256 y `state`/`nonce`.
- Tenant configurable, con `common` como valor inicial para cuentas personales y laborales.
- Endpoint de autorización y token bajo `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/`.
- Redirect loopback en `127.0.0.1` con puerto efímero.
- `MICROSOFT_CLIENT_ID` como única configuración obligatoria; no se usará `client_secret`.
- El almacén de credenciales recibe solo un marcador sin secretos.
- Los tokens viven únicamente en memoria del proceso y se refrescan allí mismo.
- Al reiniciar PHOENIX se requiere reautorización, igual que el broker Google actual.

El broker expondrá una API fija contra `https://graph.microsoft.com/v1.0/`. No aceptará URLs, hosts ni cabeceras de autenticación controlados por el modelo.

### Servidor MCP local

Crear un servidor MCP local por `stdio`, `microsoft-graph-mcp`, que:

- Exponga las herramientas de Mail y Calendar.
- No almacene ni reciba tokens.
- Solicite cada operación al broker por un canal IPC loopback autenticado con un nonce efímero.
- Respete cancelación y límites de tiempo.
- Devuelva resultados JSON sin material secreto.

El host montará el servidor con el cliente MCP existente y publicará nombres como `mcp__microsoft__search_messages`.

### Confirmaciones

Las herramientas de escritura se identificarán en el host mediante una política `tools/pre-execute` asociada al namespace Microsoft. Antes de ejecutar se solicitará aprobación mediante `ctx.approval`:

- `send_message`
- `create_event`
- `update_event`
- `cancel_event`

La ausencia, cancelación o rechazo de la aprobación detiene la llamada antes del IPC y de Microsoft Graph. Las lecturas y `create_draft` no requieren aprobación adicional.

## Herramientas MCP

### Outlook Mail

- `search_messages`: búsqueda acotada por consulta y paginación segura.
- `get_message`: lectura de un mensaje por ID.
- `create_draft`: creación de borrador en Outlook.
- `send_message`: envío de mensaje tras aprobación.

### Outlook Calendar

- `list_events`: consulta de eventos por intervalo y calendario.
- `get_event`: lectura de evento por ID.
- `create_event`: creación tras aprobación.
- `update_event`: modificación tras aprobación.
- `cancel_event`: cancelación tras aprobación.

Los esquemas limitarán tamaños, paginación, destinatarios, intervalos y cuerpos para evitar sobrecaptura accidental.

## Permisos Microsoft Graph

Permisos delegados mínimos para el alcance aprobado:

- `openid`
- `profile`
- `email`
- `offline_access`
- `User.Read`
- `Mail.ReadWrite`
- `Mail.Send`
- `Calendars.ReadWrite`

El broker validará los scopes concedidos antes de habilitar cada capacidad y fallará cerrado si falta alguno.

## Seguridad y errores

- Validar `state`, `nonce`, PKCE, issuer y respuesta OAuth antes de aceptar el código.
- Redactar tokens, códigos, verificadores y respuestas de autorización en logs y errores.
- Rechazar rutas absolutas, hosts externos y cabeceras `Authorization` suministradas por el modelo.
- Usar HTTPS para Microsoft Graph; solo el callback y el IPC loopback podrán usar HTTP local.
- Devolver errores estables: reautorización requerida, scope denegado, estado OAuth inválido, destino bloqueado, aprobación rechazada y Microsoft Graph no disponible.
- Desconectar elimina el marcador local aunque la revocación remota falle.
- El proceso MCP recibe un entorno limpiado y solo un nonce/endpoint efímero.

## Pruebas

### Broker

- Normalización y validación de configuración.
- Construcción PKCE y URL de autorización.
- Estado inválido y callback malformado.
- Marcador sin secretos.
- Scope insuficiente.
- Inyección de Bearer solo en el límite fijo de Graph.
- Refresh en memoria sin persistir tokens rotados.
- Reautorización después de reinicio.
- Desconexión y fallo remoto de revocación.
- Bloqueo de URL y cabeceras controladas por el modelo.

### MCP e integración

- Descubrimiento bajo `mcp__microsoft__...`.
- IPC con nonce inválido o expirado.
- Cancelación, timeout y reconexión.
- Las cuatro herramientas de escritura pasan por aprobación.
- Rechazo/cancelación/ausencia de aprobación no contacta Graph.
- Resultados y telemetría no contienen material secreto.
- Prueba focal de búsqueda de correo, listado de eventos y una operación de escritura aprobada.

## Configuración y conexión

La documentación de operación explicará:

1. Crear un registro de aplicación en Microsoft Entra.
2. Seleccionar cuentas personales y organizativas según el uso.
3. Habilitar el flujo de cliente público/desktop.
4. Configurar el redirect loopback.
5. Conceder los permisos delegados anteriores y aceptar consentimiento.
6. Definir `MICROSOFT_CLIENT_ID` sin incluirlo en el repositorio si la política local lo considera confidencial.
7. Reiniciar PHOENIX y comenzar la autorización desde la superficie de cuentas/conversación.
8. Comprobar el estado sin mostrar tokens.
9. Desconectar y revocar desde PHOENIX.

## Criterios de aceptación

- La integración aparece como flujo autorizable de Microsoft en PHOENIX.
- Después de OAuth, las herramientas Mail/Calendar se descubren bajo el namespace Microsoft.
- Las lecturas funcionan con permisos concedidos.
- Envío y cambios de calendario siempre requieren aprobación y no se ejecutan sin ella.
- Ningún secreto aparece en credenciales persistentes, logs, telemetría, argumentos MCP ni resultados.
- Las pruebas focales del broker y MCP pasan.
- La guía de Azure y conexión es reproducible sin compartir contraseñas ni secretos con PHOENIX.

## No objetivos

- No añadir Teams ni SharePoint en esta iteración.
- No crear una aplicación Azure automáticamente.
- No aceptar client secrets en el código.
- No guardar tokens en `settings.yaml` ni en archivos del repositorio.
- No implementar sincronización en segundo plano ni multiusuario.
