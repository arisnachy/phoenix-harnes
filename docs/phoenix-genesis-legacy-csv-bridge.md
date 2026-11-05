# Genesis Legacy Bridge v0.1 — integración real de exportaciones CSV

**Disponible como código de integración:** adaptador de datos institucionales
agregados que una aplicación tradicional exporta en CSV. No necesita una
API oficial del proveedor. El adaptador **lee**, valida y copia únicamente
datos normalizados que el administrador autoriza en Genesis.

**NO ES** un conector vivo con acceso a HIS, pacientes, nómina, bases de
datos de producción o dispositivos, ni sustituye la conciliación, el
licenciamiento, los contratos con el fabricante o los mecanismos de
interoperabilidad clínica que una implantación real exige.

## Flujo operativo

1. El responsable del software tradicional exporta un CSV **agregado**.
   No incluir pacientes, empleados identificables, diagnósticos,
   nóminas, claves ni secretos.
2. El administrador revisa el archivo, su procedencia y su clasificación.
   En la consola Genesis, menú **Evidencias**, registra la **ruta absoluta
   de ese archivo** y marca validación solo si efectivamente ha verificado
   la fuente. El sistema guarda SHA-256, no los datos en bruto.
3. En el panel **PHOENIX Bridge** indica organización, identificador
   de lote, archivo CSV y evidencia validada.
4. Selecciona el tipo de exportación: áreas/unidades, sistemas heredados,
   partidas de costos, hechos institucionales, metas POA u obligaciones.
5. Asocia cada campo de Genesis con el nombre real de la columna CSV.
6. Pulsa **Verificar y previsualizar CSV**. Antes de escribir, el motor
   comprueba estructura, mapeo, encabezados, huella SHA-256 y límites.
7. El responsable autoriza la importación. Se registra el lote completo
   o se revierte todo. Un reintento del mismo lote es idempotente; reutilizar
   su ID para contenido distinto se rechaza.
8. Los registros importados siguen siendo datos institucionales sujetos
   a revisión: una unidad no se instala por importarla, un software no
   se considera conectado y ninguna meta se convierte en POA aprobado.

## Ejemplo mínimo de un HIS u otro ERP que exporta inventario de unidades

Archivo \`C:\Exportaciones\unidades_2026.csv\`:

~~~csv
id,sede,area,superior,personal,pc,funcion
farmacia,principal,Farmacia,direccion,4,2,pharmacy
direccion,principal,Dirección,,3,3,admin
~~~

Mapeo en la consola:

~~~json
{
  "unitId": "id",
  "siteId": "sede",
  "name": "area",
  "parentId": "superior",
  "staffCount": "personal",
  "workstations": "pc",
  "role": "funcion"
}
~~~

El orden de las filas puede poner un departamento subordinado antes
de su dirección: Genesis resuelve la jerarquía en una transacción.
La cantidad de personal es agregada, no un conjunto de expedientes.

La API local autenticada ofrece:

- \`POST /v1/legacy-csv/preview\`: no modifica ningún registro.
- \`POST /v1/legacy-csv/import\`: necesita \`approved:true\`, guarda
  los registros, la huella del lote y un evento de auditoría.

Ejemplo de cuerpo JSON:

~~~json
{
  "organizationId": "hospital_ejemplo",
  "batchId": "unidades_noviembre_2026",
  "filePath": "C:\\Exportaciones\\unidades_2026.csv",
  "evidenceId": "ev_REEMPLAZAR",
  "kind": "units",
  "mapping": {
    "unitId": "id",
    "siteId": "sede",
    "name": "area",
    "parentId": "superior",
    "staffCount": "personal",
    "workstations": "pc",
    "role": "funcion"
  }
}
~~~

Para confirmar, agregue \`"approved": true\` al mismo cuerpo.
Use solo el servidor local protegido por su clave administrativa; no
transmita esas claves en archivos o documentos.

## Métodos y limitaciones

El parser entiende CSV UTF-8, comillas RFC 4180, comas dentro de
campos, líneas CRLF y cabeceras explícitas; admite hasta 500 filas
de datos, 60 columnas y un archivo máximo de 2 MiB por lote.
El origen debe estar registrado y su SHA-256 debe coincidir exactamente
con el archivo actual.

El adaptador rechaza nombres de columnas potencialmente personales.
Su validación es preventiva, **no garantiza una detección exhaustiva de
datos sensibles ocultos en columnas genéricas**: el responsable debe
revisar previamente las exportaciones.

Para una organización real hay que definir además:
- Quién es propietario del dato, su licencia y la fuente oficial.
- Qué versión/fecha representan los datos.
- Contratos de conservación, clasificación y retención.
- Control de acceso por profesión, persona, propósito y sede.
- Transformación y conciliación en sistemas fuente.
- Respaldo y recuperación, cifrado, auditoría y consentimiento.

Este puente no realiza sincronización automática ni detecta cambios
en un ERP por sí solo. Una sincronización periódica exige scheduler,
versionado de fuente, resolución de conflictos y aprobación adicional.

## Pruebas

~~~powershell
node --test scripts/phoenix-genesis-legacy-csv.test.mjs scripts/phoenix-genesis-legacy-csv-http.test.mjs
~~~

Incluyen parser de comillas, evidencia, vista previa sin escritura,
autorización explícita, integridad, idempotencia, rechazo de datos
personales, actualización de la consola y rollback completo.

## Camino hacia el conector universal

Se añadirá un marco de adaptadores con drivers para API OpenAPI/FHIR,
HL7 v2, DICOMweb, exportación JSON/XML, lectura de bases permitidas,
eventos y RPA supervisada. Cada driver deberá probar su autorización,
esquema, origen, operación de lectura/escritura, latencia, trazabilidad
y reversión, **sin pretender que todos los sistemas cerrados se conectan
automáticamente**.

El CSV es el primer método operativo de esa estrategia.
