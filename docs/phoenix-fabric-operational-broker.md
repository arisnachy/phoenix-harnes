# PHOENIX Fabric v0.2 — núcleo operativo de coordinación

**Implementado aquí:** servidor HTTP autenticado, persistencia SQLite,
clientes CLI y trabajador independiente con capacidades autorizadas.
**No implementado:** instalación automatizada de equipos, federación
interinstitucional, relay cloud, HIS/FHIR en vivo, digital twin, UI adaptativa,
procesos clínicos, analítica institucional, POA/POE y reportes financieros.
Este es un primer flujo funcional, no el plan hospitalario completo.

Véase [Plan Genesis + Fabric v4](./phoenix-genesis-fabric-master-plan-v4.md)
y [topologías de red](./phoenix-fabric-universal-network.md).

## Requisitos

- Node.js 24 o posterior.
- Un servidor autorizado que pueda conservar un archivo SQLite y una copia
  segura de su almacenamiento. El broker no sustituye backups transaccionales
  ni un sistema HA de producción.
- Credenciales independientes por nodo. Los tokens solo se revelan al
  registrarlos y el servidor almacena únicamente su SHA-256.
- Para salir de loopback, certificados de servidor y cliente y una CA propia
  de la institución, correctamente emitidos y con SAN válido.
- Uso de datos **ficticios** hasta la validación de permisos, políticas,
  infraestructura, seguridad y procesos profesionales.

## Demostración local en Windows / PowerShell

Desde la carpeta raíz del repositorio PHOENIX:

**Terminal 1: broker**

~~~powershell
$env:PHOENIX_FABRIC_ADMIN_TOKEN = node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
$env:PHOENIX_FABRIC_URL = "http://127.0.0.1:8765"
node scripts/phoenix-fabric-broker.mjs
~~~

Guarde el secreto administrativo en el gestor de secretos institucional.
**No** lo suba a un archivo del repositorio ni lo envíe por chat. Para
registrar nodos, use otra terminal con ese mismo secreto de forma segura.

**Terminal 2: configuración institucional**

~~~powershell
$env:PHOENIX_FABRIC_URL = "http://127.0.0.1:8765"
$env:PHOENIX_FABRIC_ADMIN_TOKEN = "<secreto-administrativo-de-Terminal-1>"
node scripts/phoenix-fabric-client.mjs enroll consult1 hospital_demo campus1 prescriptions.propose -
node scripts/phoenix-fabric-client.mjs enroll pharmacy1 hospital_demo campus1 fabric.ping consult1
node scripts/phoenix-fabric-client.mjs nodes
~~~

