# Phoenix Intentive Dock — Especificación de producto v1.0

**Estado:** propuesta funcional y técnica para Kira y Phoenix. **No equivale a una implementación.** **Fecha:** 2026-10-14 **Área:** UI / Kira / UME / programador de tareas / conectores **Objetivo:** aprovechar de manera optativa el espacio libre de la barra superior para información breve, contextual y útil, sin dejar un panel permanentemente visible.

## Decisión de producto

- El Dock está **vacío e invisible por defecto**. Conserva el aspecto limpio, naranja moderno, título de sesión y controles existentes.
- **No incluye juegos ni visores de videojuegos:** Phoenix ya los tiene dentro del chat. Tampoco se duplican mini-browser, visor 3D ni grandes interfaces.
- Kira interpreta la intención del usuario, responde primero a la solicitud principal y **solo sugiere un Dock o una automatización cuando añade utilidad real**.
- Un usuario puede pedir directamente «ponme un Dock de mis deportes», en cuyo caso no es necesario volver a pedir permiso para presentar la vista; las suscripciones, notificaciones, datos privados y programaciones persistentes sí requieren confirmación específica.
- Los Dock pueden ser efímeros (evento), fijados a voluntad, o **programados** (por ejemplo, «cada mañana, mis resultados deportivos»). No se muestra un Dock programado fuera de su ventana de visualización salvo que la persona lo fije.
- Los recordatorios deben existir en el sistema de tareas/calendarización, **independientes del Dock**, para no perderlos si se cierra la interfaz.
- El Dock solo muestra información verificable, con fuente, fecha de actualización y estados claros (sin datos / cargando / sin conexión / completado / desactualizado). Nunca simular avances o resultados en vivo.
- Mantener MAIN y STABLE sincronizados al integrar la implementación. Esta especificación no debe provocar reinicios de Host ni cambios en producción.

## Catálogo de 30 módulos propuestos

| Nº | ID | Módulo | Visualización compacta / acción |
|---|---|---|---|
| 1 | sports-daily | Favoritos deportivos diarios | Resultados de ligas/equipos favoritos; edición de preferencias; resumen en horario elegido |
| 2 | sports-live | Marcador deportivo en directo | Escudos, marcador, inning/cuarto/minuto, última actualización |
| 3 | sports-schedule | Próximos partidos | Hora local, rival, competición y acción «avisar antes» |
| 4 | sports-standings | Clasificaciones | Posiciones y líderes relevantes |
| 5 | news-digest | Resumen de noticias | Titulares temáticos elegidos, acceso a fuentes |
| 6 | daily-agenda | Agenda de hoy | Próximas 1–3 actividades de calendario |
| 7 | appointment-reminder | Citas | Próxima cita y aviso pactado |
| 8 | birthdays | Cumpleaños | Recordatorio anticipado opcional |
| 9 | anniversaries | Aniversarios | Fecha especial y cuenta atrás |
| 10 | priority-tasks | Prioridades | 1–3 pendientes del día |
| 11 | deadline-countdown | Plazos | Días/horas para entrega o fecha importante |
| 12 | weather-now | Clima | Ciudad favorita, temperatura, icono y tendencia |
| 13 | weather-alert | Alertas de clima | Cambios importantes y avisos oficiales verificados |
| 14 | commute | Tráfico y desplazamiento | Estado del recorrido y recomendación para salir, con fuente |
| 15 | priority-inbox | Bandeja prioritaria | Resumen de correos relevantes autorizados |
| 16 | kira-mission | Misión Kira/UME | Etapa real, avatar responsable, bloqueos y acceso al chat |
| 17 | artifact-ready | Trabajo completado | Archivo, informe o app listo; abrir resultado |
| 18 | github-status | Desarrollo GitHub | PR, test, build y despliegue |
| 19 | phoenix-health | Estado Phoenix | Host, servicio de voz y conectores, con diagnósticos comprobables |
| 20 | machine-health | Recursos del equipo | CPU/RAM/disco y avisos por umbral |
| 21 | course-planner | Formación | Clases, tareas y evaluaciones próximas |
| 22 | research-watch | Investigación | Artículos nuevos por tema y fuente |
| 23 | teaching-prep | Docencia | Clase próxima, materiales pendientes |
| 24 | fx-rates | Divisas | Tasas elegidas (p. ej. USD/DOP) y fecha de cotización |
| 25 | market-watch | Mercados | Precios de activos elegidos, variación y fuente |
| 26 | finance-due | Vencimientos | Cuentas/pagos autorizados; nunca exponer saldos sin consentimiento |
| 27 | flight-status | Vuelos | Fecha, puerta o cambio oficial cuando disponible |
| 28 | package-tracking | Pedidos | Último estado verificable de seguimiento |
| 29 | custom-alert | Alertas condicionales | Evento elegido: dato, cambio, publicación o umbral |
| 30 | focus-routine | Rutinas y enfoque | Cronómetro, descansos y sesiones programadas |

