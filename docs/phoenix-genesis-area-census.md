# PHOENIX Genesis · Censo institucional hospitalario de 60 áreas

Este módulo usa el catálogo hospitalario v4 ya integrado en Genesis
para realizar un **diagnóstico por jefaturas**, sin asumir que las 60
áreas existen o que todas son obligatorias en un hospital determinado.

## Qué funciona

- Lista las 60 áreas con su macrodominio, datos a recolectar e informes
  sugeridos.
- Permite marcar cada una como \`existing\` (existe),
  \`outsourced\` (tercerizada), \`not-applicable\` (no aplica)
  o \`unknown\` (por investigar).
- Registra rol revisor, sede y fecha; mantiene el registro por
  organización, con auditoría.
- Distingue información \`declared\` (declarada por un responsable)
  de información \`verified\` (respaldada por evidencia local
  previamente validada y asociada a la institución).
- Calcula la cobertura del diagnóstico y un listado de áreas sin
  verificación.
- Puede funcionar sin proveedor externo de IA ni conexión a Internet.

No modifica historias clínicas, agendas, nóminas, órdenes o fuentes
financieras. Evaluar un área **no crea una instancia PHOENIX** ni
equivale a habilitar un servicio en el hospital.

## Uso local

Primero debe existir una organización configurada desde \`pnpm genesis\`,
por ejemplo \`hospital_ejemplo\`.

Para obtener un resumen y la lista de pendientes, desde la raíz:

~~~powershell
node scripts/phoenix-genesis-area-census-cli.mjs summary hospital_ejemplo
node scripts/phoenix-genesis-area-census-cli.mjs pending hospital_ejemplo
~~~

Para consultar el registro completo:

~~~powershell
node scripts/phoenix-genesis-area-census-cli.mjs list hospital_ejemplo
~~~

Para registrar una decisión, crea un archivo \`decision.json\`
sin información personal:

~~~json
{
  "organizationId": "hospital_ejemplo",
  "areaId": "area_001",
  "state": "existing",
  "reviewState": "declared",
  "reviewerRole": "Dirección General",
  "siteId": "principal",
  "evidenceRefs": []
}
~~~

Y ejecuta:

~~~powershell
node scripts/phoenix-genesis-area-census-cli.mjs assess decision.json
~~~

Para indicar \`reviewState:"verified"\`, se necesita al menos una
referencia a evidencia del **mismo hospital**, existente, registrada y
validada con su SHA-256 en Genesis. Un archivo sin verificar
no puede respaldar la afirmación.

## Formato y compatibilidad

El estado se guarda en la base SQLite persistente de Genesis
(\`PHOENIX_GENESIS_DB\`, configurable) y se mantiene tras reinicios.
El componente utiliza los contratos genéricos de organización,
evidencia y auditoría; no altera el núcleo del broker Fabric.
El módulo se activa únicamente cuando el tipo de institución
corresponde a salud, evitando imponer departamentos hospitalarios
a restaurantes, universidades o comercios.

La siguiente fase incluirá el censo dentro de la consola web y
conectará las áreas aceptadas a la captura guiada de inventario,
manuales, indicadores y fuentes. Cada alta de una unidad real
seguirá requiriendo aprobación.

## Pruebas

~~~powershell
node --test scripts/phoenix-genesis-area-census.test.mjs
~~~

Incluye estado cero inicial, 60 áreas, revisión, respaldo documental,
aislamiento entre hospitales y protección contra áreas, sedes o
estados inválidos.
