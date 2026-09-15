# PHOENIX Cognitive Memory v2

## Objetivo

Convertir la memoria actual de PHOENIX en un sistema cognitivo persistente que recuerde experiencias, consolide conocimiento, aprenda procedimientos por observación y resultados verificados, reutilice soluciones diagnósticas, gestione incertidumbre y responda de forma humana sin narrar su infraestructura interna.

El sistema no modifica los pesos del modelo. Aprende mediante memoria durable, eventos, evidencia, procedimientos, relaciones, consolidación y recuperación contextual.

## Principios de diseño

1. **La experiencia produce evidencia, no verdad automática.** Ejecutar algo una vez no basta para convertirlo en una regla. Los resultados deben conservar su procedencia, verificación, confianza y vigencia.
2. **Recordar y aprender son procesos distintos.** Un episodio puede recordarse aunque haya terminado mal; una habilidad reutilizable solo se promueve cuando existe evidencia suficiente.
3. **La memoria sirve al trabajo y no domina la conversación.** PHOENIX aplica recuerdos relevantes de forma silenciosa y solo explica detalles internos cuando el usuario los pide.
4. **La respuesta humana es una responsabilidad separada del almacenamiento.** La memoria puede contener estados, confianza, fallos y evidencia; la respuesta final los traduce a lenguaje natural apropiado sin volcar etiquetas técnicas.
5. **Los recuerdos se recuperan por intención, tiempo, proyecto, similitud y relaciones.** Preguntas como “¿qué hicimos ayer?”, “hazlo como la otra vez” o “¿cómo arreglaste ese error?” no dependen de que la conversación anterior siga abierta.
6. **Los recuerdos pueden corregirse, degradarse, supersederse o retirarse.** La memoria no congela procedimientos obsoletos.
7. **Lo visible al modelo permanece reconstruible desde hechos durables.** La implementación conserva la regla de PHOENIX de que todo contexto model-visible debe poder derivarse del registro durable correspondiente.

## Base existente que se conserva

`@phoenix-ai/dsh-tool-session-learning` ya aporta `memory_search`, `memory_remember`, `memory_teach`, curación autónoma, aprendizaje adaptativo, aprendizaje procedural, contexto reciente y recomendaciones de procedimientos verificados.

`ProceduralLearningEngine` ya distingue aprendizaje guiado y por experiencia, estados `candidate`, `active` y `quarantined`, confirmaciones, fallos, correcciones, confianza, huellas de tarea y promoción basada en verificación.

Cognitive Memory v2 no sustituye esas capacidades. Las integra dentro de una arquitectura más completa y añade persistencia episódica, consolidación semántica, memoria diagnóstica, metamemoria, recuperación temporal y una capa explícita de expresión humana.

## Arquitectura

La arquitectura queda dividida en ocho responsabilidades pequeñas y testeables.

### 1. EpisodicMemory — qué vivió PHOENIX

Cada misión significativa produce uno o más episodios durables. Un episodio representa trabajo real ocurrido, no una conclusión inferida.

Cada episodio incluye como mínimo:

```yaml
id: episode-<stable-id>
session_id: <session>
project_id: <optional-project>
started_at: <timestamp>
ended_at: <timestamp>
user_intent: <bounded-summary>
status: completed | partial | failed | cancelled
entities: []
tools_used: []
artifacts: []
errors: []
decisions: []
outcome_summary: <secret-free-summary>
verification:
  state: unverified | partial | verified | disproven
  evidence: []
source_events: []
```

Los episodios se derivan de eventos de sesión, objetivos, herramientas, resultados y evidencia de finalización. No se construyen a partir de commit recency ni de una descripción inventada después de los hechos.

La memoria episódica permite responder preguntas temporales y autobiográficas del propio trabajo de PHOENIX, incluidas “ayer”, “la semana pasada”, “el último proyecto”, “qué aprendiste de eso” y “continúa lo anterior”.

### 2. SemanticMemory — qué sabe PHOENIX

La memoria semántica consolida hechos o relaciones estables extraídos de episodios, correcciones y fuentes confiables.

Una memoria semántica conserva:

- proposición normalizada;
- entidades y relaciones;
- alcance o dominio;
- evidencia de soporte y contradicción;
- confianza;
- fecha de última validación;
- procedencia;
- estado `active`, `superseded`, `obsolete` o `forgotten`.

