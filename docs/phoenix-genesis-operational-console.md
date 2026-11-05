# PHOENIX Genesis — consola operativa de implantación institucional

**Estado:** consola funcional en desarrollo, probada con datos ficticios.
No es una certificación de software hospitalario, una historia clínica ni
una implantación completa de todos los procesos de una institución.

Esta guía complementa:

- [Plan maestro Genesis + Fabric v4](./phoenix-genesis-fabric-master-plan-v4.md).
- [Red Fabric universal, LAN, entre sedes y federación](./phoenix-fabric-universal-network.md).
- [Catálogo hospitalario 360°: áreas, indicadores, comités y reportes](./phoenix-genesis-healthcare-domain-pack.md).
- [Servidor Fabric y trabajadores de capacidades](./phoenix-fabric-operational-broker.md).

## Principio de producto

PHOENIX Genesis es el primer PHOENIX de una organización. Debe:

1. Conocer el negocio, sedes y su alcance antes de instalar agentes.
2. Solicitar planos, manuales, organigramas, inventarios y datos de
   operación con autorización institucional.
3. Construir una representación con evidencias del mundo físico, humano,
   financiero, tecnológico, normativo y operativo.
4. Detectar incertidumbre y formular preguntas focalizadas.
5. Proponer departamentos, interfaces, sistemas, estaciones, agentes,
   modelos y rutas de red sin dar por sentado que existen.
6. Calcular presupuesto CAPEX/OPEX con importes suministrados y
   aprobaciones, conservando monedas y periodicidades.
7. Conectar instancias solo con credenciales, permisos y pruebas reales.
8. Elaborar borradores verificables de POA y reportes, bajo revisión humana.
9. Mantener una plataforma abierta, sin depender de un sector específico.

**Nunca** confundir propuesta con instalación, un nodo registrado con un
nodo conectado, una declaración con un hecho verificado, ni un borrador
con un informe oficial remitido y aceptado.

## Arranque de la consola

Requiere Node.js 24 o posterior.

Desde la raíz de PHOENIX (PowerShell), configure la clave **local** en el
gestor de secretos que utilice o en una variable de entorno de la sesión:

~~~powershell
$env:PHOENIX_GENESIS_ADMIN_TOKEN = "<clave-segura-de-32-o-mas-caracteres>"
pnpm genesis
~~~

Abra **http://127.0.0.1:8767/** desde el mismo ordenador e introduzca
la clave administrativa. La interfaz está en español, tema claro, y
funciona sin proveedores de IA configurados.

Por seguridad, Genesis Console **solo escucha en loopback**; no exponga
directamente su puerto a la LAN o Internet. El acceso de otros equipos
se realizará por un servicio institucional de autenticación y
autorización que todavía está pendiente de construcción.

Las claves no se almacenan en cookies ni en el navegador. El servidor
las compara mediante huellas de longitud fija, y utiliza política CSP,
sin contenido ejecutable recibido de los documentos institucionales.

### Almacenamiento duradero

En Windows las bases de datos predeterminadas quedan en:

