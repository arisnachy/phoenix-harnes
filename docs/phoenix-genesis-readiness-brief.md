# PHOENIX Genesis — informe ejecutivo de preparación institucional

PHOENIX Genesis puede generar un **borrador reproducible** para que
Dirección, Planificación y las jefaturas conozcan lo que falta investigar
antes de digitalizar o instalar servicios.

El documento combina exclusivamente información que Genesis tiene
registrada: entrevista institucional, unidades, inventario, software,
presupuestos, catálogo de áreas y evaluación de su existencia.

**No equivale a POA/POE aprobado, habilitación de servicios o informe
regulatorio.** No consulta APIs externas ni inventa valores.

## Dos formatos

- **HTML autónomo, imprimible y de tema claro:** seis indicadores,
  barra de evaluación de las áreas, avance por macrodominio,
  acciones pendientes ordenadas y costos declarados por moneda.
- **JSON:** documento estructurado con todas las acciones de
  investigación, fuentes, clasificación y huella SHA-256 para
  futuras integraciones con tableros, sistemas de POA, auditoría y
  análisis de datos.

Los HTML codifican el contenido institucional, para que un dato
malicioso no se interprete como script. No cargan fuentes, imágenes
ni recursos desde Internet.

## Comandos

Desde PHOENIX, con Node.js 24 o superior y una institución ya
registrada:

~~~powershell
node scripts/phoenix-genesis-readiness-cli.mjs summary hospital_ejemplo
node scripts/phoenix-genesis-readiness-cli.mjs html hospital_ejemplo C:\Informes\genesis_diagnostico.html
node scripts/phoenix-genesis-readiness-cli.mjs json hospital_ejemplo C:\Informes\genesis_diagnostico.json
~~~

En Windows, las rutas deben ser absolutas y la carpeta destino
debe existir. Genesis **no sobreescribe archivos existentes**.
Los datos fuente permanecen en la base institucional protegida,
fuera de los runtimes temporales del actualizador.

La variable \`PHOENIX_GENESIS_DB\` permite usar otra base institucional
autorizada (sin copiarla dentro del repositorio).

## Cálculos y trazabilidad

- **Cobertura de entrevista:** preguntas respondidas respecto al
  conjunto de descubrimiento vigente.
- **Áreas revisadas/verificadas:** del censo hospitalario de 60
  referencias, con estado y evidencia separados.
- **Inventario y documentación:** suma de conteos institucionales,
  sin identificar empleados ni pacientes.
- **Prioridades:** áreas existentes o tercerizadas sin evidencia,
  áreas sin entrevistar, respuestas generales pendientes y
  sistemas tradicionales sin permiso de integración.
- **Presupuesto:** partidas reales introducidas, separadas por
  moneda y periodicidad, nunca convertidas sin tasa verificada.
- **Fuente SHA-256:** huella reproducible del estado del inventario
  y censo usado para generar el informe. Si cambian los hechos,
  cambia la huella.

La fecha de generación no altera la huella de la fuente. Un informe
sin áreas clínicas es válido para otros sectores y no recibe
artificialmente 60 departamentos de un hospital.

## Consideraciones de seguridad

Los archivos exportados pueden contener datos operativos y nombres
de departamentos. La institución debe guardarlos en un directorio
con control de acceso y respaldo; Genesis crea los archivos con
permisos restrictivos donde el sistema operativo los respeta.

No deben incorporarse datos de pacientes, CV, nóminas ni secretos a
la base preliminar de Genesis. Las evidencias etiquetadas como
validadas siguen necesitando revisión profesional y reglas de
custodia. La entrega de un reporte al gobierno, o su firma y
aprobación oficial, están fuera de esta función.

## Pruebas

~~~powershell
node --test scripts/phoenix-genesis-readiness-brief.test.mjs
~~~

Incluye informe inicial sin hechos inventados, casos con
áreas existentes sin evidencia, presupuesto USD/DOP, sectores
no sanitarios, protección contra HTML inyectado, salida autónoma,
JSON y prevención de sobrescritura accidental.