El consolidator evita duplicados y mantiene versiones cuando el conocimiento cambia. Una afirmación nueva no sobrescribe silenciosamente una anterior contradictoria; ambas quedan relacionadas y una puede superseder a la otra con evidencia.

### 3. ProceduralMemory — cómo sabe hacerlo

El motor procedural existente sigue siendo la base del aprendizaje de habilidades.

Cognitive Memory v2 amplía su ciclo para capturar automáticamente secuencias de trabajo reutilizables a partir de episodios verificados. Ejemplos:

- completar una encuesta concreta en un sitio;
- diagnosticar y reparar un fallo de arranque;
- preparar una publicación siguiendo una secuencia estable;
- configurar una integración;
- repetir una tarea de navegación o edición con la misma intención.

Una experiencia reusable pasa por:

```text
observed
  -> candidate
  -> validated
  -> active
  -> reinforced | degraded | quarantined | retired
```

`candidate` nunca guía automáticamente una misión. `active` requiere verificación suficiente. Una corrección explícita, fallo repetido o cambio de entorno puede degradar o poner en cuarentena el procedimiento.

La representación procedural mantiene pasos concretos, trigger, scope, dependencias, invariantes, entorno, éxitos, fallos, confianza y última validación. Los selectores frágiles de UI no se tratan como conocimiento universal; se guardan como evidencia contextual que debe revalidarse.

### 4. DiagnosticMemory — problema, causa y solución

La memoria diagnóstica integra, no duplica, el Failure Learning Core existente.

Cada caso enlaza:

```text
síntoma
  -> observaciones
  -> hipótesis
  -> intentos
  -> causa confirmada o probable
  -> solución aplicada
  -> prueba de reparación
  -> regresión
  -> prevención
```

Los intentos fallidos siguen siendo valiosos porque reducen búsquedas futuras. Una solución solo puede convertirse en recomendación automática cuando existe evidencia suficiente y sigue siendo pertinente al entorno actual.

Los casos diagnósticos se vinculan con episodios y procedimientos para que PHOENIX pueda recordar tanto “qué pasó” como “cómo lo solucionó”.

### 5. RelationshipMemory — preferencias y forma de trabajar

Las preferencias del usuario, correcciones de estilo, decisiones recurrentes, formatos y convenciones se mantienen separadas de la historia técnica de PHOENIX.

La recuperación de esta capa sigue la regla de relevancia: una preferencia personal o de trabajo solo se inyecta cuando mejora materialmente la tarea actual.

Preguntas como “¿qué aprendiste?” no deben responderse con una lista de datos personales del usuario. El intent router diferencia entre:

- memoria sobre el usuario;
- aprendizaje conductual de PHOENIX;
- historia de proyectos y misiones;
- procedimientos aprendidos;
- conocimiento semántico;
- casos diagnósticos.

### 6. MetaMemory — qué tan confiable es lo que recuerda

Cada memoria reutilizable obtiene señales de calidad comunes:

```yaml
confidence: 0.0..1.0
importance: 0.0..1.0
confirmations: <integer>
failures: <integer>
corrections: <integer>
last_validated_at: <timestamp|null>
valid_until: <timestamp|null>
environment_fingerprint: <optional>
status: candidate | active | degraded | quarantined | retired
```

La confianza no es decorativa. Participa en recuperación, promoción y aplicación automática.

Una memoria envejecida o dependiente de un entorno cambiante puede seguir apareciendo como evidencia, pero debe revalidarse antes de gobernar acciones relevantes.

### 7. MemoryConsolidator — de experiencias a conocimiento

El consolidator ejecuta trabajo bounded después de una misión o durante momentos seguros de mantenimiento. No reescribe el historial original.

Sus responsabilidades son:

- agrupar episodios similares;
- detectar hechos repetidos;
- proponer procedimientos reusable;
- reforzar procedimientos que vuelven a funcionar;
- degradar los que fallan;
- relacionar síntomas con soluciones;
- detectar contradicciones;
- deduplicar memorias semánticas;
- actualizar metamemoria;
- conservar siempre procedencia y referencias al material original.

La consolidación produce registros nuevos o versiones supersedentes. Nunca borra evidencia histórica silenciosamente.

### 8. MemoryRetriever + HumanExpression — recordar bien y sonar humano

La recuperación empieza por clasificar la intención de memoria antes de buscar.

Ejemplos:

```text
“¿Qué hicimos ayer?”
  -> episodic + temporal + cross-project

“Hazlo como la otra vez”
  -> resolved task reference + episodic + procedural

“¿Cómo arreglaste aquel EPIPE?”
  -> diagnostic + procedural + episodic

“¿Qué aprendiste?”
  -> recent behavioral/procedural/semantic learning
  -> NO perfil personal salvo que la pregunta lo pida
```

El retriever resuelve expresiones temporales a ventanas absolutas usando la zona horaria configurada de PHOENIX y conserva esa resolución como evidencia de la búsqueda.

La capa `HumanExpression` recibe recuerdos ya seleccionados y aplica reglas conversacionales:

- responder primero a la intención del usuario;
- no decir “consulté la memoria”, “cargué el ledger” o equivalentes salvo petición técnica;
- no enumerar categorías internas de memoria en respuestas normales;
- usar expresiones naturales como “Ayer trabajamos en…” o “La última vez ese error terminó siendo…” cuando la evidencia lo respalda;
- reconocer incertidumbre con lenguaje natural y específico;
- no fingir familiaridad cuando no existe evidencia;
- no recitar datos personales para demostrar memoria;
- no confundir instrucciones configuradas con aprendizaje por experiencia;
- mantener la calidez y continuidad sin antropomorfizar estados internos inexistentes.

La expresión humana nunca altera la evidencia almacenada; solo controla cómo se presenta y cuánto se muestra.

## Flujo de aprendizaje por experiencia

El flujo general es:

```text
user intent
  -> turn/session events
  -> observable execution
  -> outcome
  -> episode
  -> verification
  -> consolidation
  -> semantic / procedural / diagnostic candidate
  -> promotion policy
  -> future retrieval
  -> reuse
  -> new evidence
  -> reinforcement or degradation
```

### Ejemplo: aprender a completar una encuesta

Primera ejecución:

```text
abrir sitio
  -> localizar formulario
  -> identificar campos por significado
  -> completar
  -> validar
  -> enviar
  -> confirmar resultado
```

El episodio conserva la misión completa. Si el resultado queda verificado, el consolidator genera o refuerza un procedimiento con scope, trigger, pasos, dependencias y evidencia.

En una ejecución futura, PHOENIX recupera ese procedimiento si el dominio, intención y tarea son suficientemente similares. Antes de ejecutar pasos frágiles, revalida las condiciones que pudieron cambiar.

Si la interfaz cambió, el procedimiento no fuerza selectores antiguos. El fallo queda asociado a la habilidad, reduce su confianza y PHOENIX vuelve a explorar hasta producir una versión nueva validada.

### Ejemplo: aprender a diagnosticar y reparar

```text
síntoma: PHOENIX no inicia
  -> observación
  -> hipótesis A
  -> intento A falla
  -> hipótesis B
  -> causa confirmada
  -> fix
  -> smoke test PASS
  -> restart PASS
  -> regresión PASS
```

La próxima vez que aparezca un síntoma similar, PHOENIX recupera el caso completo. Los intentos fallidos ayudan a descartar rutas; la solución verificada obtiene prioridad solo cuando el entorno sigue siendo compatible.

## Persistencia y continuidad entre sesiones

`RecentTaskLedger` no será la única fuente para referencias recientes. La referencia rápida en memoria se mantiene para el turno actual, pero las tareas significativas se proyectan también a memoria episódica durable.

Al reiniciar PHOENIX o abrir una conversación distinta:

1. la sesión nueva no necesita cargar conversaciones enteras;
2. el retriever puede consultar episodios y procedimientos relevantes;
3. una referencia temporal o semántica activa una búsqueda bounded;
4. solo los recuerdos seleccionados llegan al contexto del modelo;
5. la respuesta se genera sin exponer el mecanismo interno.

## Recuperación automática y presupuesto de contexto

La memoria no se vuelca completa en cada request.

Se mantienen dos rutas:

### Continuidad ligera

Inyección automática de un conjunto pequeño de preferencias, correcciones y procedimientos de alta confianza relacionados con la tarea actual.

### Recuperación dirigida

Cuando la intención exige historia, tiempo, proyectos, diagnóstico o procedimientos, el retriever ejecuta una búsqueda específica con límites de resultados, capas y ventana temporal.

El ranking combina:

- similitud con la tarea;
- proyecto;
- tiempo;
- entidades y relaciones;
- confianza;
- importancia;
- confirmaciones/fallos;
- vigencia;
- evidencia de contradicción;
- afinidad con el entorno actual.

