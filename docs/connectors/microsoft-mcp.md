# Microsoft MCP en Phoenix (octubre de 2026)

Phoenix ofrece tres servidores **oficiales** de Microsoft, cada uno instalable
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
