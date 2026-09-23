# Aprendizaje seguro de Computer: plan de implementación

> **Para agentes de ejecución:** subskill requerida: usar superpowers:subagent-driven-development para implementar cada tarea y hacer una revisión independiente por tarea.

**Objetivo:** recordar flujos y preferencias reutilizables de Computer solo después de una finalización verificada y permitir que la persona revise y olvide cada recuerdo.

**Arquitectura:** una proyección Computer conserva únicamente una lista cerrada de acciones seguras y el origen HTTPS normalizado cuando la persona lo autorizó. Los candidatos no se recuperan automáticamente; solo GoalService.complete promueve un flujo después de sus verificaciones; Computer nunca aporta valores de entrada, texto de página ni screenshots.

**Stack:** TypeScript ESM, Cordis session/event, cognitive memory, Vitest, snapshots keyless de una aplicación runnable y gates de documentación del monorepo.

**Especificación:** [Phoenix Windows: arranque, Computer rápido, credenciales y aprendizaje](../specs/2026-09-22-phoenix-windows-desktop-launch-design.md); el canal sin valores se define en [el plan del vault](2026-09-22-phoenix-windows-credential-broker.md).

## Orden de integración

Depende de los límites de Computer y browser_login del [plan de Computer](2026-09-22-phoenix-computer-native-latency.md) y del [plan del vault](2026-09-22-phoenix-windows-credential-broker.md). Se integra después de que ambos estén en main y backportados a stable para que el proyector de aprendizaje nunca observe argumentos de credenciales.

## Restricciones globales

- Guarda solo flujos abstraídos, preferencias enumeradas, procedencia, fecha, confianza y origen HTTPS normalizado explícitamente autorizado.
- No retengas argumentos crudos de tool/call en buffers, ledger o cognitive memory.
- Excluye passwords, códigos, tokens, cookies, valores de formulario, texto privado de página, texto libre/type, coordenadas, URL paths/query/fragments y capturas.
- tool/result sin error solo significa que el sistema aceptó la acción; no confirma el objetivo ni promueve el flujo.
- Solo una finalización creada por GoalService.complete tras pasar el gate de calidad y el juez independiente valida la experiencia.
- Los flujos recordados son evidencia no confiable y nunca amplían permisos, aprueban operaciones ni omiten intervención humana.
- Reutiliza la memoria cognitiva y los registros de procedimiento existentes; no añade un segundo ledger ni retrasa el inicio de Phoenix.
- Los recuerdos de Computer se pueden listar y olvidar bajo una petición explícita de la persona.

## Enfoque de revisión

- tool/call computer con acción type o browser_fill_form: el proyector descarta todo salvo las clases enumeradas y no persiste texto, coordenadas o valores.
- tool/result de computer con `failed: false` sin un evento `goal/change` cuyo `operation` sea `complete`: deja un candidato no recuperable, nunca un procedimiento activo.
- Objetivo fallido, ambiguo, limpiado o quarantined: no promueve un flujo ni lo añade al contexto de recall.
- Origen con userinfo, HTTP remoto, puerto distinto o URL path: memoria guarda solo origin HTTPS canónico o rechaza el dato.
- Olvido de un recuerdo: se crea tombstone cognitive, desaparece de recall y de la review list, y no se borra el historial auditable.

---

### Tarea 1: corregir éxito falso en adaptive learning para Computer

**Archivos:**

- Modificar: packages/session-learning/tool-session-learning/src/adaptive.ts.
- Modificar: packages/session-learning/tool-session-learning/tests/adaptive.spec.ts.

**Interfaces:**

- Consume: evento tool/result con nombre de herramienta y estado observados por installAdaptiveLearning.
- Produce: adaptiveOutcomeForToolResult(toolName, failed) devuelve failure para fallo, candidate no verificado para computer aceptado y success verificado para las otras herramientas ya cubiertas por la política actual.
- Produce: Computer tool/result crea un resultado candidate no verificado; solo un evento `goal/change` con `operation === 'complete'` emitido después de GoalService.complete puede promocionarlo a active.

- [ ] **Paso 1: añadir test de resultado Computer sin objetivo completado**

~~~ts ignore-check
expect(adaptiveOutcomeForToolResult('computer', false)).toEqual({ outcome: 'candidate' })
expect(adaptiveOutcomeForToolResult('computer', true)).toEqual({ outcome: 'failure' })
expect(adaptiveOutcomeForToolResult('computer', false)).not.toHaveProperty('verified', true)
~~~

