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
  "evidenceRefs": [],
  "expectedRevision": 0
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

## Consola gráfica de Genesis

Desde la raíz del proyecto, con Node.js 24 y la clave administrativa:

~~~powershell
$env:PHOENIX_GENESIS_ADMIN_TOKEN = "<clave-segura-de-32-o-mas-caracteres>"
pnpm genesis
~~~

Abre `http://127.0.0.1:8767/` en el mismo equipo. En **Censo
hospitalario**, selecciona la institución y verás cuatro indicadores:
porcentaje de áreas evaluadas, respaldadas con evidencia, declaradas
sin verificar y pendientes. Puedes buscar por servicio o proceso,
filtrar por estado y seleccionar una de las 60 referencias.

Para guardar una evaluación indica la existencia del área, el rol
que responde, la sede si aplica y las referencias de los documentos
validados. Las áreas marcadas como **verificadas** requieren evidencia
institucional registrada. El estado `declarada` no equivale a
validación. La vista muestra claramente que ningún departamento o
agente PHOENIX se instala con ese registro.

### Protección de revisiones simultáneas

Cada área lleva un número de revisión. La consola envía
`expectedRevision` y el servidor devuelve **409** si alguien
actualizó el censo entretanto. En ese caso recarga la información
antes de registrar otra decisión. El esquema SQLite anterior se
migra sin borrar las evaluaciones guardadas; el primer registro
existente recibe revisión 1.

Desde CLI, el primer registro permite `expectedRevision:0`.
Al modificar un área ya evaluada, se exige utilizar la revisión
actual obtenida desde `list` o la API.

### API local autenticada

- `GET /v1/census?organizationId=<id>` devuelve 60 áreas, estados,
  evidencias y revisiones.
- `POST /v1/census/assess` guarda una evaluación con su revisión
  esperada y respuesta auditada.
- `GET /census.js` ofrece el módulo de interfaz local; no contiene
  credenciales ni realiza llamadas externas.

**Pendiente:** vincular las áreas evaluadas a listas de manuales,
turnos, inventario, KPI y reportes por cada jefatura. Cada alta
de unidad real sigue requiriendo una aprobación independiente.

## Pruebas

~~~powershell
node --test scripts/phoenix-genesis-area-census.test.mjs
~~~

Incluye estado cero inicial, 60 áreas, revisión, respaldo documental,
aislamiento entre hospitales y protección contra áreas, sedes o
estados inválidos.