\`%LOCALAPPDATA%\PHOENIX\institution\genesis.sqlite\`

\`%LOCALAPPDATA%\PHOENIX\institution\fabric.sqlite\`

En otros sistemas se usa \`~/.phoenix/institution/\`.

Estas rutas están **fuera** de los runtimes temporales de PHOENIX, por lo
que la limpieza del actualizador no debe eliminarlas. Puede configurar
\`PHOENIX_INSTITUTION_DATA_HOME\` para usar otro directorio administrado
por su institución, o las rutas específicas
\`PHOENIX_GENESIS_DB\` / \`PHOENIX_FABRIC_DB\`.

No copie ni migre bases antiguas sobre bases activas. Haga respaldo,
detenga los procesos, compruebe versión y estructura, y ensaye una
restauración antes de sustituir los archivos.

**Advertencia:** el registro inicial guarda solo datos no sensibles
en SQLite sin cifrado de campos. No utilizarlo para pacientes,
currículos, identificaciones, nóminas, contratos con información
privada ni secretos. La bóveda institucional cifrada con roles y
auditoría permanece como trabajo futuro.

## Flujo de implantación disponible

### Paso 1 · Crear organización y sedes

La consola solicita identificador, nombre, sector, modo de adopción,
red prevista y estaciones. Los modos admitidos son:

- Capa PHOENIX sobre software tradicional.
- Sistema híbrido.
- Sistema PHOENIX integral.
- Migración progresiva.

La organización puede ampliarse posteriormente con nuevas sedes;
cada cambio conserva su revisión y no elimina unidades previas. Las
instancias calculadas se mantienen como propuestas.

### Paso 2 · Entrevista y evidencia

Genesis presenta preguntas por áreas: organización, planos y espacios,
manuales de RR. HH., turnos, software, normas, presupuesto, logística,
cocina, informes y continuidad. Las respuestas pueden quedar como
declaradas, inferidas o verificadas.

La verificación requiere asociar una evidencia validada. Un operador
autorizado selecciona el archivo local y declara si lo revisó. Genesis
guarda nombre, tipo, clasificación y huella SHA-256 del archivo, pero
no copia su contenido, no lo interpreta automáticamente y no certifica
su autenticidad por sí solo.

La institución conserva los documentos originales en su repositorio
apropiado. Los datos de personas se tratarán en una bóveda separada,
con autorización y mínimos privilegios.

### Paso 3 · Mapa de departamentos y procesos

La vista Organización permite registrar unidades, sedes, jerarquía,
cantidad agregada de personal, estaciones y rol contextual. Detecta
relaciones jerárquicas inválidas o circulares.

El motor de sugerencias propone unidades según el sector
(salud, restaurante, educación, comercio, industria, gobierno).
**Todas las sugerencias se presentan como pendientes** de aceptación.
Un hospital no recibe automáticamente una UCI solo porque aparezca en
el catálogo de referencia.

### Paso 4 · Software existente y método de integración

Se registran sistemas heredados y el método de integración declarado:
API, FHIR, HL7, DICOM, archivos, lectura de base de datos o RPA
supervisado. Todos quedan en estado \`pending-authorization\`; registrar
su nombre no prueba que una API funcione.

La fábrica universal de conectores y las migraciones con conciliación
y rollback son fases posteriores. No se escanea la red.

### Paso 5 · Modelos de IA y presupuestos

El catálogo de modelos permite declarar proveedor, modelo, ejecución
local o externa, cuentas compartidas por organización o separadas por
unidad/instancia y presupuesto mensual autorizado.

**No se aceptan claves de proveedores** ni se presume disponibilidad.
Las tarifas reales dependen de los contratos aplicables.

Las partidas financieras guardan cantidad, precio unitario, moneda,
categoría y periodicidad; no convierten monedas ni atribuyen costos
inexistentes.

### Paso 6 · Importación estructurada verificable

Desde Evidencias, Genesis admite un manifiesto JSON con el formato
que aparece a continuación, después de registrar y validar su fuente:

~~~json
{
  "schemaVersion": "1.0",
  "manifestId": "inventario_202611",
  "organizationId": "hospital_ejemplo",
  "evidenceId": "ev_REEMPLAZAR",
  "facts": [
    {
      "category": "facility",
      "key": "blueprints",
      "value": "Planos declarados como disponibles",
      "status": "declared"
    }
  ],
  "units": [],
  "systems": [],
  "costs": [],
  "goals": [],
  "obligations": []
}
~~~

El importador verifica columnas y relaciones, registra hasta 400
elementos por lote, ordena jerarquías cuando es posible, revierte el
lote completo ante un error y rechaza reimportaciones duplicadas con
contenido diferente. El archivo solo puede contener información
institucional agregada, no datos personales o historias clínicas.

### Paso 7 · Planeación, indicadores y reportes

El registro institucional puede guardar indicadores numéricos con
fuentes verificadas y metas por período. Un borrador de POA deja los
resultados sin evidencia como \`missing-verified-measurement\`.

Las obligaciones ante ministerios, servicios de salud, reguladores o
financiadores quedan como propuestas normativas **sin verificar** hasta
confirmar destinatario, versión de plantilla, reglas, firma y plazo.
Genesis no realiza envíos regulatorios ni garantiza su aceptación.

Para los POE y los informes oficiales de RR. HH., calidad, epidemiología,
dirección y finanzas todavía se requiere un motor documental y un
sistema de firma/aprobación integrado con la normativa aplicable.

### Paso 8 · Red interna o entre sedes

El broker Fabric existente puede ejecutarse en un proceso aparte con
identidades y capacidades por instancia. Genesis Console verifica su
API administrativa mediante \`PHOENIX_FABRIC_URL\` y
\`PHOENIX_FABRIC_ADMIN_TOKEN\` configurados **solo en el servidor**.

~~~powershell
$env:PHOENIX_FABRIC_URL = "http://127.0.0.1:8765"
$env:PHOENIX_FABRIC_ADMIN_TOKEN = "<clave-administrativa-del-broker>"
pnpm genesis
~~~

La vista Red PHOENIX permite registrar un nodo de una unidad existente
mediante una autorización explícita; el token se muestra una única
vez para almacenarlo fuera de la consola. Cuando el nodo envía un
heartbeat real, se muestra como conectado.

La consola **no instala el nodo**, no genera CA, no crea VPN ni
aprueba conexiones entre organizaciones diferentes. El broker admite
mTLS si la institución proporciona claves y certificados válidos y
lo configura en una LAN o red privada. La federación con externos
requiere su propio contrato, convenio y permisos.

## Pruebas

~~~powershell
pnpm test:genesis
node --test scripts/phoenix-fabric-broker.test.mjs scripts/phoenix-fabric-worker.test.mjs
~~~

La suite incluye creación institucional, entrevista, rechazo de datos
sensibles, recursos, presupuesto, POA, versionado de sedes, importación
atómica, segundo sector, API con autorización, conexión real de Genesis
al broker, registro de nodo y heartbeat.

## Objetivo de producción y pendientes

La primera entrega operativa permite experimentar con datos ficticios
y construir la base institucional. Para declarar Genesis **completo en
un hospital real** todavía se deben implementar y validar:

1. Bóveda documental cifrada, roles y consentimiento para CV, HR,
   contratos, planos, manuales y registros con información sensible.
2. Extracción y análisis de PDF, DOCX, hojas, CAD/BIM, sitios web e
   inventarios con trazabilidad a la fuente y revisión humana.
3. Generador/compilador organizacional que transforme el grafo en
   instancias, UI y procesos realmente desplegados.
4. Instalador y gestión de identidad, certificados y credenciales por
   PC, unidad, sede y organización.
5. Integración efectiva con sistemas tradicionales (HIS/LIS/RIS/PACS,
   finanzas, almacenes, RR. HH.) y pruebas de conciliación.
6. Reportes regulatorios oficiales, presupuestos y POA completos con
   aprobación, firma y evidencia auditada.
7. Flujos clínicos certificados (Consulta → Farmacia → Enfermería,
   hospitalización, UCI y demás servicios), alertas deterministas,
   niveles de servicio y continuidad operativa.
8. Escalado multi-sede, respaldo/restauración ensayados, alta
   disponibilidad, rotación de secretos y pruebas de seguridad.
9. Adaptación inteligente de UI más allá de formularios y tableros
   declarativos; pruebas de accesibilidad, rendimiento y UX.
10. Implantación piloto con datos sintéticos, evaluación de riesgos y
    responsables institucionales antes de información real.

**No llamar completo al hospital** hasta satisfacer esas condiciones.
