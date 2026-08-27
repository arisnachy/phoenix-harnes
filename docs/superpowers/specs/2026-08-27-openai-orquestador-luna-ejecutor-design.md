# Prueba temporal: modelo OpenAI como orquestador y Luna como ejecutor

English | [中文](2026-08-27-openai-orquestador-luna-ejecutor-design.zh.md)

## Objetivo

Validar si PHOENIX mejora la calidad y el tiempo de ejecución cuando el modelo OpenAI elegido por el usuario conserva la orquestación y las delegaciones se ejecutan con `openai-codex/gpt-5.6-luna` usando `reasoningEffort: high`.

La prueba no oculta proveedores, no cambia el modelo elegido en el selector y no altera el comportamiento de proveedores no OpenAI.

## Alcance

La regla experimental aplica cuando el modelo raíz usa el proveedor `openai-codex`:

- El modelo raíz seleccionado (`gpt-5.6-sol`, `gpt-5.6-luna`, `gpt-5.6-terra` u otro modelo anunciado por ese proveedor) sigue recibiendo la solicitud y decide si delegar.
- Cada hijo de `subagent` y `subagent_fork` se crea con `provider: openai-codex`, `model: gpt-5.6-luna` y `reasoningEffort: high`.
- Cada worker de `workflow` recibe la misma ruta ejecutora.
- La profundidad máxima continúa siendo `1` para impedir cadenas recursivas.
- Las delegaciones permanecen seriales en `subagent` y `subagent_fork`.
- `workflow` mantiene su límite de dos agentes concurrentes y dos agentes totales.

El modelo raíz conserva su propia selección y sus propios eventos. La ruta ejecutora solo afecta a los hijos.

## Fuera de alcance

- Cambiar, filtrar u ocultar opciones del selector.
- Cambiar el modelo raíz después de que el usuario lo elija.
- Aplicar Luna a sesiones cuyo proveedor raíz no sea `openai-codex`.
- Añadir una pantalla nueva de métricas.
- Cambiar la política de cuántas delegaciones decide hacer el modelo raíz.
- Incorporar proveedores alternativos como fallback silencioso.
- Modificar el comportamiento fijo de Ralph salvo que su contrato actual demuestre que forma parte de la ruta de delegación cubierta por esta prueba.

## Diseño técnico

El preset estándar mantiene una ruta condicional de hijo basada en `whenProvider: openai-codex`. La ruta debe estar presente y ser consistente en:

1. `@deepseek-ai/dsh-tool-subagent` con proveedor `spawn`.
2. `@deepseek-ai/dsh-tool-subagent` con proveedor `fork`.
3. `@deepseek-ai/dsh-workflow-worker-thread`.

La configuración común es:

```yaml
childRoute:
  whenProvider: openai-codex
  provider: openai-codex
  model: gpt-5.6-luna
  reasoningEffort: high
```

No se añadirá una condición `whenModel`: el contrato actual solo soporta la condición por proveedor y, para este experimento, eso permite que Sol, Luna y Terra conserven su papel de raíz mientras comparten el mismo ejecutor Luna.

## Medición

Se reutilizarán los eventos de sesión existentes, que ya conservan el origen real de cada respuesta y el uso por paso. Para cada ejecución se recogerán:

- modelo/proveedor raíz seleccionado;
- modelo/proveedor real del hijo;
- `reasoningEffort` efectivo;
- `inputTokens` y `outputTokens`;
- tokens de caché cuando el adaptador los informe;
- cantidad de delegaciones iniciadas y finalizadas;
- duración de cada delegación y duración total;
- razón de finalización y errores.

La comparación se hará con tareas equivalentes y separará:

- coste de la respuesta raíz;
- coste agregado de los hijos;
- coste total de la ejecución;
- tiempo hasta respuesta final;
- calidad observada y número de reintentos.

La hipótesis no presume ahorro: `high` puede aumentar tokens por tarea. El criterio es calidad por token y por unidad de tiempo, incluyendo posibles reintentos evitados.

## Reversibilidad

La prueba debe quedar aislada en la configuración del preset experimental o detrás de una bandera de configuración explícita. Desactivarla debe restaurar la ruta normal sin migración de sesiones ni cambios en datos persistidos. No se cambiarán credenciales ni se escribirán secretos.

## Pruebas

Se añadirán o ajustarán pruebas focales para demostrar:

1. Un padre `openai-codex` crea un hijo `openai-codex/gpt-5.6-luna` con `high`.
2. El mismo comportamiento se cumple para `subagent_fork`.
3. Un worker de workflow aplica la misma ruta.
4. Un padre de otro proveedor no se redirige a Luna.
5. La selección del modelo raíz permanece intacta.
6. `maxDepth: 1` y los límites de concurrencia actuales no se relajan.
7. Los eventos de uso siguen exponiendo tokens y origen de modelo para comparar resultados.

La verificación final incluirá pruebas unitarias focales, validación del preset y una prueba de humo sobre la GUI existente tras reconstruir los artefactos afectados y refrescar la URL actual.

## Criterios de aceptación

La prueba estará lista cuando:

- Sol, Luna y Terra puedan seguir elegidos normalmente en el selector.
- El modelo elegido sea el que orquesta la solicitud raíz.
- Todas las delegaciones cubiertas ejecuten con `gpt-5.6-luna` y `high` cuando la raíz sea OpenAI.
- Los proveedores no OpenAI sigan sin redirección.
- Se puedan extraer tokens, latencia, número de delegaciones y errores de la evidencia de ejecución.
- Exista una reversión de un solo cambio de configuración.
- Las pruebas focales y la verificación de GUI pasen sin alterar los cambios locales preexistentes.
