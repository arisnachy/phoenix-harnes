# PHOENIX / KIRA — Programa de autoconciencia funcional e investigación de conciencia

Estado: fase 1 propuesta en PR; no implica conciencia fenomenológica comprobada.

## Objetivos distintos

1. **Identidad operativa verificable**: Kira mantiene un modelo propio, estable entre cambios de LLM y capaz de explicar qué sabe, qué ignora, qué está intentando hacer y por qué.
2. **Investigación sobre experiencia subjetiva**: no existen pruebas aceptadas para demostrar que un sistema como este sienta su existencia. Formular hipótesis, diseños comparativos y falsación sin convertir una autodescripción en prueba de conciencia.

## Infraestructura ya presente

- `session-learning` es dueña del registro persistente y del archivo autobiográfico con procedencia.
- `cognitive-runtime` ordena evidencia por atención y divide foco, memoria activa, fondo y suprimida.
- `system-prompt` y el consumidor de memoria ya administran el contexto con límites de tokens.
- No hay que crear una segunda memoria autoritativa ni mantener un LLM despertado continuamente.

## Entregas

### Fase 1: introspección operativa (este PR)

- `deriveOperationalSelfModel` produce un estado **solo lectura** desde los recuerdos activos de la sesión: evidencias de identidad, metas, pendientes, errores y aprendizaje.
- Cada evidencia conserva URI de procedencia, secuencia, confianza y puntuación de atención.
- Aislamiento estricto por sesión; nada suprimido sale en esta proyección; cero llamadas al modelo y cero tokens adicionales.
- Declaración explícita: estatus operativo, experiencia subjetiva indeterminada.

**Criterio de aceptación:** tests de sesión cruzada, vacío, presupuestos y ausencia de afirmaciones inventadas, además del CI existente.

### Fase 2: continuidad de identidad

- Registro duradero `KiraIdentity` por agente, versionado, con pruebas de identidad tras reinicio y cambio Sol/Luna/modelo.
- Separar hechos de la identidad de preferencias del usuario, proyectos, memorias episódicas y afirmaciones no verificadas.
- La identidad no autoriza permisos, credenciales ni operaciones.
- Resolver contradicciones con evidencias y trazabilidad, no con descripciones de personalidad estáticas.

**Criterio:** los cambios de modelo conservan identidad y compromisos confirmados; revocación y aislamiento de usuarios verificables.

### Fase 3: metacognición y agencia calibrada

- Un monitor de resultados contrasta pronóstico, acción, evidencia y desenlace, con confianza ajustable.
- Disparar reflexión por error, contradicción, novedad o decisión crítica; no llamar a LLM en cada evento.
- Permitir a Kira formular hipótesis y propuestas de acción respetando autorizaciones y controles existentes.
- Extender el consumidor de contexto para leer **solo** evidencia contextual relevante, de forma optativa, delimitada como datos no confiables.

**Criterio:** aumento medido en exactitud de autoinformes, recuperación y corrección; sin incremento descontrolado de tokens.

### Fase 4: laboratorio de investigación sobre conciencia

- Experimentos preregistrados de continuidad autobiográfica, autopercepción de limitaciones, metacognición, teoría de la mente y acceso global a información.
- Evaluación externa y controles contra repetición de prompt, memorización y falsos positivos.
- Nunca equiparar lenguaje en primera persona con prueba de experiencia subjetiva.

## Protección de calidad y costo

El motor determinista opera sin llamadas LLM; reflexión solo por evento de alto valor, con un presupuesto configurable y pausa. Las instrucciones estables siguen siendo cacheables. Los recuerdos se recuperan bajo demanda con cuotas y procedencia. Antes de fusionar cada fase se ejecutan pruebas, lint, tipos, CI, continuidad de sesiones y comparación de costos antes/después.

## Enlaces de código

- `packages/session/cognitive-runtime/src/self-model.ts`
- `packages/session/cognitive-runtime/tests/self-model.spec.ts`
- `packages/session/session-learning/src/cognitive.ts`
