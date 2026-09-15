# PHOENIX Cognitive Memory v2

## Objetivo

Convertir la memoria actual de PHOENIX en un sistema cognitivo persistente que recuerde experiencias, consolide conocimiento, aprenda procedimientos a partir de resultados verificados, reutilice soluciones diagnósticas, gestione incertidumbre y mantenga una conversación humana sin narrar su infraestructura interna.

El sistema no modifica los pesos del modelo. Aprende mediante memoria durable, eventos, evidencia, procedimientos, relaciones, consolidación y recuperación contextual.

## Principios

1. **La experiencia produce evidencia, no verdad automática.** Ejecutar algo una vez no basta para convertirlo en regla.
2. **Recordar y aprender son procesos distintos.** Un episodio puede conservarse aunque termine mal; una habilidad reusable solo se promueve cuando existe evidencia suficiente.
3. **La memoria sirve al trabajo.** PHOENIX aplica recuerdos relevantes silenciosamente y explica el mecanismo interno solo cuando el usuario lo pide.
4. **La expresión humana está separada del almacenamiento.** La memoria puede guardar estados, confianza, fallos y evidencia; la respuesta final los traduce a lenguaje natural sin volcar etiquetas técnicas.
5. **La recuperación entiende intención, tiempo, proyecto, similitud y relaciones.** “Ayer”, “la otra vez”, “el último proyecto” y “cómo arreglaste eso” deben resolverse sin depender de que el chat previo siga abierto.
6. **Los recuerdos evolucionan.** Pueden reforzarse, degradarse, ponerse en cuarentena, supersederse o retirarse.
7. **Lo visible al modelo sigue siendo reconstruible desde hechos durables.** Cognitive Memory v2 respeta la regla model-visible/logged de PHOENIX.

## Base existente que se conserva

`@phoenix-ai/dsh-tool-session-learning` ya aporta `memory_search`, `memory_remember`, `memory_teach`, curación autónoma, aprendizaje adaptativo, aprendizaje procedural, contexto reciente y recomendaciones de procedimientos verificados.

`ProceduralLearningEngine` ya distingue aprendizaje guiado y por experiencia, usa estados `candidate`, `active` y `quarantined`, y conserva confirmaciones, fallos, correcciones, confianza y huellas de tarea.

Cognitive Memory v2 no reemplaza esas capacidades. Añade persistencia episódica, consolidación semántica, memoria diagnóstica enlazada, metamemoria, recuperación temporal y una capa explícita de expresión humana.

## Arquitectura

### EpisodicMemory — qué vivió PHOENIX

Cada misión significativa produce un episodio durable basado en eventos reales.

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

Los episodios se derivan de eventos de sesión, objetivos, herramientas, resultados y evidencia de finalización. No se reconstruyen desde recencia de commits ni desde descripciones inventadas después de los hechos.

Esta capa responde preguntas como “¿qué hicimos ayer?”, “¿qué proyecto trabajamos la semana pasada?”, “¿qué aprendiste de eso?” y “continúa lo anterior”.

### SemanticMemory — qué sabe PHOENIX

La memoria semántica consolida hechos y relaciones estables extraídos de episodios, correcciones y fuentes confiables.

Cada registro conserva proposición normalizada, entidades, relaciones, scope, evidencia favorable y contradictoria, confianza, fecha de validación, procedencia y estado `active`, `superseded`, `obsolete` o `forgotten`.

El consolidator deduplica conocimiento repetido. Una contradicción nunca sobrescribe silenciosamente una versión anterior; mantiene ambas procedencias y marca cuál supersede a cuál cuando la evidencia lo justifica.

### ProceduralMemory — cómo sabe hacerlo

El motor procedural existente sigue siendo la base.

Cognitive Memory v2 conecta episodios verificados con ese motor para que secuencias repetibles puedan convertirse en procedimientos.

Ejemplos: completar una encuesta, diagnosticar un fallo de arranque, configurar una integración o repetir una tarea de navegación con la misma intención.

El ciclo persistente es:

```text
observed
  -> candidate
  -> active
  -> reinforced | degraded | quarantined | retired
```

La validación es evidencia, no un estado persistente aparte. `candidate` no guía automáticamente una misión. Una experiencia pasa a `active` solo cuando la política de promoción considera suficiente la evidencia. Éxitos posteriores la refuerzan; fallos, cambios de entorno o correcciones explícitas reducen confianza o la ponen en cuarentena.

