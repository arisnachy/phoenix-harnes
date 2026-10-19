# Microsoft MCP en Phoenix (octubre de 2026)

Phoenix ofrece integraciones Microsoft separadas: Microsoft Learn, Graph gratuito por servicio (implementación local Phoenix), Work IQ y Azure. Los servidores **oficiales** de Microsoft Learn, Work IQ y Azure siguen instalables
desde Configuración → Conectores. **Microsoft Learn Docs** se prepara automáticamente como MCP público y gratuito en el paquete básico de Phoenix; **Work IQ y Azure** son opcionales y no se instalan ni usan sin una acción del usuario y sus requisitos. El equipo Windows necesita actualizar el Host para recibir estos cambios.

## 1. Microsoft Learn Docs MCP — público y gratuito

- Documentación oficial: https://learn.microsoft.com/en-us/training/support/mcp-developer-reference
- Servidor: `https://learn.microsoft.com/api/mcp` (Streamable HTTP, sin OAuth).
- En Phoenix: **Microsoft Learn (Docs)** se instala automáticamente en el núcleo gratuito si el Host está actualizado. Si el servicio no está disponible, consultar su estado y reparar/reconectar; nunca afirmar que está listo sin herramientas.
- Uso por Kira: investigar Microsoft 365, Windows, Azure, Graph y documentación
  de desarrollo; comprobar los resultados contra documentación oficial.
- **No** concede acceso a Outlook, archivos, calendario ni mensajes privados.
- Coste del servicio MCP público: gratuito.

## 2. Microsoft 365 Work IQ MCP — suite unificada, con facturación

- Documentación: https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/cli
- Paquete oficial: `@microsoft/workiq`.
- Comando MCP verificado por Microsoft: `npx -y @microsoft/workiq mcp`.
- En Phoenix: **Microsoft 365 Work IQ** → aceptar advertencia de costes → **Instalar**.
- Uso posible según la licencia/tenant: preguntas sobre correo Outlook, reuniones
  y calendario, documentos OneDrive/SharePoint, Teams y personas. No garantiza
  operación de escritura ni que todos los datos sean accesibles.
- Requisitos **obligatorios**: Node.js; plan de facturación por uso asociado
  con una suscripción Azure y grupo de recursos en Copilot Studio; usuario
  asignado a la facturación; **consentimiento administrativo de Entra** para
  los permisos de Work IQ. Consulte los requisitos de Microsoft antes de activar.
- La EULA **no se acepta automáticamente** por Phoenix. El usuario debe leerla
  y aceptarla ejecutando `npx -y @microsoft/workiq accept-eula` desde una
  terminal de confianza antes del primer uso.
- **No es gratis**: las solicitudes de Work IQ consumen facturación por uso
  incluso si el usuario tiene licencia Microsoft 365 Copilot (fuera de las
  experiencias cubiertas por la licencia). No lanzar búsquedas ni operaciones
  recurrentes sin autorización del usuario y un presupuesto verificado.
- Phoenix nunca debe interpretar la disponibilidad del paquete como una
  sesión Microsoft autenticada: validar el runtime y sus herramientas.

## 3. Azure MCP — local, consolidado, operaciones con posible coste

- Documentación: https://learn.microsoft.com/en-us/azure/developer/azure-mcp-server/concepts
- Paquete oficial: `@azure/mcp@latest`.
- Comando: `npx -y @azure/mcp@latest server start --mode consolidated`.
- En Phoenix: **Microsoft Azure MCP** → aceptar advertencia de costes → **Instalar**.
- Autenticación local mediante Azure CLI `az login`, configurado en la
  sesión del usuario. El propio paquete MCP no añade un cargo de licencia;
  **Azure Storage, Compute, bases de datos y otros recursos sí pueden facturar**.
- Se utiliza el modo **consolidated** en lugar de exponer >200 herramientas,
  para reducir tokens y complejidad.
- No crear/eliminar recursos ni iniciar servicios de pago sin una aprobación
  explícita y una comprobación de costes.

## 4. ¿Por qué no instalar por separado Outlook, Teams, OneDrive y SharePoint?

En la relación oficial https://github.com/microsoft/mcp Microsoft publica
servidores empresariales de correo, calendario, Teams, SharePoint y OneDrive
alojados en Agent 365: son endpoints con `{tenant_id}` y requieren una
suscripción/identidad/registro de aplicación Microsoft Entra y permisos del
tenant. **No existe un endpoint universal gratuito y anónimo** que Phoenix
pueda instalar por cada aplicación.

