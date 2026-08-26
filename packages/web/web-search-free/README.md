# @deepseek-ai/dsh-web-search-free

English | [中文](README.zh.md)

Proveedor de búsqueda sin claves para PHOENIX. Consulta Bing HTML y DuckDuckGo HTML en orden, normaliza fuentes y respeta `maxResults`. Está pensado como fallback explícito cuando el proveedor principal falla por cuota, créditos, límite, autenticación, timeout o indisponibilidad.

No almacena credenciales ni convierte una respuesta anti-bot en una cita. La navegación con Chrome dedicado puede montarse como proveedor independiente sobre el mismo seam `ctx.web`.

## Model Experience

### Conversation tool result, indirectly

#### What the model sees

A través de [`dsh-tool-web`](../tool-web/README.md), el modelo recibe URLs acotadas por `maxResults`, títulos y snippets normalizados bajo el contrato estable `web_search`; los fallos de Bing o DuckDuckGo no exponen credenciales ni HTML crudo.

#### Token effect

El resultado normalizado y sus citas consumen tokens del contexto cuando se añade al historial.

#### KV Cache effect

El resultado añade un sufijo al contexto; el prefijo sin cambios sigue siendo elegible para reutilización de caché.

## Known Limitations and Deferred Work

- Los buscadores HTML públicos pueden devolver CAPTCHA, resultados regionales o cambios de marcado; el proveedor prueba el siguiente motor y falla de forma acotada.
- No sustituye una API con garantías de disponibilidad ni ofrece navegación JavaScript; un proveedor Chrome separado puede cubrir esa necesidad.
- Las páginas devueltas deben verificarse antes de usarse como evidencia.