**Prioridad P0 (MVP):** sports-daily, sports-live, daily-agenda, appointment-reminder, kira-mission, weather-now, custom-alert. **Prioridad P1:** sports-schedule, news-digest, priority-tasks, artifact-ready, github-status, phoenix-health, birthdays, deadline-countdown, priority-inbox. **Prioridad P2:** módulos restantes, habilitados solo tras integrar fuentes reales.

## Ejemplos conversacionales

- Usuario: «Yo sigo a Dodgers, Lakers y Real Madrid». Kira: «¿Quieres un resumen con los resultados de tus equipos favoritos cada mañana? Puedo enseñártelo un rato arriba sin dejar la barra ocupada todo el día». Opciones: **Sí** / **Elegir hora** / **No gracias**. Si dice sí pero falta hora, preguntar la hora y confirmar zona horaria. No programar hasta tener consentimiento y datos suficientes.
- Usuario: «¿Cómo van los Dodgers?». Kira entrega primero el resultado con fuente; luego: «¿Quieres que mantenga el marcador arriba durante el partido?» **Mostrar** / **No**.
- Usuario: «Tengo una cita el jueves a las 10». Kira pide fecha concreta si hay ambigüedad, confirma cita y propone: «¿Te recuerdo una hora antes?» **Recordar** / **Calendario** / **No**.
- Usuario: «Kira, actualiza Phoenix». Kira realiza la tarea como corresponda; solo sugiere: «¿Quieres que te muestre el estado del trabajo en la barra mientras tanto?».
- Usuario: «¿Cómo estará el clima este fin de semana?». Kira responde con pronóstico; opcionalmente pregunta: «¿Quieres un pequeño resumen arriba o una alerta si cambia de manera importante?».
- Usuario: «No me propongas más Dock deportivos». Registrar preferencia y dejar de sugerir ese tipo sin afectar los Dock existentes que el usuario mantenga.

## Protocolo de sugerencia y consentimiento

1. **Detectar intención:** inferir tipo de tarea, si hay evento repetitivo, fecha/hora, duración, fuente fiable y preferencia del usuario.
2. **Evaluar utilidad:** sugerir solo cuando sea útil, breve y contextual. No interrumpir respuestas ni proponer por cada mensaje. Una sola propuesta visible por turno.
3. **Revisar preferencias:** respetar ocultar, silenciar categoría, «no volver a preguntar» y preferencias de frecuencia. Aplicar período de enfriamiento por sugerencia rechazada (p. ej., 7 días configurables; «nunca» hasta nueva autorización).
4. **Confirmación explícita:** antes de crear tareas recurrentes, alertas, notificaciones externas, conexión de cuentas o acceso a datos privados. El consentimiento para «mostrar ahora» no autoriza «avisar siempre».
5. **Activar:** registrar propuesta aceptada y fuente de datos. Los recordatorios se crean en scheduler persistente y el Dock solo muestra su representación.
6. **Expirar o cerrar:** Dock efímero vuelve a invisible al terminar evento o después de TTL; uno fijado queda hasta que el usuario lo quite. Ofrecer «Cerrar», «Fijar», «Recordarme», «Configurar», según corresponda.

## Diseño visual / interacción

- Zona **central libre** de la barra superior del chat. No invadir el título, sesión log, búsqueda, selector de agente ni otros controles.
- Nada visible sin contexto, sin Dock aceptado y fuera de una ventana programada.
- En estado compacto, una **sola cápsula activa** con icono/logo, 1–2 valores, actualización y, si aplica, temporizador. Si hay varios contenidos, lista discreta accesible al pulsar; sin carrusel que se mueva solo.
- Al pulsar la cápsula, abrir una bandeja ligera debajo de la barra con detalles y enlaces. Para contenido complejo abrir el chat o la herramienta existente, no un segundo visor.
- Mantener estilo actual (tema claro/naranja moderno), responsive, teclado y lector de pantalla.
- Ejemplo deportes: [logo Dodgers] LAD 4–2 MIL · 7.º inning · actualizado hace 30 s; el marcador **es solo un ejemplo**, nunca datos simulados en producción.
- Prioridad de simultaneidad: alertas aceptadas de seguridad/citas inminentes > Dock fijado por el usuario > actividad que el usuario pidió seguir > resumen programado. No reemplazar silenciosamente Dock fijados.
- Vista compartida: evitar exponer correos, pacientes, asuntos privados, cifras financieras u otros datos sensibles en una barra siempre visible. Resumen confidencial solo tras desbloqueo/consentimiento.

## Modelo de datos sugerido

