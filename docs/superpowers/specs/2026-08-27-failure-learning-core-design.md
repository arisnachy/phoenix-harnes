# Failure Learning Core para PHOENIX

## Objetivo

Hacer que PHOENIX aprenda de los errores de todo el sistema. Ante un fallo, debe identificar la causa, consultar aprendizajes previos, probar una solución segura, evitar la reincidencia y conservar evidencia auditable.

El aprendizaje mejora el contexto operativo, las reglas, las rutas y las defensas del sistema. No modifica los pesos del modelo.

## Alcance

El sistema cubre errores de modelos, `model-router`, HARDNESS, herramientas, archivos, permisos, red y UI. La primera integración prioriza modelo/router/HARDNESS, sin crear memorias aisladas por paquete.

## Arquitectura

Se añadirá un Failure Learning Core compartido con cinco responsabilidades:

1. **Normalizador de errores.** Convierte errores heterogéneos a un formato común con código, mensaje seguro, proveedor, modelo, herramienta, operación y contexto mínimo. Elimina tokens, credenciales y datos sensibles.
2. **Memoria de fallos.** Persiste aprendizajes en `.kira/memory/failures.md`. Mantiene historial y nunca borra entradas silenciosamente.
3. **Analizador de causa.** Busca coincidencias exactas y similares; distingue causa confirmada, probable e hipótesis.
4. **Selector de recuperación.** Reutiliza soluciones verificadas, selecciona alternativas y ejecuta reintentos seguros y limitados.
5. **Validador gobernado.** Integra `LabMode` y `SelfImprovementLedger` de HARDNESS para probar, validar, registrar rollback y controlar promociones.

El flujo principal es:

```text
fallo
 → normalización segura
 → consulta de memoria
 → análisis de causa
 → recuperación conocida o investigación
 → prueba aislada
 → decisión gobernada
 → ejecución o aprobación
 → registro del aprendizaje
```

## Registro persistente

Cada aprendizaje debe conservar, como mínimo:

```yaml
id: failure-<fecha>-<id>
fingerprint: hash-del-error-normalizado
scope: model | router | tool | fs | ui | network | permission
symptom: descripción segura
cause: causa raíz confirmada
solution: corrección aplicable
prevention: regla para no repetirlo
evidence:
  reproduction: prueba que reproduce el fallo
  validation: prueba que confirma la solución
  regression: prueba de no reincidencia
confidence: hypothesis | probable | verified | retired
risk: low | medium | high | critical
affected_routes:
  - provider/model
rollback: procedimiento reversible
created_at: fecha
```

Los estados `hypothesis` y `probable` solo generan sugerencias y advertencias. Únicamente `verified` puede cambiar decisiones futuras automáticamente. Una entrada obsoleta pasa a `retired`, sin eliminar su historial.

## Integración con `model-router`

Antes de seleccionar un modelo, el router debe:

1. Calcular la huella de la misión.
2. Consultar fallos verificados relacionados.
3. Excluir rutas bloqueadas por causas vigentes.
4. Penalizar rutas con fallos probables.
5. Preferir rutas con soluciones verificadas.
6. Registrar la ruta elegida y el motivo.

Ejemplo: si `deepseek-official` tiene una causa confirmada de autenticación inválida, se excluye mientras persista la condición y se prefiere una ruta verificada alternativa. El router no modifica permanentemente el roster por sí solo.

## Integración con HARDNESS

Cada corrección se trata como experimento gobernado:

```text
UNKNOWN
 → reproducir fallo
 → registrar hipótesis
 → probar solución
 → ejecutar regresión
 → validar holdout
 → VERIFIED
 → registrar prevención
```

Una solución no puede congelarse ni afectar producción sin reproducción, causa demostrada, prueba focal, regresión, holdout y rollback. La adquisición externa queda fuera del núcleo inicial; las soluciones nuevas deben probarse primero en laboratorio.

## Autonomía y seguridad

### Permitido sin aprobación

- Reintentar operaciones idempotentes.
- Releer antes de editar.
- Cambiar temporalmente a un modelo alternativo verificado.
- Aplicar backoff.
- Repetir pruebas HARDNESS.
- Usar soluciones verificadas vigentes.
- Crear fixtures o experimentos aislados.

Toda acción automática tiene límite de intentos, tiempo máximo, `Correlation ID`, registro y rollback.

### Requiere aprobación

- Modificar código o configuración persistente.
- Cambiar credenciales, proveedores o permisos.
- Escribir fuera del workspace autorizado.
- Promover un experimento a producción.
- Alterar instrucciones base, personas o políticas.
- Instalar dependencias.
- Contactar servicios externos para investigar.
- Marcar una ruta como definitivamente segura.

Los fallos repetidos elevan la severidad y reducen la confianza. Una ruta puede bloquearse temporalmente con alternativa, pero no eliminarse de forma irreversible automáticamente.

## Pruebas

Se requieren pruebas focales para normalización sin filtración de secretos, fingerprints estables, consulta de memoria, reutilización de soluciones verificadas, exclusión de rutas fallidas, alternativas, reintentos seguros, bloqueo de acciones no autorizadas, persistencia/restauración, rollback y separación entre hipótesis y reglas activas.

Cada fallo conocido tendrá una prueba de no reincidencia:

```text
error inicial
 → causa registrada
 → solución aplicada
 → prueba exitosa
 → segunda ejecución sin repetir el error
```

También se ejecutarán pruebas del ciclo completo mediante HARDNESS, typecheck, lint y regresión de los paquetes afectados.

## Métricas

- Fallos nuevos y repetidos.
- Soluciones verificadas y rechazadas.
- Rutas evitadas correctamente.
- Recuperaciones exitosas.
- Reintentos innecesarios.
- Tiempo hasta la solución.
- Falsos diagnósticos.
- Acciones detenidas correctamente por aprobación.

## Criterios de aceptación

1. Todo error relevante genera un registro seguro.
2. Las causas confirmadas se consultan antes de reintentar.
3. Una ruta fallida no vuelve a elegirse bajo la misma causa.
4. Las soluciones verificadas se reutilizan.
5. HARDNESS impide promociones sin evidencia.
6. No se filtran secretos ni datos sensibles.
7. Las reparaciones no autorizadas se bloquean.
8. Pasan pruebas focales, regresión, typecheck y lint.
9. El flujo queda documentado y auditable.

## Límites explícitos

La primera versión no entrena ni modifica pesos de modelos, no ejecuta investigación externa sin autorización, no promueve cambios automáticamente y no sustituye los controles existentes de sandbox, aprobación, rollback o seguridad.