Cada \`enroll\` devuelve un token diferente; almacénelos en un gestor de
secretos. El token de Consultas y el de Farmacia nunca deben compartirse.
El ejemplo solamente da permiso al nodo Consulta para invocar
\`fabric.ping\` del nodo Farmacia. Una instancia universal conserva sus
capacidades generales, pero cada operación está sujeta al rol autorizado.

**Terminal 3: PHOENIX Consulta, envía la tarea**

~~~powershell
$env:PHOENIX_FABRIC_URL = "http://127.0.0.1:8765"
$env:PHOENIX_FABRIC_NODE_TOKEN = "<token-de-consult1>"
node scripts/phoenix-fabric-client.mjs send pharmacy1 fabric.ping ping_001 "Prueba de comunicación" testref false
~~~

**Terminal 4: PHOENIX Farmacia, ejecuta como proceso separado**

~~~powershell
$env:PHOENIX_FABRIC_URL = "http://127.0.0.1:8765"
$env:PHOENIX_FABRIC_NODE_TOKEN = "<token-de-pharmacy1>"
node scripts/phoenix-fabric-worker.mjs
~~~

El trabajador demuestra la conexión ejecutando **solo** \`fabric.ping\`,
una capacidad sintética sin efecto clínico. Devuelve \`fabric_pong\` como
referencia verificable de este ping. Consulte el \`taskId\` devuelto por
\`send\` con el token de Consultas:

~~~powershell
node scripts/phoenix-fabric-client.mjs task <taskId>
~~~

El estado debe pasar de \`queued\` a \`leased\` y a \`completed\`. Si el
servidor se reinicia, las tareas pendientes sobreviven en SQLite. Las leases
de 30 segundos vencen y permiten reintentos; los handlers reales deben
implementar idempotencia y compensación de efectos de negocio.

## Capacidad externa real

Para escuchar en una LAN o por un overlay/VPN privado:

~~~powershell
$env:PHOENIX_FABRIC_HOST = "10.0.0.25"
$env:PHOENIX_FABRIC_PORT = "8765"
$env:PHOENIX_FABRIC_TLS_KEY = "C:\secrets\fabric-server.key"
$env:PHOENIX_FABRIC_TLS_CERT = "C:\secrets\fabric-server.crt"
$env:PHOENIX_FABRIC_TLS_CA = "C:\secrets\fabric-ca.crt"
node scripts/phoenix-fabric-broker.mjs
~~~

En cada cliente autorizado:

~~~powershell
$env:PHOENIX_FABRIC_URL = "https://fabric.hospital.internal:8765"
$env:PHOENIX_FABRIC_CLIENT_KEY = "C:\secrets\node-client.key"
$env:PHOENIX_FABRIC_CLIENT_CERT = "C:\secrets\node-client.crt"
$env:PHOENIX_FABRIC_TLS_CA = "C:\secrets\fabric-ca.crt"
~~~

Configure DNS, cortafuegos y certificados con el departamento TIC. Los
ejemplos representan **configuración manual**: este módulo no crea una
VPN, una CA o un relay, no expone puertos automáticamente y no ejecuta
escaneos. Puede emplearse a través de un overlay ya administrado. Un
relay multiempresa, la federación de tenants, la residencia de datos y
el gobierno de convenios están diseñados pero no están implementados.

## Incorporar capacidades reales

Instale un módulo JavaScript autorizado localmente que exporte un objeto
\`handlers\`. El trabajador no ejecuta código recibido de tareas remotas.
Los handlers reciben referencias, propósito y origen; **nunca el historial
clínico bruto a través del broker**.

Un handler debe hacer su propia validación de permisos con el sistema
fuente, gestionar idempotencia usando \`taskId\`, realizar el efecto
autorizado y devolver \`{verified:true,resultRef:'id-de-comprobante'}\`.
El campo \`verified\` es una afirmación del handler: no sustituye auditar
el sistema externo ni la firma de un profesional. Si la respuesta no
incluye una referencia válida, la tarea se marca como fallida.

Configure \`PHOENIX_FABRIC_HANDLER_MODULE\` con la ruta absoluta del módulo
**confiable**, audítelo y ejecute \`phoenix-fabric-worker.mjs\`. No
conecte un proceso clínico o financiero de producción sin certificación
de sus flujos y autorizaciones. No use la aprobación técnica del broker
como prescripción, dispensación ni administración de medicación.

## Seguridad y continuidad

- HTTP simple permitido únicamente en loopback. LAN o sedes externas:
  TLS con solicitud obligatoria de certificado cliente y CA confiable.
- Tokens aleatorios de 256 bits por nodo; revocación inmediata; no se
  incluyen en las listas administrativas ni en los comprobantes.
- Un nodo no puede enviar a otra organización; el receptor necesita
  otorgar explícitamente permiso al emisor y anunciar la capacidad.
- Un mensaje solo admite identificadores, propósito y referencias; el
  servidor rechaza propiedades adicionales como \`payload\` o \`patient\`.
- En caso de desconexión, las tareas sobreviven; el broker conserva
  idempotencia de ingreso por \`source+idempotencyKey\` y leases del receptor.
- El sistema de tareas es **at-least-once**, no exactamente una ejecución
  de efectos externos: cada handler debe demostrar idempotencia propia.
- El broker persiste el estado en SQLite WAL. Hacen falta políticas y
  pruebas periódicas de backup/restore, operación HA, rotación de claves,
  auditoría inmutable y monitoreo antes de un despliegue hospitalario real.

## Pruebas automatizadas

~~~powershell
node --test scripts/phoenix-genesis-fabric.test.mjs
node --test scripts/phoenix-fabric-broker.test.mjs scripts/phoenix-fabric-worker.test.mjs
~~~

Las pruebas incluyen dos procesos conectados mediante HTTP, aislamiento por
organización, control de emisor, autorización por capacidad, rechazos de
datos sensibles, idempotencia, aprobación, finalización, revocación y
recuperación después de un reinicio del broker.

## Próximo umbral

1. Vincular Genesis Organization Graph, sedes, evidencias y presupuestos a
   un almacén de datos autorizado, con roles humanos y auditoría.
2. Integrar la instalación guiada y certificados en el host de PHOENIX.
3. Enlazar las instancias lógicas con el motor real de Kira y los adaptadores
   de PHOENIX existentes, sin recurrir a handlers de demostración.
4. Validar Consulta → Farmacia → Enfermería con datos sintéticos, órdenes y
   recibos tipados que cumplan las autorizaciones clínicas reales.
5. Desplegar UI adaptativa, conectores tradicionales, indicadores y
   reportes institucionales; después federación entre empresas.


## Genesis: registro institucional y borradores POA operativos

El módulo \`scripts/phoenix-genesis-institutional-registry.mjs\` mantiene
en SQLite un **registro local institucional** separado del broker. Es
un primer cimiento del Organization Graph, no una historia clínica ni un
gestor documental completo. No interpreta PDFs automáticamente, no
extrae currículos con IA ni registra personas sensibles.

Para inicializarlo con el hospital ficticio:

~~~powershell
node scripts/phoenix-genesis-registry-cli.mjs init scripts/phoenix-genesis-fabric-example.json
node scripts/phoenix-genesis-registry-cli.mjs snapshot hospital_ejemplo
node scripts/phoenix-genesis-registry-cli.mjs poa scripts/phoenix-genesis-poa-example.json
~~~

La última instrucción devolverá un **POA-DRAFT** con indicadores sin
medición, no cifras inventadas. Para agregar datos:

~~~powershell
node scripts/phoenix-genesis-registry-cli.mjs evidence hospital_ejemplo .\inventario-autorizado.csv inventory validated
~~~

Ese comando genera un identificador \`ev_...\` y guarda **solo**
nombre, clasificación y huella SHA-256 del archivo local, no el
documento en bruto. La validación es declaración del operador; no
representa certificación automática. Después se pueden registrar
recursos con evidencia y mediciones con datos de origen verificados,
mediante JSON presentado a los comandos \`resource\` y \`measure\`.

Ejemplo de medición de conteo, sustituyendo el identificador de
evidencia generado:

~~~json
{
  "organizationId": "hospital_ejemplo",
  "metricId": "devices_available",
  "period": "2026-11",
  "numerator": 3,
  "denominator": null,
  "unit": "count",
  "evidenceRefs": ["ev_REEMPLAZAR_POR_ID_REAL"]
}
~~~

La base \`.phoenix/genesis.sqlite\` debe permanecer en un volumen local
protegido y respaldado; los archivos que originan las evidencias se
conservan en su repositorio institucional autorizado. Los currículos,
salarios, documentos personales y datos clínicos quedan fuera de este
registro preliminar. Un POA real necesita metas aprobadas, presupuesto,
responsables, cronograma, normativa y firma; este borrador no suplanta
nada de eso.

Prueba automatizada:

~~~powershell
node --test scripts/phoenix-genesis-institutional-registry.test.mjs
~~~