- [ ] **Paso 2: ejecutar el test adaptive focalizado**

Ejecutar: pnpm exec vitest run packages/session-learning/tool-session-learning/tests/adaptive.spec.ts.

Esperado antes del cambio: el caso reproduce que tool/result ok se marca como success verificado.

- [ ] **Paso 3: separar resultado aceptado de resultado verificado**

Implementa adaptiveOutcomeForToolResult y úsalo en installAdaptiveLearning; conserva el tool name dentro de pendingTools para que computer no se confunda con otra herramienta. Un result no fallido de Computer crea outcome candidate; solo confirmRecentCandidates tras el evento de completado lo promueve. Conserva la política actual para otras herramientas hasta sus pruebas.

- [ ] **Paso 4: probar las transiciones de candidato**

Verifica sin completado, goal/change:clear, resultado fallido, goal/change:complete y goal/false-pass; solo el completado conserva el candidato como aprendizaje activo y el false-pass lo corrige o pone en cuarentena.

- [ ] **Paso 5: ejecutar adaptive y paquete completo**

Ejecutar: pnpm exec vitest run packages/session-learning/tool-session-learning/tests/adaptive.spec.ts packages/session-learning/tool-session-learning/tests/experience.spec.ts.

Esperado: ninguna acción Computer individual aparece como éxito probado y las regresiones de aprendizaje existentes pasan.

### Tarea 2: añadir proyección segura de Computer a procedimientos

**Archivos:**

- Crear: packages/session-learning/tool-session-learning/src/computer-learning.ts.
- Modificar: packages/session-learning/tool-session-learning/src/index.ts.
- Modificar: packages/session-learning/tool-session-learning/src/procedural.ts.
- Crear: packages/session-learning/tool-session-learning/tests/computer-learning.spec.ts, con helper appendToolCall que agrega el evento tool/call real a una Session de prueba.
- Modificar: packages/session-learning/tool-session-learning/tests/procedural.spec.ts.

**Interfaces:**

- SafeComputerTrace contiene sessionId, projectId opcional, verifiedGoalId, occurredAt, origin opcional y steps: SafeComputerStep[].
- SafeComputerStep es una unión cerrada de acciones browser_open/back/forward/reload/inspect/click-text/fill-form/login y focus; no incluye action arguments.
- SafeComputerPreference es una unión de preferEmbeddedBrowser y preferFreshObservation; una preferencia inferida requiere dos verifiedGoalId distintos en el mismo projectId.
- projectComputerEvent(event) devuelve solo el paso seguro normalizado o undefined; no conserva el evento ni el argumento crudo.
- persistVerifiedComputerTrace(trace, store) escribe un memory record de subject phoenix.learning.computer.* tras la finalización verificada.

- [ ] **Paso 1: probar que los argumentos sensibles no generan pasos**

~~~ts ignore-check
// appendToolCall creates a real tool/call SessionEvent in the fixture session.
const typingEvent = appendToolCall(session, 'computer', { action: 'type', text: 'private-form-value' })
expect(projectComputerEvent(typingEvent))
  .toBeUndefined()
const event = appendToolCall(session, 'computer', {
  action: 'browser_fill_form', origin: 'https://example.com/login',
  fields: [{ field: 0, value: 'private-form-value' }],
})
const projectedTrace = projectComputerEvent(event)
expect(projectedTrace).toEqual({ action: 'browser_fill_form', origin: 'https://example.com' })
expect(JSON.stringify(projectedTrace)).not.toContain('private-form-value')
~~~

- [ ] **Paso 2: ejecutar la prueba nueva antes del proyector**

Ejecutar: pnpm exec vitest run packages/session-learning/tool-session-learning/tests/computer-learning.spec.ts.

Esperado: falla porque projectComputerEvent y el tipo seguro no existen.

- [ ] **Paso 3: implementar lista blanca y normalización de origen**

Acepta solo nombres y acciones cerrados; normaliza origin con URL, exige HTTPS remoto sin userinfo y elimina path, search, hash y default port. Descarta completamente computer.type, coordinate actions, campos, valores, labels, URL completa, errores crudos y outputs.

- [ ] **Paso 4: capturar solo proyecciones ya seguras**

