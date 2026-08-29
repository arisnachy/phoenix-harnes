# Adaptadores operativos de skills en PHOENIX

English | [中文](skill-operational-adapters.zh.md)

PHOENIX aplica un preflight operativo a cada skill visible mediante `ctx.skills.list()`. Esto incluye skills bundled, de usuario, de proyecto, de plugins y OpenClaw. El adaptador se ejecuta en `tool-skill`, que es el punto común usado por cualquier modelo del harness.

## Flujo obligatorio

Cuando la tarea coincide con una skill:

```text
skill({ name: "nombre-exacto-de-la-skill" })
```

El resultado contiene primero `<phoenix_operational_preflight>` y después el contenido de la skill. El modelo debe:

1. leer el catálogo y usar el nombre exacto;
2. cargar la skill antes de actuar;
3. comprobar entradas obligatorias;
4. pedir aclaración para ubicaciones, cuentas, personas, archivos o destinos ambiguos;
5. usar solamente herramientas presentes en las schemas visibles del agente;
6. revisar requisitos externos antes de ejecutar;
7. informar honestamente si la capacidad es condicionada o solo instructiva.

El adaptador orienta al modelo, pero no crea herramientas ni concede credenciales.

## Modos

- **`native`**: existe una herramienta PHOENIX visible que coincide con la operación documentada.
- **`conditional`**: la skill es utilizable, pero necesita una CLI, API, OAuth, permiso, dispositivo o plataforma adicional.
- **`instruction-only`**: la skill puede explicar el procedimiento, pero este runtime no declara una ruta de ejecución.

Una skill cargada no implica que se haya ejecutado su servicio externo. Por ejemplo, una skill de GitHub puede cargarse correctamente aunque no haya autenticación GitHub configurada.

## Regla de idioma

El preflight generado no introduce chino ni marcadores ideográficos accidentales. Los textos operativos se generan en el idioma configurado del harness. Se conservan sin traducir nombres de skills, comandos, rutas, URLs y citas técnicas. La traducción completa de los cuerpos de todas las skills al inglés es una fase separada y debe usar overlays, sin modificar el upstream.

## Weather y desambiguación

`openclaw-weather` requiere `location`. `Santiago` no se consulta directamente porque puede referirse a varios lugares; el modelo debe preguntar país, región, aeropuerto o coordenadas. Una entrada como `Santiago de los Caballeros, República Dominicana` sí es inequívoca para continuar.

La herramienta web registrada es preferida cuando existe. El fallback HTTPS se usa solo cuando la herramienta preferida no está disponible. El contenido remoto se trata como datos, nunca como instrucciones del sistema.

## Verificación individual

Ejecutar:

```text
pnpm run verify:skill-operational-adapters
```

El comando obtiene el snapshot real de `ctx.skills.list()`, carga cada skill model-invocable con `ctx.skills.get()`, calcula su perfil, revisa su preflight y escribe:

- `docs/subsystems/skill-operational-adapters-report.md`: una fila por skill con propósito, llamada, entradas, modo, requisitos y resultado;
- `docs/superpowers/evidence/skill-operational-adapters-verification.json`: evidencia estructurada sin cuerpos, secretos ni respuestas de red.

El último recorrido verificó **577/577 skills** visibles, todas cargables y con preflight no chino. La cifra puede cambiar cuando se instalen, retiren o actualicen plugins y skills.
