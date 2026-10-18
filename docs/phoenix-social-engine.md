# Phoenix Social Engine (v1) — canales propios y marketing multired

Este módulo no finge crear cuentas ni publicar cuando no hay credenciales o comprobante.
Implementa un núcleo **persistente y auditable**, separado de runtimes/staging, con
marcas, perfiles declarados/verificados, campañas orgánicas, UTM, borradores,
revisión, programación, envíos por API y registro de resultados inciertos.

## Interfaces

- CLI: `pnpm social help` o `node scripts/phoenix-social.mjs help`.
- Pruebas: `pnpm test:social`.
- MCP: `social-engine` (servidor stdio local, herramientas de plan,
  identidad, borradores y reportes). Usa la instalación de conectores curados
  desde Configuración; la instalación **no** significa autenticación.
- Datos: `~/.dsh/social-engine/social.json` (Windows:
  `%USERPROFILE%\.dsh\social-engine\social.json`), o
  `PHOENIX_SOCIAL_HOME`. Es un directorio ajeno al staging.

## Identidad que debe tener Phoenix

`pnpm social init` crea el perfil **declarativo** `phoenix` para la marca
«Phoenix IA» y una biografía transparente. NO abre cuentas reales. Para cada
red, `pnpm social account-plan x`, `... instagram`, `... youtube`,
`... facebook`, `... tiktok` o `... linkedin` da la URL de alta y
requisitos. Solo el dueño real acepta las condiciones, resuelve captcha/2FA,
vincula correo/teléfono y completa OAuth. Kira no puede fabricar un email
verificado, evadir pasos de seguridad ni presentarse como persona humana.

Una vez creada la cuenta, declara el usuario o canal:

```powershell
pnpm social init
pnpm social account-plan x
pnpm social account-register phoenix x PhoenixMiMarca
pnpm social account-verify phoenix x
```

`account-register` es una anotación local, no una conexión; `account-verify`
consulta el proveedor oficial autenticado y exige que coincida la identidad.
Las cuentas ajenas van en otra marca (`brand-create`), nunca se mezclan.
No deben usarse cuentas de clientes sin su delegación expresa.

## Publicación mediante APIs oficiales

| Red | Soporte actual | Condiciones |
| --- | --- | --- |
| X | Verificación de usuario, textos y enlace UTM, recibo e ID reales | OAuth user token con escritura. La API puede exigir créditos/pago |
| Facebook Pages | Verificación de página, texto y enlaces | App Meta, Page Token y `pages_manage_posts` |
| Instagram Professional | Verificación y publicación de imagen HTTPS pública | Cuenta profesional; `instagram_content_publish`; proceso contenedor/publicación |
| YouTube | Verificación de canal y upload resumable de vídeo <=2 GiB | OAuth `youtube.upload`, cuota, configuración de privacidad y auditoría cuando aplique |
| TikTok | Planificación y entrega pendiente | `video.publish`, consentimiento y revisión/auditoría TikTok |
| LinkedIn | Planificación y entrega pendiente | Perfil/página y permisos de la aplicación |

**Los adaptadores HTTP están disponibles mediante CLI**, cuando el usuario
suministre tokens delegados en un entorno aislado autorizado (por ejemplo el
proceso del terminal, nunca en el chat). Variables por proveedor:
`PHOENIX_SOCIAL_X_USER_TOKEN`,
`PHOENIX_SOCIAL_FACEBOOK_PAGE_TOKEN` y
`PHOENIX_SOCIAL_FACEBOOK_PAGE_ID`,
`PHOENIX_SOCIAL_INSTAGRAM_TOKEN` y
`PHOENIX_SOCIAL_INSTAGRAM_USER_ID`,
`PHOENIX_SOCIAL_YOUTUBE_ACCESS_TOKEN`.

**Limitación MCP crucial**: el proceso MCP utiliza `scrubbedParentEnv()`
y **NO hereda** automáticamente estos tokens del Host. No se habilita
publicación desde el MCP hasta conectar un broker de credenciales cifrado
para cada proveedor (sin pasar secretos al modelo). Hasta entonces Kira usa
el MCP para contenido y seguimiento; un operador publica mediante el CLI
autenticado o un conector de publicación ya verificado. Los comandos
`social_publish_approved` y `social_execute_due_approved` pueden devolver
`OAuth no conectado` si se invocan desde el MCP sin ese broker; no deben
declararse operativos por la mera instalación.

