# Diseño: miniavatares de modelo y actividad en KIRA · Equipos

## Objetivo

Sustituir el punto de estado principal de cada fila de `KIRA · Equipos` por un miniavatar de 24 px que identifique el modelo efectivo del subagente y comunique su fase real de actividad. El estado de salud/finalización se conserva como una insignia pequeña superpuesta.

La solución debe usar datos durables del log de sesión, no inferencias a partir del título, etiqueta o preset.

## Dirección visual aprobada

### Identidad por modelo

- **Sol:** disco ámbar con destello radial.
- **Luna:** círculo índigo con media luna y órbita fría.
- **Terra:** esfera turquesa con bandas topográficas.
- **Otros modelos:** orbe azul neutro con núcleo estelar; nunca se ocultan ni se etiquetan incorrectamente como Sol, Luna o Terra.

Los avatares se construyen con HTML/CSS y formas vectoriales simples. No se añaden imágenes rasterizadas: a 24 px, la geometría CSS mantiene mayor nitidez y evita nuevos activos.

### Estado y movimiento

El miniavatar mide 24 × 24 px. Una insignia de 6 px se superpone en la esquina inferior derecha:

- verde durante una sesión activa;
- verde tenue con marca visual estática al terminar;
- ámbar cuando la sesión espera interacción humana, si ese estado está disponible.

La animación depende de la fase durable:

| Fase | Fuente | Tratamiento visual |
|---|---|---|
| `preparing` | turno abierto sin llamadas de herramienta | respiración lenta; representa preparación/pensamiento previo a herramientas |
| `running-tools` | existe al menos una llamada de herramienta pendiente | aro orbital continuo |
| `verifying` | hubo herramientas y todas se resolvieron, pero el turno sigue abierto | barrido luminoso breve y repetido |
| `idle` | no existe un turno abierto | avatar estático y ligeramente atenuado |

No se crea una fase separada de “pensando” porque el log actual no la distingue de forma confiable antes de la primera herramienta. `preparing` comunica ambas situaciones sin fingir precisión.

### Movimiento reducido

Dentro de `@media (prefers-reduced-motion: reduce)`:

- no se ejecuta ninguna animación;
- color, forma e insignia siguen comunicando modelo y estado;
- no hay escalados ni rotaciones continuas.

## Arquitectura de datos

### Decisión

Reutilizar `SessionSummary.projectionValues`, ya transportado desde el host hasta los consumidores de la lista. No se amplía el RPC `session.list`, no se agregan frames paralelos y no se consulta cada sesión desde el componente.

### Proyección durable

El paquete `@deepseek-ai/dsh-subagent` añadirá una proyección `subagentActivity` con este valor cliente-seguro:

```ts
interface SubagentActivityProjection {
  provider?: string
  model?: string
  phase: 'preparing' | 'running-tools' | 'verifying' | 'idle'
}
```

La proyección seguirá la disciplina de reset por `subagent/descriptor` ya usada por `subagentTiming` y `subagent` para no heredar como propia la identidad de un ancestro incluido en un fork.

Reglas del fold:

1. `request/header`: conserva el último `header.config.provider` y `header.config.model` válidos del hijo.
2. `turn/start`: abre la fase `preparing` y reinicia el conjunto de llamadas pendientes.
3. `tool/call`: registra `callId`; la fase pasa a `running-tools`.
4. `tool/result`: elimina `callId`; si ya no quedan llamadas pendientes, la fase pasa a `verifying`.
5. `turn/end`: limpia llamadas pendientes y pasa a `idle`.
6. eventos de otros turnos o resultados sin llamada conocida no alteran la fase.
7. datos dañados o incompletos fallan de forma segura: fase `idle` y avatar neutro.

El valor se registra en `SessionProjectionMap`, se valida con Zod y se incluye automáticamente en baselines, caché y frames de proyección existentes.

## Componente de interfaz

`KiraTeamsDock` leerá:

```ts
summary.projectionValues?.subagentActivity
```

Un componente focal `ModelActivityAvatar` resolverá la familia visual a partir del identificador real de `model`:

- contiene `sol` → Sol;
- contiene `luna` → Luna;
- contiene `terra` → Terra;
- cualquier otro valor o ausencia → genérico.

La coincidencia es insensible a mayúsculas y no depende del proveedor. El `title` accesible del botón seguirá siendo la fila completa; el avatar será decorativo (`aria-hidden="true"`) porque el texto visible ya expresa el estado y evita anuncios duplicados.

La fila conservará:

- nombre truncado;
- etiqueta del preset;
- texto localizado `en marcha` / `terminó`;
- navegación al hijo al hacer clic;
- indentación de linaje;
- estados contraído y expandido del dock.

## Pruebas

### Proyección

Pruebas unitarias cubrirán:

- modelo efectivo desde `request/header`;
- transición `idle → preparing → running-tools → verifying → idle`;
- varias herramientas simultáneas;
- resultado desconocido que no avanza incorrectamente;
- reset de fork por descriptor;
- ausencia o daño del modelo con fallback seguro;
- serialización y validación del valor proyectado.

### Interfaz

Pruebas del plugin cubrirán:

- clase/identidad visual para Sol, Luna y Terra;
- fallback de modelo desconocido;
- atributo de fase real;
- reemplazo del `StateDot` principal por el avatar;
- insignia de estado y texto existente intactos;
- clic de navegación sin regresión.

### Verificación de navegador

En `http://127.0.0.1:3080/`:

- fila de un subagente activo con avatar correcto;
- cambio de fase observable durante uso de herramientas;
- estado estático al terminar;
- cero errores o advertencias nuevas de consola;
- emulación de `prefers-reduced-motion: reduce` con animaciones calculadas en `none`;
- captura normal y primer plano guardadas en `.kira/audits/`.

## Fuera de alcance

- mostrar retratos rasterizados o avatares configurables por el usuario;
- inferir personalidad o rol desde el nombre del modelo;
- cambiar el selector de modelos o el enrutamiento Sol/Luna/Terra;
- rediseñar la tarjeta completa;
- añadir nuevas fases que el log no pueda demostrar.

## Criterios de aceptación

1. Cada hijo muestra un avatar de modelo real o un fallback neutro.
2. La animación refleja exclusivamente la fase durable proyectada.
3. El punto verde se conserva como insignia secundaria.
4. La tarjeta no cambia de tamaño de forma perceptible ni pierde truncado/navegación.
5. Movimiento reducido elimina todas las animaciones del avatar.
6. Pruebas, build y verificación en la GUI existente pasan sin errores nuevos.
