# HARDNESS Core + Tool Atlas

## Objetivo

Construir el fundamento provider-neutral de HARDNESS para que una misión pueda declarar necesidades y resolverlas mediante capacidades verificables, sin confundir una herramienta registrada con una capacidad disponible o confiable.

Esta fase cubre `hardness-core` y `Tool Atlas`. El runtime visual, la generative UI, el workspace, la adquisición externa y la promoción evolutiva consumirán este contrato en fases posteriores.

## Resultado de victoria de esta fase

Una instancia del núcleo debe poder:

1. registrar capacidades provenientes de plugins existentes;
2. describir entradas, salidas, dependencias, permisos, versión, proveedor y limitaciones;
3. resolver una necesidad como `have`, `missing` o `unknown`;
4. exigir evidencia de prueba antes de marcar una capacidad como `verified`;
5. conservar el registro y su historial de evidencia después de reiniciar;
6. poner una capacidad rota o insegura en cuarentena sin borrarla;
7. devolver un resultado determinista y explicable para el mismo inventario;
8. ejecutar un escenario end-to-end que descubra una necesidad no enumerada, encuentre una capacidad compatible del atlas o registre una carencia concreta sin inventar soporte.

## Límites

Esta fase no crea un catálogo cerrado de modalidades ni intenta resolver automáticamente cualquier necesidad. El contrato debe aceptar nuevas clases de capacidad sin modificar el núcleo. No descarga paquetes, activa credenciales ni concede permisos por sí mismo. La adquisición y la activación quedan detrás de consumidores posteriores y de sus respectivas puertas de aprobación.

## Arquitectura

`hardness-core` será un paquete de PHOENIX con tres roles del seam:

- **Service Definition:** tipos, estados, consultas y eventos públicos.
- **Service Provider:** registro en memoria, persistencia durable y evaluación de evidencia.
- **Consumer:** adaptadores que publican capacidades de tools, skills, MCP, renderers y otros proveedores sin acoplarlos entre sí.

El servicio se monta como plugin Cordis y todas las contribuciones se registran mediante efectos reversibles. El atlas es una proyección persistida del inventario; no reemplaza a `ctx.tools`, `ctx.skills` ni los proveedores de sandbox.

## Modelo de datos

Cada `CapabilityDescriptor` contiene:

- `id` estable y versionado;
- `kind` extensible, por ejemplo `tool`, `skill`, `mcp`, `renderer`, `model`, `data`, `unknown`;
- nombre y descripción orientada a la misión;
- entradas y salidas declarativas con referencias de formato;
- dependencias de otras capacidades;
- permisos requeridos, nunca permisos concedidos;
- proveedor y ubicación;
- versión y compatibilidad;
- limitaciones conocidas;
- estado de ciclo de vida;
- evidencia resumida y marca de última validación.

Los identificadores externos son opacos y se validan en el borde de persistencia o wire. Los descriptores no contienen secretos, tokens ni payloads de credenciales.

## Estados

El ciclo mínimo es:

```text
experimental → testing → verified
       │           │          │
       ├───────────┴──────────┴→ broken
       └────────────────────────→ quarantined
verified → deprecated
```

Las transiciones solo se realizan mediante operaciones explícitas del servicio y registran razón, versión, timestamp y evidencia asociada. Una capacidad `broken`, `quarantined` o `deprecated` no puede satisfacer una consulta que exija `verified`.

## Resolver

`resolveNeed(need, context)` compara la necesidad con el atlas usando únicamente campos declarados:

- `have`: existe un descriptor compatible, habilitado y con estado suficiente;
- `missing`: la necesidad es conocida, pero no hay descriptor compatible disponible;
- `unknown`: la necesidad contiene una clase, formato o requisito que el atlas no puede clasificar con seguridad.

El resultado incluye coincidencias consideradas, descarte por incompatibilidad o permiso, estado requerido y siguiente acción segura. El resolver nunca convierte `unknown` en `have` mediante heurística silenciosa.

El criterio de selección será determinista y provider-neutral: compatibilidad, estado, disponibilidad, permisos, versión y limitaciones. Calidad, coste, privacidad y velocidad se expondrán como metadatos para el router posterior, no como rutas codificadas dentro del atlas.

## Evidencia y verificación

Una prueba se registra como `CapabilityEvidence` con identidad del caso, entrada resumida no sensible, resultado, estado, duración, versión del descriptor y referencia a artefactos. La evidencia puede demostrar disponibilidad, compatibilidad, seguridad o calidad; cada afirmación debe indicar qué demuestra.

El servicio solo promociona a `verified` cuando la prueba declarada por el consumidor termina correctamente y sus requisitos de permisos fueron satisfechos. Los fallos conservan la evidencia y pueden activar `broken` o `quarantined` según la política del consumidor.

## Persistencia

El proveedor durable guardará un formato versionado local, separado del log de sesiones y de las credenciales. Las escrituras serán atómicas, recuperables y protegidas por el sandbox apropiado. Un registro corrupto no se interpreta como inventario vacío: la carga devuelve un error diagnosticable y conserva el archivo para recuperación.

El historial se compactará por capacidad manteniendo la última transición y las evidencias necesarias para justificar el estado actual. El formato se validará al cargar y al guardar.

## Permisos

El descriptor declara `requiredPermissions`; el atlas no los otorga. El resolver marca una coincidencia como no utilizable si el contexto no satisface los permisos requeridos. La concesión, aprobación, revocación y aislamiento pertenecen al Permission Broker y sandbox de una fase posterior.

## Fallos y fallback

- Descriptor inválido: rechazar el registro y no mutar el atlas.
- Evidencia ausente: mantener `experimental` o `testing`, nunca promover.
- Dependencia ausente: devolver `missing` con la dependencia concreta.
- Capacidad rota: excluirla de `have`, conservarla para diagnóstico.
- Persistencia ilegible: fallar de forma explícita y no fabricar capacidades.
- Tipo de capacidad nuevo: conservarlo como `kind` extensible; si no hay resolver compatible, devolver `unknown`.

## Pruebas

La cobertura mínima incluye:

- registro, reemplazo versionado y eliminación reversible;
- validación de identificadores, entradas, salidas y permisos;
- todas las transiciones de estado válidas y rechazos inválidos;
- resolución positiva, `missing` y `unknown`;
- desempate determinista entre capacidades;
- persistencia, recarga y corrupción diagnosticable;
- evidencia que promociona, mantiene o degrada un estado;
- aislamiento: permisos declarados no se convierten en permisos concedidos;
- adaptador de al menos una herramienta y una skill existentes;
- prueba end-to-end de una necesidad no enumerada que termina en una capacidad real compatible o en una carencia honesta y accionable.

## Integración posterior

Las fases siguientes consumirán `resolveNeed` y el atlas sin crear inventarios paralelos:

- el Capability Router elegirá proveedores y modalidades;
- el Visual Tool Runtime resolverá renderers por tipo de salida;
- Generative UI publicará capacidades de componentes y esquemas;
- Workspace compondrá artefactos y superficies;
- Permission Broker satisfará o rechazará permisos;
- Lab Mode evaluará candidatos antes de promoverlos;
- Self-improvement convertirá evidencia de misión en descriptores versionados.

Cada fase deberá aportar sus propios adaptadores, pruebas y evidencia end-to-end.
