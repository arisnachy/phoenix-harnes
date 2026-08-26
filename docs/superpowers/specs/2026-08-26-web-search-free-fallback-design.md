# Fallback gratuito para investigación web

## Objetivo

Evitar que un fallo de créditos, cuota, autenticación, límite o disponibilidad del proveedor primario termine la investigación. PHOENIX debe intentar una ruta gratuita verificable mediante navegador dedicado y, si no está disponible, una ruta HTTP gratuita.

## Alcance

Se modifica únicamente la capacidad de búsqueda web. No se modifican identidad, credenciales, prompt núcleo, sandbox global ni proveedores de pago. El proveedor primario conserva prioridad cuando está disponible.

## Diseño

`ctx.web.search()` usará una política de fallback explícita. Primero ejecuta el proveedor configurado. Los errores recuperables se clasifican sin exponer secretos: cuota/créditos, 401/403, 429, timeout, proveedor no disponible y fallo transitorio. Ante esos errores, intenta el proveedor de navegador dedicado y después el proveedor HTTP gratuito. Los errores de validación, cancelación explícita o configuración ambigua no hacen fallback silencioso.

El proveedor de navegador usa una sesión Chrome aislada del perfil personal, navega a motores gratuitos configurados, extrae título/URL/snippet y devuelve el vocabulario normalizado de `dsh-web`. Cada intento tiene timeout, límite de resultados y limpieza garantizada. Si Chrome no está instalado o no inicia, el error se convierte en indisponibilidad recuperable y continúa la cadena.

La ruta HTTP gratuita queda como último recurso y debe tolerar HTML incompleto, anti-bot, redirecciones y ausencia de resultados. Bing será el motor inicial; DuckDuckGo se intentará como alternativa. Las fuentes se deduplican por URL y nunca se inventan citas.

La respuesta final conserva las fuentes y añade metadatos no sensibles de proveedor utilizado y rutas intentadas para diagnóstico. Los mensajes de error no contienen claves, tokens, cabeceras ni URLs con credenciales.

## Criterios de aceptación

- Un error simulado de créditos del proveedor primario llega a Chrome/HTTP y devuelve fuentes.
- Un 401, 429 y timeout activan fallback; cancelación del usuario no activa fallback.
- Chrome usa perfil dedicado y se cierra al terminar o fallar.
- Bing y DuckDuckGo se prueban en orden configurable y se detienen al obtener resultados válidos.
- Fuentes duplicadas se eliminan y `maxResults` se respeta.
- Con todas las rutas fuera de servicio se devuelve un error estructurado con rutas intentadas, sin secretos.
- Las pruebas son deterministas con fixtures; un smoke separado verifica navegación real cuando Chrome está disponible.

## Promoción

La implementación se integra primero sobre `main`, ejecuta pruebas focales, typecheck, build y gates relevantes. Solo con todo verde se crea/promueve `stable`; ningún push o promoción se hace si hay fallos o cambios no revisados.
