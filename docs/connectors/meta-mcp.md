# Meta en Phoenix: DevTools, Facebook, Instagram y WhatsApp Business

Este documento diferencia las **integraciones oficiales de Meta** y evita confundir
una app de desarrollador con una página de Facebook, una cuenta de Instagram o
un número de WhatsApp. **Ninguna conexión es gratuita para todo uso ni concede
permisos por el mero hecho de instalarla.** Nunca pegues tokens en el chat.

## 1. Meta Social Technologies / Developer Tools MCP

- Fuente: [documentación oficial de Meta](https://developers.facebook.com/documentation/mcp/devtools-mcp)
  y [repositorio oficial de Meta Agentic Tools](https://github.com/facebook/agentic-tools).
- Servidor remoto: `https://mcp.facebook.com/devtools`.
- Phoenix → **Configuración → Conectores → Meta Social Technologies (DevTools) → Instalar**.
- Identidad del MCP en Phoenix: `meta-devtools`; flujo `mcp-client/meta-devtools`.
- Autenticación: Meta Developer OAuth, con autorización sobre las apps que poseas o administres.
- Para Kira: inventario de apps, App Review, permisos, límites de la API,
  cumplimiento, cambios de API, comprobación y gestión de webhooks.
- **No es** una API de publicaciones de Facebook Pages, Instagram Feed, Messenger
  ni WhatsApp Business. Para eso hace falta conectar cada producto con sus
  propias credenciales y permisos mediante Graph API o el MCP empresarial de WhatsApp.

Pruebas seguras tras autorizar: enumerar apps propias y consultar API usage
o las suscripciones actuales de webhooks. No alterar webhooks sin permiso.

## 2. WhatsApp Business Tools MCP

- Servidor oficial remoto: `https://mcp.facebook.com/whatsapp_business_tools`.
- Phoenix → **Configuración → Conectores → WhatsApp Business Tools (Meta) → Instalar**.
- Identidad del MCP en Phoenix: `meta-whatsapp-business`; flujo
  `mcp-client/meta-whatsapp-business`.
- Necesitas cuenta empresarial/portafolio Meta que administres, una aplicación
  de Meta con WhatsApp Business habilitado que también administres, aceptar los
  términos de la **WhatsApp Business Platform / Cloud API**, y permitir el OAuth
  de Meta. No concede acceso al WhatsApp personal o a su aplicación móvil.
- Para Kira: leer empresas, cuentas y números de WhatsApp; inspeccionar o
  configurar plantillas y webhooks; preparar incorporación de números y
  tareas de soporte. Los envíos requieren los permisos y requisitos de Meta.
- Primera prueba **sin escritura ni coste**: listar las empresas autorizadas
  (por ejemplo la herramienta `whatsapp_biz_businesses` si el servidor la publica).
- No inventar nombres de herramientas ni asumir que están disponibles: consultar
  el inventario MCP, el estado `ready` y los `toolNames` reales.

### Costes y reglas de aprobación

**Usar el MCP o consultar cuentas no implica que todos los mensajes sean gratis.**
WhatsApp Business Platform tiene tarifas de Meta que dependen del tipo de mensaje,
destino, ventanas de servicio y volumen. Desde octubre de 2026 hay una franquicia
de hasta 1.000 mensajes de servicio al mes por número, según la política vigente,
y los mensajes de plantilla de marketing/autenticación/utilidad pueden tener
tarifas. Consulta siempre la página oficial de precios antes de enviar:
[WhatsApp Business Platform Pricing](https://developers.facebook.com/docs/whatsapp/pricing).

**Conducta obligatoria para Kira**: no iniciar envíos, campañas,
modificaciones de pagos, alta de números ni cambios de webhooks en nombre del
usuario sin su autorización explícita. Antes de un mensaje, mostrar destinatario,
contenido, tipo de mensaje y riesgo de coste, y esperar aprobación. Si Phoenix
no puede confirmar que el mensaje sea gratuito, tratarlo como potencialmente
facturable. No iniciar mensajes masivos automáticamente.

## 3. Facebook e Instagram: uso de las APIs oficiales

El servidor DevTools de Meta **no habilita por sí mismo** operaciones orgánicas
en páginas o perfiles. Para que Kira administre tus activos:

- **Facebook Pages**: aplicación de Meta, rol y permisos de páginas apropiados
  (por ejemplo `pages_show_list`, `pages_read_engagement` y
  `pages_manage_posts` cuando corresponda). Las publicaciones y respuestas
  requieren permisos específicos, sujetos a revisión de Meta.
- **Instagram Professional**: cuenta Business/Creator y acceso a la API de
  Instagram con permisos adecuados para el caso de uso (lectura, publicación,
  comentarios o mensajería). Las cuentas personales no tienen acceso integral
  a esas capacidades por Graph API.
- **Mensajes**: WhatsApp Business Cloud API utiliza el conector empresarial
  específico arriba; Messenger e Instagram Direct tienen permisos y reglas
  independientes.
- **Publicidad en Facebook/Instagram**: es una funcionalidad distinta, con
  posibles cargos de anuncios. No está activada por este paquete gratuito.

**Estado de Phoenix:** se incluyen los dos MCP oficiales DevTools y WhatsApp
Business como conectores opcionales. La administración orgánica completa de
Facebook Pages e Instagram por Graph API **no se ha implementado** en este
cambio; no afirmar ni simular publicaciones.

## 4. Problemas conocidos de OAuth en clientes MCP personalizados

Meta OAuth puede exigir un redirect URI HTTPS y algunos clientes que usan
`http://127.0.0.1` no completan el consentimiento. También hay clientes que
encuentran inconsistencias en los metadatos `issuer` que publica Meta.
**La instalación no demuestra autorización ni uso efectivo.**
No ocultar errores ni rebajar la comprobación de `issuer` o `state`.

Diagnóstico seguro:
1. Revisar si el Host ha registrado `mcp-client/meta-devtools` o
   `mcp-client/meta-whatsapp-business`.
2. Iniciar **Autorizar** y comprobar si Meta permite abrir y completar su
   consentimiento; no prometer una URL inventada.
3. Exigir `runtime.status === 'ready'` y herramientas reales antes de mostrar
   la conexión como operativa. Si Meta rechaza el callback, mostrar la etapa y
   explicar que es un límite de compatibilidad del cliente, no una autorización
   completada.
4. Nunca compartir tokens, app secrets ni las respuestas completas de OAuth.

La documentación de Meta de conexión con Claude, Cursor, Codex y ChatGPT no
garantiza que cualquier Host personalizado soporte sus requisitos de OAuth.
