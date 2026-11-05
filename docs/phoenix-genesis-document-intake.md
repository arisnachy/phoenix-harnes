# PHOENIX Genesis · Document Intake v0.1

Genesis puede leer **documentación institucional autorizada**, obtener
hallazgos explícitos y someterlos a verificación humana, sin inventar
departamentos ni sustituir los sistemas existentes.

## Qué admite hoy

- Texto UTF-8 (\`.txt\`) y Markdown (\`.md\`).
- DOCX (texto de \`word/document.xml\`, extraído localmente desde OpenXML).
- PDF **con capa de texto**, cuando el ejecutable local \`pdftotext\` está
  instalado. En Windows puede instalarse una distribución fiable de
  Poppler y dejar \`pdftotext.exe\` accesible en PATH. Si no existe el
  extractor, Genesis informa que no hay backend y **no finge haber leído
  el PDF**. PDF escaneado/OCR, DWG, IFC y BIM requieren adaptadores
  adicionales; la interpretación visual de planos **todavía no funciona**.

El motor acepta documentos internos o públicos, previamente
registrados en Evidencias con huella SHA-256 y estado validado.
Rechaza una fuente modificada desde esa validación. **No admite** documentos
clasificados como restringidos ni CV, nóminas, expedientes clínicos,
credenciales, datos de pacientes u otros registros personales.

### Qué extrae

Encuentra declaraciones explícitas que comienzan con etiquetas como:
\`Departamento:\`, \`Área:\`, \`Software:\`, \`Sistema:\`,
\`Comité:\`, \`Procedimiento:\`, \`Informe:\`, \`Sede:\`,
\`Edificio:\`, \`Camas:\`, \`Consultorios:\` y
\`Servidores:\`. No se deducen estructuras de un párrafo ambiguo.

Cada hallazgo lleva su identificador, categoría, valor, **número
de línea** y estado de propuesta. La extracción no envía datos a modelos
externos y **no guarda el texto completo** en Genesis SQLite, solo
propuestas explícitas acotadas y la huella de su documento de origen.

## Flujo de uso

1. Registra un TXT, MD, DOCX o PDF autorizado en **Evidencias**.
2. Valida el archivo y su clasificación según la institución.
3. En la consola local, abre **Documentos 360°**.
4. Especifica \`documentId\`, \`evidenceId\`, ruta absoluta y tipo.
5. Selecciona **Analizar sin guardar** para una vista previa verificable.
6. Tras aprobar la lectura, pulsa **Guardar propuestas para revisión**.
7. Selecciona un hallazgo y decide aceptarlo o descartarlo.
   Para un departamento, indica un ID, sede y función. Para software,
   indica un ID de sistema. El alta requiere la aprobación administrativa.
8. El nuevo sistema conserva estado \`pending-authorization\`; **no**
   se considera conectado. Un área registrada sigue necesitando
   responsables, procedimientos y recursos verificados antes de operar.

El motor evita crear unidades durante una previsualización. Un
rechazo no altera el organigrama. Los cambios aprobados y la decisión
quedan en el registro de auditoría de Genesis.

### API local autenticada

- \`POST /v1/documents/preview\`: inspección sin escritura.
- \`POST /v1/documents/inspect\`: registra propuestas con
  \`approved: true\`.
- \`GET /v1/documents/findings?organizationId=...&documentId=...\`:
  consulta hallazgos por institución.
- \`POST /v1/documents/decide\`: decisión explícita \`accept/reject\`,
  con \`recordId\` y \`siteId\` para registrar una unidad cuando aplique.

La API solo está accesible desde la consola en localhost,
protegida por la clave de administrador de Genesis.

## Limitaciones críticas

1. Reconocer encabezados explícitos no es comprender un documento por
   completo. Las propuestas pueden estar desactualizadas o fuera de
   contexto; todas requieren revisión.
2. La detección de datos privados mediante patrones es **preventiva,
   no exhaustiva**. Nunca cargues expedientes o documentos sensibles
   en esta versión. Hace falta una bóveda cifrada por organización,
   control de propósito y permisos para RR. HH. y salud.
3. El PDF no incluye OCR sin un backend verificado. No se interpreta
   la geometría de planos, objetos BIM, equipos en fotos ni diagramas.
4. No inventa cargos, usuarios, licencias, tarifas, turnos o servidores.
5. No crea ni envía reportes oficiales, órdenes clínicas ni transacciones
   económicas a partir de hallazgos.
6. El sistema de documentos requiere todavía un visor con referencias
   por página y un proceso de extracción/asistencia IA con aislamiento.

## Pruebas

~~~powershell
node --test scripts/phoenix-genesis-document-intake.test.mjs
~~~

Incluyen documentos TXT y DOCX sintéticos, integridad SHA-256,
aislamiento institucional, rechazo de contenido personal,
idempotencia, auditoría, autorización administrativa, rollback
y operaciones reales de la API HTTP local.

Este módulo es una **fase comprobable** del Genesis universal; no es
un hospital digital completo ni una garantía de extracción para
todos los formatos.