## Ejemplo de campaña real

```powershell
pnpm social init
pnpm social campaign phoenix "Lanzamiento Phoenix" "https://ejemplo.com/producto"
pnpm social draft phoenix x "Conoce nuestro nuevo producto" --campaign ID
pnpm social posts
pnpm social show POST_ID
# Solo tras aprobación humana explícita, registrada por la interfaz de autorización:
pnpm social approve POST_ID --by "Responsable humano"
pnpm social schedule POST_ID 2026-11-01T14:00:00-04:00
pnpm social run-due
# El planificador propio del Host puede ejecutar luego "run-due --execute".
```

`approve --by` es un registro declarativo y NO comprueba por sí mismo
que una persona haya autorizado algo: Kira debe consultar al usuario.
La publicación inmediata requiere `publish POST_ID --confirm CHECKSUM`.
La cola solo se ejecuta con `run-due --execute`. No existe demonio
periódico activo por defecto. Se necesita una tarea del sistema o
planificador existente para ejecutar el comando cuando venza.

## Seguridad, costes, fallos y límites

1. Los tokens nunca se serializan en social.json. Establece credenciales en
   variables de entorno **solo de un proceso local de confianza** o integra
   un secreto en el vault y transfórmalo mediante broker Host; no imprimir.
2. Se guarda el estado `sending` antes de llamar la API; éxito solo con ID
   real del proveedor. Error/caída equivale a `uncertain`: reconciliar con
   el proveedor **antes** de reintentar y evitar duplicados.
3. Se impone límite conservador de tres publicaciones diarias por marca/red.
   No permite compra de seguidores, bots de respuestas masivas, mensajes no
   solicitados o técnicas para eludir controles de las plataformas.
4. Campañas orgánicas no son campañas de publicidad pagada. No lanzar
   anuncios o comprometer fondos sin aprobación expresa del titular.
5. No inventar alcance, visualizaciones, conversiones, ingresos ni ROI:
   solo se confirman IDs/URLs oficiales de publicación. El primer release
   todavía necesita recopiladores de Insights y conciliación comercial.
6. El código de upload de YouTube es funcional para vídeos compatibles y
   tokens autorizados, pero falta persistir sesiones resumables para tolerar
   interrupciones a nivel de bytes. Ante un fallo, verificar en YouTube.
7. El Host Windows debe ejecutar una versión actualizada y disponer de Node.
   Ejecuta tests de Node, tests del controlador MCP, compilación Host y Cliente
   antes de marcar release productivo.

## Roadmap siguiente

- Vault/broker OAuth con refresh + scopes por canal y autorización del usuario
  para publicaciones desde el MCP sin heredar variables sensibles.
- Registro de cuenta dirigido por navegador con estado de captcha/2FA y
  persistencia de sesión; intervención del humano donde la plataforma exige.
- Calendario y cola como vista nativa embebida, con previsualización.
- TikTok/LinkedIn con app review; videos Reels/Shorts y carruseles multimodales.
- Insights contrastados, atribución/conversiones y optimización de contenido.
- Exportar reportes y aprobaciones de campañas a biblioteca, correo y Telegram
  cuando esas salidas estén expresamente habilitadas.

## Fuentes

- X API: https://docs.x.com/x-api
- Instagram/Meta: https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api
- YouTube upload: https://developers.google.com/youtube/v3/docs/videos/insert
- TikTok Direct Post: https://developers.tiktok.com/docs/en/content-posting-api-get-started

## Conexión X/Meta y registro propio de Kira (reparación octubre 2026)

### Diagnóstico de X

Los componentes deben tratarse **separadamente**:

- `x-docs`: MCP público gratuito sin cuenta personal; documentación solamente.
- `x-api`: MCP vía `@xdevplatform/xurl` con OAuth del usuario conectado.
  No usa el registro MCP público; aparece en Configuración → Conectores → X.