Cada procedimiento conserva trigger, scope, pasos, dependencias, invariantes, fingerprint de entorno, éxitos, fallos, confianza, última validación y referencias a episodios que lo respaldan.

Los selectores frágiles de UI se guardan como evidencia contextual y deben revalidarse; no se tratan como conocimiento universal.

### DiagnosticMemory — problema, causa y solución

Cognitive Memory v2 integra el Failure Learning Core existente en vez de crear un ledger paralelo.

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

Los intentos fallidos permanecen como evidencia útil para descartar rutas futuras. Solo soluciones verificadas y vigentes pueden obtener prioridad automática.

Los casos diagnósticos enlazan episodios y procedimientos para que PHOENIX recuerde tanto qué ocurrió como cómo lo solucionó.

### RelationshipMemory — cómo trabaja con el usuario

Preferencias, correcciones de estilo, decisiones recurrentes, formatos y convenciones se mantienen separadas de la historia técnica de PHOENIX.

La recuperación aplica relevancia estricta. “¿Qué aprendiste?” no debe responderse con una lista de datos personales.

El intent router distingue entre memoria del usuario, aprendizaje conductual de PHOENIX, historia de proyectos, procedimientos aprendidos, conocimiento semántico y casos diagnósticos.

### MetaMemory — qué tan confiable es lo recordado

Las memorias reutilizables comparten señales de calidad:

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

La confianza participa en ranking, promoción y aplicación automática. Una memoria vieja o dependiente de un entorno cambiante puede seguir apareciendo como evidencia, pero debe revalidarse antes de gobernar acciones importantes.

### MemoryConsolidator — de experiencias a conocimiento

Un plugin dedicado consolida memoria después de una misión o durante mantenimiento seguro. Nunca reescribe el episodio original.

Responsabilidades:

- agrupar episodios similares;
- detectar hechos repetidos;
- proponer procedimientos reutilizables;
- reforzar procedimientos que vuelven a funcionar;
- degradar los que fallan;
- relacionar síntomas con soluciones;
- detectar contradicciones;
- deduplicar memoria semántica;
- actualizar metamemoria;
- mantener procedencia completa.

La consolidación crea registros nuevos o versiones supersedentes. Nunca elimina evidencia histórica silenciosamente.

### MemoryRetriever + HumanExpression — recordar bien y sonar humano

La recuperación clasifica primero la intención.

```text
“¿Qué hicimos ayer?”
  -> episodic + temporal + cross-project

“Hazlo como la otra vez”
  -> task reference + episodic + procedural

“¿Cómo arreglaste aquel EPIPE?”
  -> diagnostic + procedural + episodic

“¿Qué aprendiste?”
  -> recent behavioral/procedural/semantic learning
  -> no perfil personal salvo que la pregunta lo pida
```

El retriever resuelve expresiones temporales a ventanas absolutas usando la zona horaria configurada y conserva esa resolución como parte de la evidencia de búsqueda.

`HumanExpression` recibe recuerdos ya seleccionados y controla la presentación:

- responde primero a la intención del usuario;
- no dice “consulté la memoria”, “cargué el ledger” o equivalentes en una respuesta normal;
- no enumera categorías internas de memoria;
- usa frases naturales como “Ayer trabajamos en…” cuando hay evidencia;
- expresa incertidumbre de forma concreta y humana;
- no finge familiaridad cuando la evidencia falta;
- no recita datos personales para demostrar memoria;
- no presenta instrucciones configuradas como aprendizaje por experiencia;
- mantiene calidez y continuidad sin fingir emociones o conciencia.

La capa humana no modifica la evidencia almacenada; solo decide cómo y cuánto mostrar.

## Aprendizaje por experiencia

```text
user intent
  -> durable session events
  -> observable execution
  -> outcome
  -> episode
  -> verification evidence
  -> consolidation
  -> semantic/procedural/diagnostic candidate
  -> promotion policy
  -> future retrieval
  -> reuse
  -> new evidence
  -> reinforcement or degradation
```

### Ejemplo: aprender una encuesta

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

El episodio conserva la misión. Si el resultado queda verificado, el consolidator genera o refuerza un procedimiento con scope, trigger, pasos, dependencias y evidencia.