Una búsqueda vacía global no se usa como sustituto de comprender la pregunta.

## Seguridad y privacidad

El sistema aplica redacción de secretos antes de persistir contenido reusable.

No se consolidan automáticamente:

- credenciales;
- tokens;
- secretos privados;
- contenido marcado para olvidar;
- inferencias sensibles no necesarias;
- información de terceros sin justificación operativa;
- hipótesis no verificadas como hechos.

Las acciones aprendidas siguen bajo las mismas políticas de permisos, aprobaciones, sandbox y seguridad del harness. Aprender “cómo hacerlo” no concede permiso para hacerlo.

## Cambios de paquetes previstos

La implementación debe respetar la arquitectura plugin-first de PHOENIX.

### `packages/session-learning/tool-session-learning`

Se conserva como consumidor model-facing y coordinador ligero. Debe dejar de poseer estado efímero que sea necesario para continuidad durable.

Responsabilidades previstas:

- intent-aware memory recall;
- integración con `memory_search`, `memory_remember` y `memory_teach`;
- presentación humana y bounded del recuerdo;
- puente hacia aprendizaje procedural existente.

### `@phoenix-ai/dsh-session-learning` / proveedor de memoria cognitiva

Se ampliará el servicio durable existente en lugar de crear una segunda base de datos incompatible.

Debe soportar:

- episodios;
- relaciones de procedencia;
- consultas temporales;
- consolidación/versionado;
- metamemoria;
- referencias cruzadas entre episodios, procedimientos, fallos y conocimiento semántico.

### Nuevo plugin de consolidación cognitiva

Se recomienda un plugin dedicado, por ejemplo `@phoenix-ai/dsh-memory-consolidator`, para mantener la lógica de consolidación fuera del tool plugin.

Consume eventos durables y el servicio de memoria; produce nuevas memorias y actualizaciones versionadas. No escribe prompts directamente.

### Integración con Failure Learning Core

Cognitive Memory v2 enlaza casos diagnósticos con la memoria de fallos existente. No introduce un ledger paralelo de errores.

## Eventos y reconstrucción

Los hechos que alimentan memoria model-visible deben derivarse de eventos durables ya existentes o de nuevos eventos del dominio de memoria.

Si se añaden eventos, deben describir hechos, no prompts derivados. Ejemplos posibles:

```text
memory/episode-recorded
memory/consolidated
memory/procedure-promoted
memory/procedure-degraded
memory/knowledge-superseded
```

Los payloads incluyen IDs opacos y referencias, no textos secretos ni contexto ilimitado.

## Política de promoción

### Procedimiento guiado explícitamente por el usuario

Puede entrar `active` con alta confianza cuando la instrucción es clara y segura, conservando su origen `guided`.

### Procedimiento aprendido por experiencia

Primera observación sin verificación: `candidate`.

Resultado verificado y evidence-backed: puede promoverse según la política actual y el riesgo de la acción.

Repeticiones exitosas: aumentan confirmaciones y confianza.

Fallos: reducen confianza y pueden activar `degraded` o `quarantined`.

Corrección explícita del usuario: cuarentena inmediata de la versión afectada hasta nueva evidencia.

Acciones de alto riesgo no ganan permisos por promoción de memoria.

## Comportamiento humano esperado

La memoria debe mejorar la sensación de continuidad sin convertir a PHOENIX en un narrador de arquitectura.

### Correcto

> Ayer trabajamos principalmente en la memoria de Phoenix, HARDNESS, los conectores y los agentes de KIRA. En memoria, lo más importante fue que empezamos a enseñar a Phoenix a aplicar correcciones y procedimientos sin tener que pedírselo cada vez.

### Incorrecto

> Consulté EpisodicMemory, SemanticMemory y ProceduralMemory. Cargué 8 registros con confianza mayor de 0.85 y ejecuté el MemoryRetriever.

### Correcto ante incertidumbre

> Recuerdo el trabajo del updater y los agentes de KIRA, pero no tengo evidencia suficiente para afirmar que el cambio de conectores quedó terminado ese día.

### Incorrecto ante incertidumbre

> No hicimos ningún proyecto.

La ausencia de evidencia para un detalle no permite negar actividad cuando existen episodios que demuestran trabajo relacionado.

## Pruebas requeridas

### Persistencia y recuperación