```ts
type DockModuleId = string;

interface DockSuggestion {
  id: string;
  conversationId: string;
  moduleId: DockModuleId;
  explanation: string;        // beneficio en español natural
  actions: Array<'show_once'|'pin'|'schedule'|'remind'|'dismiss'|'never_suggest'>;
  requiresConsent: boolean;
  expiresAt?: string;
}

interface DockSubscription {
  id: string;
  userId: string;
  moduleId: DockModuleId;
  visibility: 'ephemeral' | 'pinned' | 'scheduled';
  preferences: Record<string, unknown>;
  scheduleId?: string;
  timezone?: string;
  createdAt: string;
  enabled: boolean;
}

interface DockSnapshot {
  subscriptionId: string;
  state: 'ready'|'loading'|'stale'|'error'|'unauthorized'|'empty';
  title: string;
  summary: string;
  logoUrl?: string;
  sourceLabel?: string;
  sourceUrl?: string;
  asOf?: string;              // horario verificable de última actualización
  expiresAt?: string;
  actionRoute?: string;       // ruta interna permitida y validada
}
```

Conectar eventos UME/Task Scheduler/Calendar/feeds reales mediante adaptadores; Kira propone, pero **la UI jamás interpreta texto libre de un LLM como una acción confirmada**. Los botones emiten eventos tipados y respaldados por permisos.

Eventos orientativos: `dock.suggestion.created`, `dock.suggestion.accepted`, `dock.subscription.updated`, `dock.snapshot.changed`, `dock.hidden`, `dock.expired`, `reminder.scheduled`, `reminder.fired`. Emplear identidad de usuario, deduplicación, idempotencia, cancelación y persistencia.

## Datos y restricciones técnicas

- Deportes: proveedores de resultados **autorizados**, política de cuotas, huso local, control de freshness; si la fuente no está conectada, ofrecer configurarla, no inventar marcadores. Separar «cada mañana» de «durante el juego».
- Calendario/recordatorios: fechas locales inequívocas, confirmación de recurrencia, notificación real y limitación explícita si el Host local está apagado. Si se precisa funcionamiento con equipo apagado, servicio remoto autorizado.
- Clima/noticias/precios: snapshots con fecha, fuente y TTL ajustado. No afirmar «en vivo» cuando no hay actualización real.
- Kira/UME: consumir telemetría oficial de ejecución, no mensajes ficticios, no prolongar trabajo tras la detención universal.
- Seguridad: permisos mínimos, no mostrar credenciales, enlaces validados, evitar XSS/iframe arbitrarios, no filtrar datos sensibles.
- Rendimiento: lazy load de adaptadores, evitar polling agresivo, WS/SSE si ya existe canal de eventos; liberar suscripciones al cerrar. Nunca retrasar render del chat ni voz.
- Respetar idioma español por defecto y preferencias de accesibilidad.
- Mantener el Dock opcional y sin contenedor permanente en blanco.

## Criterios de aceptación

1. En sesión nueva el Dock no aparece y el espacio de barra permanece igual.
2. Una pregunta cualquiera no causa sugestión indiscriminada.
3. Kira pregunta de manera natural al detectar una necesidad clara, después de responder lo principal.
4. Rechazar o silenciar impide que la misma propuesta reaparezca de inmediato.
5. Mostrar «solo ahora» no crea tareas futuras ni conexiones.
6. Configurar «mis deportes cada mañana» solicita equipos, hora y huso, confirma y persiste programación real.
7. Marcadores, hora de datos y estado de actualización vienen de fuentes verificables, o indican ausencia.
8. Cita recordada sobrevive a reiniciar la interfaz y se puede cancelar, sujeto a disponibilidad del scheduler.
9. Nada duplica visores de juegos ni mini-browser ya existentes dentro del chat.
10. Encaja en escritorio/móvil sin desplazamiento ni pérdida de controles.
11. No hay contenido privado involuntario en la barra.
12. Un Dock efímero se oculta al vencer y uno fijado respeta la elección del usuario.
13. Fallo de conector no rompe chat, entrada de texto, voz ni navegación.
14. No se declara implementado sin build, tests de integración y validación visible.
15. En la entrega final, **main y stable deben contener la misma versión**.

## Encargo para Kira y el equipo

**Kira (coordinación):** inventariar la UI actual, eventos, sistema de recordatorios y conectores; elegir reutilización antes que nuevas dependencias; planificar e integrar por fases P0/P1/P2. **Sol (planificación, Codex cuando aplique):** identificar archivos, flujo de consentimiento y scheduler persistente; dividir en hitos medibles. **Especialistas del equipo:** implementar una sola fuente real por módulo, componentes ligeros, almacenamiento y permisos; trabajar con el límite de agentes que tenga la configuración vigente. **Verificación:** pruebas de «no mostrar» por defecto, aceptación/rechazo, actualización, caducidad, accesibilidad, reconexión y rendimiento. **Cierre:** detención universal tras validar, reporte RESULTADO / EVIDENCIA / RIESGO / ESTADO. No prometer una activación, automatización o entrega que no haya ocurrido realmente.

Esta especificación es un **handoff de diseño**. Implementarla requiere cambios en código y pruebas separados.
