# PHOENIX Universal Web Access — gratis, con identidad real

Este módulo es **100 % gratuito por defecto**. No usa APIs de pago como ruta principal.
No promete acceso universal ni intenta engañar CAPTCHA, los filtros de un sitio o sus términos.

## Integrado en el producto

1. `web_search` usa `free-html` como fuente primaria en el perfil base. Bing y DuckDuckGo son rutas HTML sin clave y pueden imponer restricciones; la API oficial de Wikipedia en español ofrece una tercera ruta de descubrimiento para materias enciclopédicas.
2. `web_fetch` envía `PHOENIX-ResearchBot/1.0 (+https://github.com/arisnachy/phoenix-harnes)`. No presenta una marca ajena ni se hace pasar por un navegador humano.
3. Acceso directo a HTTP(S) público: conserva controles SSRF, límites de bytes, timeout, y redirecciones del mismo origen.
4. Antes de consultar fuentes públicas, consulta y cachea `robots.txt`, respeta el grupo del agente, las reglas Allow/Disallow y Crawl-delay. Un `robots.txt` inaccesible falla de forma conservadora. Un 403/429/503 provoca pausa por origen; la respuesta no genera bucles de reintentos.
5. Se puede habilitar Web Bot Auth con clave Ed25519 propia; la clave **no** se añade al repositorio.

## Crear identidad criptográfica sin pagar

Desde una terminal que disponga de OpenSSL:

```sh
openssl genpkey -algorithm ed25519 -out phoenix-bot-private.pem
openssl pkey -in phoenix-bot-private.pem -pubout -out phoenix-bot-public.pem
```

Mantenga `phoenix-bot-private.pem` fuera del árbol Git y de carpetas compartidas. Solo un proceso PHOENIX de confianza debe poder leerlo.

### Publicar el directorio de claves gratis

El directorio debe ser accesible por HTTPS con la ruta exacta:
`/.well-known/http-message-signatures-directory`. No basta con alojar un JSON estático: la respuesta del directorio también debe estar firmada.

El ejemplo de Cloudflare Worker, en `deploy/phoenix-bot-auth/`, publica un directorio JWK firmado con la **misma clave**. Cloudflare Workers Free ofrece un límite gratuito; no es necesario contratar un servicio de pago. Una cuenta gratuita y su subdominio `*.workers.dev` son suficientes para este ejemplo.

```sh
cd deploy/phoenix-bot-auth
npx wrangler login
npx wrangler secret put PHOENIX_BOT_AUTH_PRIVATE_KEY_PEM
npx wrangler deploy
```

Al introducir el secreto use el contenido PEM íntegro de `phoenix-bot-private.pem`. No copie claves privadas a un comando o conversación pública.

Una vez publicada la dirección, configure **en el host PHOENIX**:

```text
PHOENIX_WEB_BOT_AUTH_AGENT_URL=https://<subdominio-publicado>.workers.dev
PHOENIX_WEB_BOT_AUTH_PRIVATE_KEY_FILE=<ruta-privada-local>/phoenix-bot-private.pem
```

El `AGENT_URL` debe ser el origen HTTPS exacto donde está el directorio, sin path. Reinicie PHOENIX. Los encabezados `Signature`, `Signature-Input` y `Signature-Agent` se calcularán para **cada solicitud HTTPS**; en ausencia de las dos variables no se firman solicitudes. La identidad HTTP textual sigue funcionando.

### Registro de agente verificado

Para obtener el estatus de **Verified Bot** de Cloudflare es necesario enviar el formulario de registro en Cloudflare usando la URL pública del directorio. No es automático ni garantiza entrada a todas las páginas. Si el proveedor no aprueba, la firma solo acredita identidad ante servidores que la validen.

Documentación:
- https://developers.cloudflare.com/bots/reference/bot-verification/web-bot-auth/
- https://developers.cloudflare.com/bots/concepts/bot/verified-bots/
- https://developers.cloudflare.com/workers/platform/limits/

## Diagnóstico y límites

- `WEB_ROBOTS_DISALLOWED`: el sitio prohíbe esa ruta. No insistir; utilizar APIs oficiales, otra fuente autorizada o pedir acceso.
- `WEB_ROBOTS_UNAVAILABLE`: robots.txt no se pudo determinar con seguridad. No asumir permiso.
- `WEB_PROVIDER_RATE_LIMIT`: hay Crawl-delay, 429/503 o pausa previa. Cambiar de fuente, respetar el tiempo.
- Un CAPTCHA / challenge no debe resolverse mediante suplantación ni proxies rotatorios. Si la fuente es indispensable, la opción legítima es verificación humana en una sesión permitida.

## Pruebas

```sh
pnpm exec vitest run packages/web/web-fetch-http/tests/phoenix-bot-identity.spec.ts packages/web/web-fetch-http/tests/fetch-http.spec.ts packages/web/web-search-free/tests/free-search.spec.ts packages/bundle/base/tests/research-source-access.spec.ts
```

La firma requiere un dominio público y alta de tercero para verificación real. El código no crea, controla ni registra dominios automáticamente, y no afirma que se haya verificado la identidad sin completar ese proceso.