- Registrar una misión, recrear el servicio y recuperarla en una sesión nueva.
- Registrar varias misiones en proyectos distintos y recuperar “ayer” cross-project.
- Resolver expresiones temporales a la ventana correcta.
- Evitar que `RecentTaskLedger` efímero sea la única evidencia de una referencia previa.

### Aprendizaje procedural

- Experiencia no verificada permanece candidata.
- Experiencia verificada se promueve conforme a la política.
- Repeticiones exitosas refuerzan la habilidad.
- Fallo posterior degrada la confianza.
- Corrección del usuario pone en cuarentena la versión aplicable.
- Un procedimiento no relacionado no entra al contexto.

### Consolidación semántica

- Duplicados se fusionan sin perder procedencia.
- Contradicciones producen versiones relacionadas, no overwrite silencioso.
- Recuerdo superseded solo aparece cuando se solicita historia.

### Diagnóstico

- Un fallo conocido recupera causa y solución verificadas.
- Intentos fallidos previos no se presentan como soluciones.
- Cambio de entorno fuerza revalidación cuando aplica.

### Humanidad

Snapshots keyless deben demostrar que:

- “¿qué hicimos ayer?” responde con proyectos reales sin exponer categorías internas;
- “¿qué aprendiste?” diferencia aprendizaje de instrucciones configuradas;
- “hazlo como la otra vez” recupera procedimiento y ejecuta sin preguntar categorías de memoria;
- una respuesta normal no contiene `ledger`, `retriever`, `procedural state`, `confidence=...` ni nombres de archivos internos salvo petición técnica;
- los datos personales no se enumeran para demostrar memoria;
- incertidumbre se expresa naturalmente y sin negar hechos soportados.

### Seguridad

- secretos se redactan antes de persistencia reusable;
- contenido olvidado no reaparece;
- procedimientos aprendidos no elevan permisos;
- recuerdos candidatos o en cuarentena no guían ejecución automática;
- datos no relacionados no se filtran entre proyectos sin intención cross-project válida.

## Métricas

- porcentaje de referencias previas resueltas correctamente;
- exactitud temporal de recuerdos;
- procedimientos reaplicados con éxito;
- procedimientos degradados antes de causar fallos repetidos;
- falsos recuerdos o atribuciones incorrectas;
- preguntas de aclaración evitadas gracias a memoria válida;
- tokens de contexto consumidos por memoria;
- frecuencia de exposición accidental de plumbing interno;
- tasa de correcciones del usuario sobre recuerdos;
- tiempo hasta recuperar una solución diagnóstica conocida.

## Criterios de aceptación

1. Una misión relevante queda disponible después de reiniciar PHOENIX y abrir otra conversación.
2. “¿Qué hicimos ayer?” consulta episodios por tiempo y no depende del historial visible del chat.
3. PHOENIX aprende procedimientos de ejecuciones verificadas y puede reutilizarlos en tareas similares.
4. Una ejecución fallida se recuerda como experiencia sin convertirse en habilidad activa.
5. Procedimientos repetidamente exitosos se refuerzan; fallos y correcciones degradan o ponen en cuarentena versiones obsoletas.
6. Casos diagnósticos vinculan síntomas, intentos, causa, solución y verificación sin duplicar el Failure Learning Core.
7. La recuperación distingue perfil del usuario, historia de proyectos, aprendizaje conductual, conocimiento y procedimientos.
8. La memoria automática permanece bounded y relevante.
9. La expresión conversacional no expone nombres de subsistemas, prompts, tool plumbing, rutas internas o categorías de memoria salvo petición técnica.
10. PHOENIX mantiene una voz cálida, natural y orientada a la tarea aun cuando use memoria compleja por debajo.
11. Las nuevas rutas cuentan con pruebas unitarias, integración y snapshots keyless de comportamiento real.
12. Las verificaciones focales, typecheck y gates documentales de los paquetes afectados pasan antes de integrar el cambio.

## Fuera de alcance

Cognitive Memory v2 no entrena pesos, no crea permisos nuevos, no sustituye sandbox o aprobaciones, no convierte todo transcript en contexto automático, no memoriza secretos por conveniencia y no obliga a PHOENIX a fingir emociones o conciencia.

Su objetivo es más concreto: que PHOENIX tenga continuidad verificable, aprenda de lo que realmente hace, reutilice experiencia correcta, corrija conocimiento obsoleto y converse con la naturalidad de alguien que recuerda el trabajo compartido sin recitar su maquinaria interna.
