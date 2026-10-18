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
