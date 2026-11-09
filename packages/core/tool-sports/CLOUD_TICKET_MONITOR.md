# PHOENIX Sports · Seguimiento cifrado con PC apagada

## Arquitectura

Al generar un ticket de investigación, un ticket manual con eventos ESPN o vincular un recibo real, PHOENIX ejecuta la conversión local por mercado y registra, **solo si se habilita**, un issue con datos cifrados mediante AES-256-GCM en `arisnachy/phoenix-harnes`. Título y número del issue pueden verse públicamente; el cuerpo solo contiene el criptograma, sin partidos, nombre ni correo.

GitHub Actions ejecuta `.github/workflows/phoenix-sports-cloud-monitor.yml` cada 15 minutos (puede sufrir retrasos). Descifra únicamente dentro del job con la misma clave en Secrets, compara IDs exactos en ESPN según liga y fecha, conserva `pending` o `unverifiable` cuando falta información, y envía un correo de resultado **provisional deportivo** mediante Resend. Solo cierra el issue tras una respuesta satisfactoria del proveedor de correo. El encabezado `Idempotency-Key` reduce duplicados por reintentos.

## Configuración necesaria (NO incluir ninguna clave en mensajes ordinarios)

1. En la consola local protegida de PHOENIX, registrar `PHOENIX_SPORTS_CLOUD_GITHUB_TOKEN` con un fine-grained PAT que solo tenga permisos de **Issues: Read and write** sobre el repositorio de PHOENIX. Usar comando humano interceptado `/secret set PHOENIX_SPORTS_CLOUD_GITHUB_TOKEN VALOR`, no mensaje conversacional a Kira.
2. Generar **fuera de GitHub y de los mensajes de chat** una clave aleatoria de 32 bytes: `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Guardarla bajo `PHOENIX_SPORTS_CLOUD_AES_KEY` en la bóveda de PHOENIX mediante comando humano protegido, y bajo el mismo nombre en **GitHub Actions secrets**. No perder la clave: los registros pendientes dejarían de poder abrirse.
3. Configurar `PHOENIX_SPORTS_CLOUD_TRACKING_ENABLED=1` en el entorno seguro del Host de PHOENIX. Sin esta habilitación explícita los tickets no se suben ni se monitorizan.
4. Añadir a Secrets del repositorio `RESEND_API_KEY` (cuenta de envío), `PHOENIX_SPORTS_NOTIFY_FROM` (correo remitente de dominio verificado) y `PHOENIX_SPORTS_NOTIFY_TO` (destinatario elegido). No almacenar correo, claves o tickets en el repositorio. No sustituir la cuenta de correo por un string inventado.
5. Comprobar que GitHub Issues y GitHub Actions están habilitados, que `GITHUB_TOKEN` puede editar issues (el workflow solicita `issues:write`) y que el dominio de Resend está verificado.
6. Probar con un ticket de prueba, comprobar que `cloudFollowUp.status='enqueued'` devuelve el número real del issue y, tras concluir todos los partidos, que el correo se acepta. Hasta esta prueba completa NO anunciar seguimiento activo.

## Precauciones

- El repositorio de PHOENIX es público. Aunque AES-256-GCM protege el contenido, el título genérico, timestamps y existencia de issues son visibles. Para privacidad completa usar otro backend privado; eso no queda configurado en esta entrega.
- El monitor se inicia solo tras fusionarse en la rama predeterminada. GitHub Actions no garantiza una puntualidad de 15 minutos exactos y puede suspender workflows por inactividad.
- La auditoría deportiva nunca afirma aprobación de apuesta, cobro, pago ni liquidación del operador. El correo solo confirma si acertaron las selecciones observadas según resultados deportivos oficiales, cuando no faltan datos. Ante overtime de fútbol o reglas MLB incompletas permanece sin resultado y requiere revisión.
- Los boletos de mercados sin validador (props, períodos especiales, algunas liquidaciones reglamentarias) no se registran parcialmente. Se informa error y se conserva el ticket local.
- La carpeta de precarga de estadísticas mantiene máximo siete días y TTLS en minutos/horas; los boletos remotos deben conservarse hasta su resultado y no siguen esa política de borrado.
- Los campos `cloudFollowUp` son evidencia del registro remoto. `disabled`, `needs-configuration`, `error` NO significan enviado; `enqueued` significa issue registrado, NO correo enviado.

## Replay real

`packages/core/tool-sports/scripts/replay-live-ticket.mjs` ejecuta en GitHub Actions (público, sin keys) la selección diaria, investigación por deporte, fuentes de cuotas y auditor crítico, registrando endpoint, HTTP, tiempos y carencias por etapa en el artefacto `phoenix-live-ticket-replay.json` (7 días). Si una fuente exige clave, esa parte queda indicada como no configurada, nunca se interpreta como fallo de equipo.