- `x-api-phoenix`: identidad **distinta** para una cuenta de X ya creada
  para la marca. No compartir su token con una identidad personal.
- `social-engine`: servidor propio de Phoenix para preparar identidad,
  campañas, borradores y verificación; no es el mismo servidor que X oficial.

En Windows el bridge oficial se ejecuta por un `cmd.exe /d /c npx` con
argumentos estrictamente permitidos. Esto corrige la antigua ruta que
intentaba ejecutar el binario `npx` de forma directa, antes de OAuth.

La inicialización del MCP es **opcional**, porque X requiere Developer App,
OAuth, políticas y posiblemente créditos. La mera instalación no confirma
una sesión. Instalar X y Meta desde sus tarjetas fijadas funciona incluso
cuando el MCP Registry público falla.

### Kira crea su identidad y prepara cuentas propias

1. Invoca `social_phoenix_onboarding` desde el MCP local
   `social-engine`, o `pnpm social init` por la CLI local.
2. El motor prepara la marca `Phoenix IA` y devuelve enlaces oficiales
   para X, Instagram, Facebook Page, YouTube, TikTok y LinkedIn.
3. Kira prepara los formularios por navegador bajo dirección del titular,
   con nombre de marca y divulgación honesta de la IA. El titular confirma
   condiciones de servicio, datos del propietario, email/SMS, 2FA y captcha.
4. Una vez registrado un perfil real, ejecuta
   `social_account_register` y `social_account_verify`: no se
   considera conectado hasta que la API oficial confirme identidad.
5. Para X, utiliza una cuenta OAuth `x-api-phoenix` aislada de `x-api`.
   Para Meta, el MCP DevTools es distinto del token de publicación Graph
   y requiere una Página o Instagram Professional autorizados.

`social_phoenix_onboarding` devuelve siempre `externallyCreated:0`
para la operación actual: **no inventa el registro externo** ni promete
finalizar MFA automáticamente. La existencia de la cuenta y su titularidad
solo se certifican al verificarse con el proveedor.

### Pruebas sugeridas

```powershell
pnpm exec vitest run packages/host/plugin-inventory/tests/mcp-managed.spec.ts
pnpm exec vitest run packages/mcp/mcp-client/tests/platform.spec.ts
pnpm exec vitest run packages/client/ui-settings-models/tests/connector-catalog.client.spec.ts
pnpm test:social
pnpm exec tsc -b tsconfig.host.json
```

La validación en producción todavía requiere probar Windows, OAuth X real,
permiso Meta y herramientas presentes. Ni las pruebas unitarias ni el commit
prueban que ya existan perfiles de Phoenix en redes externas.

### Configuración segura en Phoenix (X OAuth)

Desde **Configuración → Conectores → X · cuenta de usuario → Configurar**
Phoenix muestra el nuevo formulario de aplicación X. Introduce el **Client
ID** y **Client Secret** solo en este formulario del Host: se guardan
mediante `ctx.credentials.set()` con referencias `X_CLIENT_ID` y
`X_CLIENT_SECRET`; la respuesta no incluye los valores ni se insertan en
el MCP `managed.patch.yml`.

- **Conectar cuenta X personal**: instala el bridge `x-api` con OAuth del
  usuario que autorice en el navegador.
- **Conectar X de Kira**: únicamente después de crear una cuenta oficial
  de marca Phoenix, introduce su @usuario real e instala
  `x-api-phoenix` por separado. Usa la misma app de desarrollador, pero
  la cuenta delegada y el consentimiento son diferentes.
- El callback inicial recomendado por X para `xurl` es
  `http://localhost:8080/callback`; ha de registrarse exactamente en
  X Developer Console. El puente oficial abre el navegador para OAuth
  en la primera conexión. Configurar no implica que el acceso ya esté
  autenticado o con permisos de escritura.
- El registro de una cuenta **sigue requiriendo** titular real,
  verificación de correo/teléfono, aceptación de condiciones y los pasos
  oficiales. El motor puede preparar y conducir, pero no falsear un
  registro.
