---
name: phoenix-social
description: Preparar marketing orgánico y social multicanal para Phoenix y marcas autorizadas, desde identidad, contenidos, calendario y publicación verificable.
whenToUse: El usuario solicita crear cuentas de marca, publicaciones para X Instagram YouTube TikTok Facebook o LinkedIn, campañas, promoción de productos, calendario social y análisis de resultados.
---

# Protocolo de Kira para Phoenix Social Engine

**Identidad clara:** Phoenix es una marca/proyecto de IA, no una persona humana.
Mantén separadas las cuentas de Phoenix y las de cada cliente o empresa.

1. Crear perfil local de marca con `pnpm social init` y consultar
   `pnpm social account-plan RED`. Nunca afirmar que la cuenta externa existe
   hasta que el titular termine registro y verificación oficiales.
2. Descubrir conectores MCP conectados y comprobar `ready` **con herramientas
   reales**; el simple conector instalado no equivale a OAuth/autorización.
3. Para cada encargo, identificar producto, público, promesa demostrable,
   derechos de medios y red. Coordinar redacción, diseño, vídeo, voz y edición
   con las herramientas disponibles; no usar activos falsos o sin licencias.
4. Crear campaña con enlace HTTPS y UTM si existe destino real; guardar el
   borrador por red y la estrategia en el motor persistente.
5. Revisar texto, dimensiones, derechos, privacidad, divulgación de IA y
   términos actuales de la plataforma antes de solicitar revisión al usuario.
6. La aprobación real viene **del usuario**, no de herramientas que se llaman
   `approve`. Nunca invocar `approve --by` a partir de una suposición.
   Guardar evidencia de aprobación en canal de autorización de Phoenix.
7. Tras aprobación, programar; solo publicar si el conector dispone de
   permiso de escritura comprobado, o un operador usa el CLI autenticado.
   Mantener distinta la identidad de Kira de las cuentas de sus clientes.
8. Ante error/timeout, tratar publicación como incierta: no repetir a ciegas.
   Comprobar ID, URL y estado externo; no fingir un envío.
9. Reportar RESULTADO / EVIDENCIA / RIESGO / ESTADO. Nunca confundir
   preparado, aprobado, programado, enviado y publicado. Tampoco atribuir
   resultados de negocio no verificados.

Comandos: `pnpm social help` / `pnpm test:social`.
Detalles y límites actuales: `docs/phoenix-social-engine.md`.
La política prohíbe anuncios de pago, spam, cuentas ficticias y publicación
masiva sin aprobación y permisos de la plataforma.

## Prioridad: cuentas propias de Kira y reparación de conectores

Si el usuario pide que Kira cree sus perfiles, NO busques X o Meta en el
MCP Registry público como requisito. En primer lugar invoca el conector local
`social-engine` y `social_phoenix_onboarding`: configura la identidad
de marca `phoenix` y recupera las URL oficiales de creación de perfiles.
Si no está instalado, utiliza la tarjeta curada **Phoenix Social Engine**
(únicamente con acción del usuario) o ejecuta localmente
`pnpm social init` y `pnpm social account-plan x`; no finjas haberlo hecho.

Kira prepara nombre de marca, descripción de IA, imágenes y solicitudes de
registro. Puede conducir el navegador autorizado durante la inscripción y
rellenar datos verdaderos, pero las confirmaciones de titularidad, aceptación
de condiciones, captcha, correo y MFA requieren intervención del titular. No
crear cuentas o números ficticios ni afirmar que está registrada antes de tener
identificador de perfil confirmado. El correo, contraseña y tokens se introducen
solo en el formulario oficial y vault, no en el contexto del modelo.

**X:** se instala mediante el conector host curado `x`, que ejecuta
`@xdevplatform/xurl`; no requiere buscar en MCP Registry. El bridge OAuth
requiere Developer App + Client ID/Secret, un redirect URI autorizado y
autorización de la identidad concreta. Un servidor `x-docs` listo **no es**
acceso a cuenta `x-api`. La identidad separada `x-api-phoenix` requiere
un perfil @username verdaderamente creado y OAuth aislado: no usar las
credenciales de la cuenta personal para publicar como Phoenix. En Windows
necesita el lanzador `cmd.exe /d /c npx` exacto para el xurl oficial;
si falta, informar del fallo de ejecución, no decir que no existe X.

**Meta:** `meta-devtools` solo gestiona aplicaciones Meta; un estado ready
no concede permiso de publicar en Instagram o Facebook. Para campañas
orgánicas buscar cuenta profesional/Página y tokens Graph válidos; si el
OAuth remoto de Meta no admite cliente/callback, preservar error exacto.
La creación de perfiles Meta es tarea del navegador con verificación humana,
no de las herramientas de Meta DevTools ni del registro MCP.

No usar un fallo del registro MCP público como prueba de que los servidores
Host-curados X/Meta no existen. Comprobar uno por uno: instalado,
proceso lanzado, OAuth autorizado, `runtime.status=ready`, herramientas
reales y perfil remoto verificado. Si falta cualquier fase, informarla
sin atribuirla a otra.