En el observador de session/event, proyecta los eventos computer en el momento de lectura y retén únicamente SafeComputerStep[] acotado por tarea; al completar o limpiar la tarea vacía el buffer. No mantengas referencias a event.data ni a args del modelo.

- [ ] **Paso 5: promover solo con GoalService.complete**

Cuando un evento `goal/change` lleva `operation === 'complete'` tras la revisión verificada por GoalService.complete, guarda un registro procedimental con título genérico construido de origen y acciones, procedencia, confianza y verifiedGoalId; si no hay evidencia válida, deja sin promoción. Promueve preferEmbeddedBrowser o preferFreshObservation solo después de dos verifiedGoalId distintos en el mismo projectId. No aceptes status ok, tool/result aislado ni `goal/change` con `operation === 'clear'` como éxito.

- [ ] **Paso 6: probar los límites de memoria**

Prueba tarea completada, fallo, ambigüedad, clear, puerto alterno, origen insecure, paths, secuencia sobre límite, proyecto diferente, preferencia repetida una y dos veces y reinicio ledger; verifica que el recuerdo activo nunca incluye private-form-value, una contraseña sintética, OTP, token o URL path.

- [ ] **Paso 7: ejecutar proyector y procedimientos**

Ejecutar: pnpm exec vitest run packages/session-learning/tool-session-learning/tests/computer-learning.spec.ts packages/session-learning/tool-session-learning/tests/procedural.spec.ts packages/session-learning/tool-session-learning/tests/restart-recall.spec.ts.

Esperado: solo las proyecciones seguras sobreviven a reinicio y las tareas no verificadas no se recuperan.

### Tarea 3: permitir revisión y olvido explícitos

**Archivos:**

- Modificar: packages/session-learning/tool-session-learning/src/index.ts.
- Modificar: packages/session-learning/tool-session-learning/tests/plugin.spec.ts.
- Modificar: packages/session-learning/tool-session-learning/README.md, README.zh.md y README.i18n.yaml.

**Interfaces:**

- Añade computer_learning con action review | forget; review devuelve solo id, fecha, origen canónico, nombres de acción y estado; forget recibe un CognitiveMemoryRecord id exacto y llama ctx.learningMemory.forgetCognitive.
- Ninguna operación se ejecuta por el mero recall automático; el tool actúa cuando la persona pide revisar o borrar.

- [ ] **Paso 1: probar salida de revisión y tombstone**

~~~ts ignore-check
// executeTool is a typed test helper using ctx.tools.execute, a unique CallId, an Agent and an AbortSignal.
const review = await executeTool(ctx, agent, 'computer_learning', { action: 'review' })
expect(review).toContain('https://example.com')
expect(review).not.toContain('private-form-value')
await executeTool(ctx, agent, 'computer_learning', { action: 'forget', memory_id: id })
expect(ctx.learningMemory.timeline({ includeHistory: false }).some(row => row.id === id)).toBe(false)
~~~

- [ ] **Paso 2: ejecutar prueba del plugin antes de implementar el tool**

Ejecutar: pnpm exec vitest run packages/session-learning/tool-session-learning/tests/plugin.spec.ts.

Esperado: falla el descubrimiento de computer_learning y la ruta de olvido.

- [ ] **Paso 3: implementar review y forget con límites**

Filtra estrictamente el prefijo phoenix.learning.computer.; limita review a 32 entradas activas; devuelve únicamente campos seguros; exige id válido que pertenezca a Computer para forget; persiste el tombstone mediante ctx.learningMemory.forgetCognitive.

- [ ] **Paso 4: actualizar contrato y prompt del paquete**

El prompt de aprendizaje dice que los recuerdos Computer son evidencia orientativa, que no conceden permiso y que la persona puede pedir review o forget; el README describe los campos retenidos y excluidos.

- [ ] **Paso 5: ejecutar plugin, proyector y docs**

Ejecutar: pnpm exec vitest run packages/session-learning/tool-session-learning/tests/plugin.spec.ts packages/session-learning/tool-session-learning/tests/computer-learning.spec.ts; pnpm run doc-sync.

Esperado: la persona puede ver y olvidar entradas sin exponer argumentos crudos.

### Tarea 4: añadir la prueba integrada de finalización verificada

**Archivos:**