En una ejecución futura PHOENIX recupera ese procedimiento cuando intención, dominio y tarea son suficientemente similares. Antes de reutilizar detalles frágiles, revalida las condiciones que pudieron cambiar.

Si la interfaz cambió, no fuerza selectores antiguos. El fallo queda asociado a la habilidad, reduce su confianza y activa nueva exploración hasta obtener otra versión validada.

### Ejemplo: aprender un diagnóstico

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

La siguiente vez, PHOENIX recupera el caso completo. Los intentos fallidos ayudan a evitar callejones conocidos; la solución verificada obtiene prioridad solo si el entorno sigue siendo compatible.

## Persistencia y continuidad entre sesiones

`RecentTaskLedger` se mantiene como ayuda rápida para el turno vivo, pero deja de ser la única fuente de referencias recientes. Las misiones significativas se proyectan también a memoria episódica durable.

Después de reiniciar PHOENIX o abrir otra conversación:

1. la nueva sesión no necesita cargar conversaciones enteras;
2. el retriever consulta episodios y procedimientos relevantes;
3. referencias temporales o semánticas activan búsquedas bounded;
4. solo memoria seleccionada llega al contexto del modelo;
5. la respuesta se genera sin exponer el mecanismo interno.

## Presupuesto de contexto

No se vuelca toda la memoria en cada request.

La continuidad ligera inyecta solo preferencias, correcciones y procedimientos de alta confianza relacionados con la tarea.

La recuperación dirigida se activa para historia, tiempo, proyectos, diagnóstico o procedimientos. El ranking combina similitud, proyecto, tiempo, entidades, relaciones, confianza, importancia, confirmaciones, fallos, vigencia, contradicciones y afinidad con el entorno.

Una búsqueda global vacía no sustituye comprender la pregunta.

## Seguridad y privacidad

La memoria reusable redacta secretos antes de persistir.

No se consolidan automáticamente credenciales, tokens, secretos privados, contenido marcado para olvidar, inferencias sensibles innecesarias, información de terceros sin justificación operativa ni hipótesis no verificadas como hechos.

Aprender un procedimiento no concede permiso para ejecutarlo. Sandbox, permisos, aprobaciones y políticas siguen gobernando las acciones.

## Cambios de paquetes previstos

### `packages/session-learning/tool-session-learning`

Se conserva como consumidor model-facing y coordinador ligero. Debe dejar de poseer estado efímero cuando ese estado sea necesario para continuidad durable.

Responsabilidades: intent-aware recall, herramientas de memoria, presentación humana bounded y puente hacia aprendizaje procedural.

### Proveedor `@phoenix-ai/dsh-session-learning`

Se amplía el servicio durable existente en lugar de crear una segunda base incompatible.

Debe soportar episodios, consultas temporales, relaciones de procedencia, consolidación/versionado, metamemoria y referencias cruzadas entre episodios, procedimientos, fallos y conocimiento semántico.

### Nuevo `@phoenix-ai/dsh-memory-consolidator`

Plugin dedicado a convertir evidencia durable en conocimiento consolidado. Consume eventos y el servicio de memoria; produce nuevas memorias o versiones. No escribe prompts directamente.

### Failure Learning Core

Los casos diagnósticos se enlazan con la memoria de fallos existente. No se crea un segundo registro de errores.

## Eventos y reconstrucción

Los hechos que alimentan memoria model-visible deben derivarse de eventos durables existentes o de nuevos eventos propios de memoria.

Posibles eventos:

```text
memory/episode-recorded
memory/consolidated
memory/procedure-promoted
memory/procedure-degraded
memory/knowledge-superseded
```

Los payloads contienen IDs opacos y referencias bounded, no contexto ilimitado ni secretos.

## Política de promoción

Un procedimiento enseñado explícitamente por el usuario puede entrar `active` con alta confianza cuando la instrucción es clara y segura, conservando origen `guided`.

Una experiencia observada comienza como `candidate`. Con evidencia verificada suficiente puede pasar a `active`. Repeticiones exitosas aumentan confirmaciones y confianza. Fallos reducen confianza y pueden producir `degraded` o `quarantined`. Una corrección explícita del usuario pone en cuarentena la versión afectada hasta nueva evidencia.

Las acciones de alto riesgo nunca ganan permisos por promoción de memoria.

## Comportamiento humano esperado

Correcto:

> Ayer trabajamos principalmente en la memoria de Phoenix, HARDNESS, los conectores y los agentes de KIRA. En memoria, lo más importante fue que empezamos a enseñar a Phoenix a aplicar correcciones y procedimientos sin tener que pedírselo cada vez.

Incorrecto:

> Consulté EpisodicMemory, SemanticMemory y ProceduralMemory. Cargué ocho registros y ejecuté MemoryRetriever.

Correcto ante incertidumbre:

> Recuerdo el trabajo del updater y los agentes de KIRA, pero no tengo evidencia suficiente para afirmar que el cambio de conectores quedó terminado ese día.

La falta de evidencia para un detalle no permite negar actividad cuando otros episodios prueban que sí hubo trabajo.

## Pruebas requeridas

### Persistencia y recuperación

- registrar una misión, recrear el servicio y recuperarla en una sesión nueva;
- recuperar “ayer” en varios proyectos;
- resolver ventanas temporales correctamente;
- probar que una referencia previa sobrevive aunque desaparezca `RecentTaskLedger`.

### Procedimientos

- experiencia no verificada permanece `candidate`;
- evidencia verificada suficiente permite `active`;
- éxitos repetidos refuerzan la habilidad;
- fallo posterior degrada confianza;
- corrección explícita pone en cuarentena la versión afectada;
- procedimientos no relacionados no entran al contexto.

### Semántica y diagnóstico

- duplicados se consolidan sin perder procedencia;
- contradicciones crean versiones relacionadas;
- recuerdos superseded solo aparecen cuando se solicita historia;
- fallos conocidos recuperan causa y solución verificadas;
- intentos fallidos no se presentan como soluciones;
- cambios de entorno fuerzan revalidación cuando corresponde.

### Humanidad

Snapshots keyless deben demostrar que:

- “¿qué hicimos ayer?” devuelve proyectos reales sin exponer categorías internas;
- “¿qué aprendiste?” diferencia aprendizaje de instrucciones configuradas;
- “hazlo como la otra vez” recupera el procedimiento sin preguntar qué memoria usar;
- respuestas normales no contienen nombres de archivos, stores, `ledger`, `retriever`, estados internos o plumbing salvo petición técnica;
- datos personales no se enumeran para demostrar memoria;
- incertidumbre se expresa naturalmente sin negar hechos soportados.

### Seguridad

- secretos se redactan antes de persistencia reusable;
- contenido olvidado no reaparece;
- procedimientos aprendidos no elevan permisos;
- candidatos y cuarentenas no guían ejecución automática;
- datos no relacionados no cruzan proyectos sin intención cross-project válida.

## Criterios de aceptación

1. Una misión relevante se recupera después de reiniciar PHOENIX y abrir otra conversación.
2. “¿Qué hicimos ayer?” usa memoria episódica temporal y no depende del chat visible.
3. PHOENIX aprende procedimientos de ejecuciones verificadas y los reutiliza en tareas similares.
4. Una ejecución fallida se recuerda como experiencia sin convertirse en habilidad activa.
5. Éxitos refuerzan procedimientos; fallos y correcciones degradan o ponen en cuarentena versiones obsoletas.
6. Los casos diagnósticos conectan síntomas, intentos, causa, solución y verificación sin duplicar Failure Learning Core.
7. La recuperación diferencia perfil del usuario, proyectos, aprendizaje conductual, conocimiento y procedimientos.
8. La memoria automática permanece bounded y relevante.
9. Las respuestas normales no exponen subsistemas, prompts, tool plumbing, rutas internas ni categorías de memoria salvo petición técnica.
10. PHOENIX mantiene una voz cálida, natural y orientada a la tarea mientras usa memoria compleja por debajo.
11. Las nuevas rutas tienen pruebas unitarias, integración y snapshots keyless de comportamiento real.
12. Las verificaciones focales, typecheck y gates documentales de los paquetes afectados pasan antes de integrar el cambio.

## Fuera de alcance

Cognitive Memory v2 no entrena pesos, no crea permisos nuevos, no sustituye sandbox o aprobaciones, no convierte el transcript completo en contexto automático, no memoriza secretos por conveniencia y no obliga a PHOENIX a fingir emociones o conciencia.

Su objetivo es que PHOENIX tenga continuidad verificable, aprenda de lo que realmente hace, reutilice experiencia correcta, corrija conocimiento obsoleto y converse con la naturalidad de alguien que recuerda el trabajo compartido sin recitar su maquinaria interna.