Por ello, las tarjetas independientes de Outlook, Teams, OneDrive y
SharePoint en el catálogo **no se declaran conectadas por instalar Work IQ**;
Kira debe comprobar que el servidor correspondiente está realmente conectado
y que dispone de herramientas para el caso de uso. La integración Graph
administrativa y el acceso de escritura de estas aplicaciones requieren pasos
separados y no se simulan en Phoenix.

Para gestionar SharePoint Embedded Microsoft también ofrece
https://github.com/microsoft/SharePoint-Embedded-MCP-Server,
que exige un registro de aplicación, identificador de tenant y recursos
de SharePoint Embedded; no reemplaza SharePoint convencional.

## 5. Comprobación de instalación

1. Verificar que el Host actualizado expone los tres conectores.
2. Seleccionar **Microsoft Learn (Docs) → Instalar** y comprobar
   `microsoft-learn` en estado `ready` con herramientas reales.
3. Para Work IQ, revisar costes y consentimiento del tenant primero,
   aceptar EULA explícitamente, instalar y autenticar en el proceso local.
4. Para Azure, realizar `az login` si hace falta, instalarlo y consultar
   el inventario de herramientas antes de iniciar operaciones.
5. Nunca afirmar que una integración está conectada basándose solo en
   `managed.patch.yml`, ni mostrar tokens en el chat.

## 6. Privacidad y costes

Todas las identidades y los permisos se gestionan por el proveedor.
**Microsoft Learn** lee documentación pública, se aprovisiona en el paquete base y no requiere credenciales. **Work IQ y Azure** requieren credenciales y pueden incurrir en facturación aunque el servidor MCP sea software de libre distribución. Cada uno tiene estado separado; **Work IQ y Azure no están en el paquete de arranque automático** (CORE_MCP_PACK_IDS).


## 7. Microsoft Personal (Outlook, Calendario, Contactos y OneDrive) — gratis

Phoenix incorpora el servidor local **microsoft-personal**, distinto de
Microsoft Learn, Microsoft 365 Work IQ y Azure. Usa directamente Microsoft Graph,
con OAuth delegado **device-code** y sin Microsoft 365 de pago, Copilot,
Work IQ ni un servidor de terceros que reciba el correo.