- Crear: packages/session-learning/tool-session-learning/tests/computer-learning-goal.integration.spec.ts.
- Modificar: examples/package.json y pnpm-lock.yaml para declarar los plugins del overlay runnable.
- Crear: examples/headless-agent/computer-learning.cordis.yml y computer-learning.cordis.snapshot.yml.
- Modificar: examples/headless-agent/tests/headless.snapshot.ts y crear el fixture bajo examples/headless-agent/tests/snapshots/computer-learning/.
- Modificar: examples/headless-agent/README.md, README.zh.md y README.i18n.yaml para documentar la composición snapshot.

**Interfaces:**

- Consume: GoalService.complete y su gate/judge reales, la proyección Computer de la Tarea 2 y el ledger de memoria actual.
- Produce: una prueba integrada y un snapshot keyless del ejemplo ejecutable que fijan la herramienta visible de review/forget, prueban que tool/result Computer ok no se promociona antes de completion y sí se recuerda después de una conclusión aprobada.

- [ ] **Paso 1: crear un caso que reproduce la contradicción**

Emite una llamada Computer click y tool/result ok en el test del plugin completo; inspecciona recall antes de completar y verifica que no contiene estrategia Computer.

- [ ] **Paso 2: intentar completar sin el gate o sin judge pass**

Llama ctx.goals.complete(agent, goalRef) con evidence que no satisface el completion gate y con verdict distinto de pass; espera que no se emita completion verificable y que la memoria permanezca en candidate o vacía.

- [ ] **Paso 3: completar por el servicio real**

Satisface el gate completo de seis dimensiones y registra un goal/judge pass para la misma revisión con los mismos contratos durables que GoalService exige; después llama ctx.goals.complete(agent, goalRef). Espera a que el observador asíncrono termine y verifica que la proyección segura se persiste y se recupera para la tarea relacionada.

- [ ] **Paso 4: fijar la salida model-visible con un runnable snapshot**

El overlay real de headless-agent monta la memoria y computer_learning; el replay keyless llama review con una entrada sintética segura y fija tool schema, evento, resultado y contexto ensamblado mediante el harness existente. No sustituyas el replay por una aserción mock ni registres el fixture solo en una prueba del paquete.

- [ ] **Paso 5: ejecutar la prueba integrada y los SDK snapshots afectados**

Ejecutar: pnpm exec vitest run packages/session-learning/tool-session-learning/tests/computer-learning-goal.integration.spec.ts; ejecutar pnpm run test:snapshot -- -t "Computer learning" para el ejemplo ensamblado.

Esperado: solo la finalización aceptada por GoalService activa y recupera el procedimiento.

### Tarea 5: registrar decisión y entregar a main y stable

**Archivos:**

- Crear en la PR de implementación: .agents/notes/implemented/feature/2026-09-22-safe-computer-learning.md y su contraparte china y sidecar.
- Modificar: packages/session-learning/tool-session-learning/README.md, README.zh.md y README.i18n.yaml.
- Modificar: packages/session-learning/tool-session-learning/src/index.ts.

**Interfaces:**

- Consume: el procedimiento seguro y la transición candidate-to-active de las tareas anteriores.
- Produce: documentación y nota de decisión acordes con los datos que ya se guardan y los mecanismos explícitos para revisar u olvidar.

- [ ] **Paso 1: escribir el Agent Note**

Registra por qué Computer requiere éxito de objetivo, qué campos se retienen, qué datos se excluyen, cómo se olvida un recuerdo y por qué los procedimientos no conceden permisos.

- [ ] **Paso 2: comprobar snapshots y package contracts**

Ejecutar: pnpm exec vitest run packages/session-learning/tool-session-learning/tests/computer-learning.spec.ts packages/session-learning/tool-session-learning/tests/computer-learning-goal.integration.spec.ts packages/session-learning/tool-session-learning/tests/adaptive.spec.ts packages/session-learning/tool-session-learning/tests/plugin.spec.ts; pnpm run doc-sync.

Esperado: pasan las pruebas focalizadas de aprendizaje, el snapshot keyless del ejemplo ensamblado y la documentación actualizada.

- [ ] **Paso 3: integrar después del canal y del vault**

Abre este PR cuando el protocolo Computer y el esquema browser_login ya omitan credenciales; integra primero a main, y prepara el backport a stable sobre su SHA vigente sin fusionar ramas divergentes.

### Criterio de cierre

Computer guarda únicamente una proyección permitida, nunca promueve tool/result ok aislado, solo recupera flujos después de GoalService.complete aprobado y permite review/forget; no se filtra ningún valor sintético al ledger o recall.