**Requisito inicial inevitable:** registrar una aplicación pública propia en
[Microsoft Entra](https://entra.microsoft.com/) (Application / client ID UUID).
Microsoft exige un client ID para OAuth: no existe un inicio de sesión anónimo.
En *App registrations → New registration* elige una aplicación que permita
cuentas personales Microsoft; en *Authentication* activa **Allow public client
flows**. Añade los permisos delegados de Graph: User.Read, Mail.Read,
Calendars.Read, Contacts.Read, Files.Read. Si deseas funciones de escritura,
añade también Mail.ReadWrite, Mail.Send y Calendars.ReadWrite.
Consulta la [guía oficial](https://learn.microsoft.com/en-us/graph/auth-register-app-v2).
Las cuentas corporativas sujetas a administración o Microsoft 365 no son
el destino de este servidor: usa el flujo de cuentas personales /consumers.

### Activación en Phoenix

1. Actualiza Phoenix y abre Configuración → Conectores → paquete MCP básico
   (o instala el conector curado `microsoft-personal`).
2. Pide a Kira usar `microsoft_setup` con tu **Application (client) ID**
   público. Alternativa: define `PHOENIX_MICROSOFT_CLIENT_ID` en el entorno
   del Host y reinicia; nunca pegues credenciales privadas en el chat.
3. Kira llama `microsoft_login_start` con `mode: "read"`. Abre la URL
   Microsoft oficial que devuelva y escribe allí el código de dispositivo.
4. Kira llama `microsoft_login_complete` respetando
   `retryAfterSeconds` hasta confirmar `authorized`, y después verifica
   `microsoft_profile`. No declares lista la cuenta antes de comprobarlo.
5. Si necesitas acciones de escritura, repite la autorización con
   `mode: "write"` para obtener consentimiento explícito adicional.

**Herramientas:** consulta de correo/bandejas y mensajes, perfil, calendario,
contactos y navegación de carpetas OneDrive; con permisos de escritura:
borradores de correo, envío de correo y creación de eventos. El envío real
necesita aprobación explícita del usuario **antes** de que Kira llame a
`microsoft_mail_send`; el parámetro `confirm` no sustituye la aprobación.
La API de OneDrive es de lectura en esta versión: listar archivos Office no
equivale a poder editarlos. Teams empresarial, SharePoint empresarial y
Microsoft 365 de pago no se habilitan con una cuenta personal gratuita.

**Persistencia y privacidad:** los tokens no se devuelven al agente ni se
incluyen en el inventario MCP. En Windows, el refresh token se cifra con
**DPAPI CurrentUser** bajo `~/.dsh/microsoft-personal/refresh.dpapi`. En
macOS/Linux el servidor conserva tokens solo mientras el proceso esté activo,
sin volcar secretos en disco. `microsoft_disconnect` borra el token local;
para revocar el permiso de la aplicación también debes hacerlo en Microsoft.
No hay facturación de Graph por estas operaciones básicas en condiciones
normales, aunque se aplican cuotas, límites y políticas de Microsoft.

**Ejecución:** el MCP local se inicia con Node desde
`scripts/phoenix-microsoft-personal-mcp.mjs` en el directorio de trabajo del
Host (la raíz de la versión activa de Phoenix). Comprueba `node --version`
y que el script exista en ese runtime. Nunca confundas instalado con
autenticado: valida primero las herramientas y luego la cuenta.


## 8. Outlook y Microsoft Graph por servicio: seis conexiones independientes

En **Configuración → Conectores**, las siguientes tarjetas son instalables sin Work IQ:

| Tarjeta | MCP interno | Permisos delegados solicitados por el servicio |
| --- | --- | --- |
| Outlook · correo | `outlook-mail` | `User.Read`, `Mail.Read`; para borradores/envío `Mail.ReadWrite`, `Mail.Send` |
| Outlook · calendario | `outlook-calendar` | `User.Read`, `Calendars.Read`; para crear eventos `Calendars.ReadWrite` |
| Microsoft · contactos | `microsoft-contacts` | `User.Read`, `Contacts.Read` |
| OneDrive · archivos | `onedrive` | `User.Read`, `Files.Read` |
| Microsoft Teams · canales | `microsoft-teams` | `User.Read`, `Team.ReadBasic.All`, `Channel.ReadBasic.All`, `ChannelMessage.Read.All` |
| SharePoint · sitios | `sharepoint` | `User.Read`, `Sites.Read.All` |

Todas solicitan `offline_access` para renovar la sesión. **Seis tarjetas ≠ seis autorizaciones automáticas.** Cada servicio utiliza un proceso MCP, una lista de herramientas filtrada por servicio, consentimiento delegado independiente y su propio token de actualización Windows cifrado por DPAPI (`~/.dsh/microsoft-personal/refresh-<service>.dpapi`). Comparten *solamente* un Application (client) ID público en `client.json`, sin compartir tokens.

**Autorización real, sin ventanas OAuth falsas:**

1. Registra una aplicación de cliente público en [Microsoft Entra](https://entra.microsoft.com/): selecciona los tipos de cuenta que usarás (personal, organizacional, o ambas), habilita el flujo de dispositivo/cliente público, agrega los permisos delegados del servicio.
2. En Phoenix instala **la tarjeta concreta**, o pídele a Kira: «Conecta Outlook correo», «Conecta Outlook calendario», «Conecta OneDrive», etc. `connector_install` tiene rutas específicas para esos MCP.
3. Kira solicita el **Application (client) ID** si aún falta (es un identificador público, no contraseña ni secret), llama `microsoft_setup` una vez y luego `microsoft_login_start` en el **MCP de ese servicio**. Devuelve la URL Microsoft oficial y un código temporal.
4. Abre la URL y escribe el código **en Microsoft**, acepta los permisos concedidos por ti. Kira usa `microsoft_login_complete` respetando `retryAfterSeconds` y confirma acceso mediante `microsoft_profile`. Nunca se envían contraseñas al chat.
5. El siguiente servicio requiere su propio paso de autorización. No se da por conectado Outlook Calendario por haber autorizado Outlook Correo. `microsoft_status` informa credenciales almacenadas, **no** da fe por sí solo de un acceso Graph actual.

El servidor usa la autoridad Microsoft `common` en los servicios personales compatibles con cuentas personales o de trabajo/educativas. **Teams y SharePoint** usan `organizations`: no son compatibles con una cuenta gratuita Outlook.com personal y su organización puede exigir permisos aprobados por un administrador. El conector de Teams implementa **lectura de equipos, canales y mensajes de canales**, no chats privados ni llamadas. SharePoint implementa **búsqueda de sitios y enumeración de bibliotecas**, no edición de documentos. OneDrive implementa enumeración de archivos y carpetas, no modificación de documentos. No se promete acceso empresarial donde Microsoft imponga restricciones.

El conector heredado `microsoft-personal` se conserva para compatibilidad, pero su autenticación no desbloquea automáticamente las nuevas identidades. La suite es una *capacidad transversal* de Phoenix, no un modo específico del agente.

**Pruebas:** `node --test scripts/phoenix-microsoft-personal-mcp.test.mjs scripts/phoenix-microsoft-scoped-mcp.test.mjs`. Esas pruebas no sustituyen una autorización real con una cuenta Microsoft en Windows. Los tokens de una cuenta concreta no están accesibles desde GitHub CI.
