# PHOENIX Health — operación local real (piloto controlado)

**Naturaleza:** PHOENIX mantiene su identidad y añade Health Engine. Esta implementación ya almacena registros auténticos en SQLite cifrado, con autenticación por personal, historial, consultas, agenda, órdenes, recetas, farmacia, facturación, seguimiento y auditoría. **NO está homologada para uso clínico de producción**: faltan control de relación asistencial, copias automáticas, revisión jurídica/seguridad, interoperabilidad HL7/DICOM, firma electrónica legal y pruebas clínicas con instituciones.

## Activación

En el equipo Windows donde ya se ejecuta PHOENIX, abrir PowerShell desde la carpeta principal y arrancar:

```powershell
$env:PHOENIX_HEALTH_ENABLED = "1"
pnpm phoenix
```

Health se sirve en la **misma dirección local de PHOENIX** bajo `/health`. La opción «Health» aparece en la barra lateral y abre el módulo en una pestaña. El servidor rechaza la activación si PHOENIX escucha en `0.0.0.0`; exige `127.0.0.1` y solicitudes de loopback. Sin `PHOENIX_HEALTH_ENABLED=1`, la ruta no se monta ni se crea la base.

## Primera apertura y credenciales

1. Abrir «Health», crear centro y usuario administrador con contraseña maestra **de 16 caracteres o más**.
2. Resguardar la contraseña fuera del chat. Es esencial: la base cifra cada registro clínico con AES-256-GCM; sin la clave maestra, **los datos no son recuperables**. PHOENIX no envía la clave a modelos ni la guarda en texto.
3. Iniciar sesión. El administrador podrá crear cuentas profesionales con contraseñas propias y roles.
4. Tras un reinicio del Host, **el administrador** debe volver a entrar para desbloquear la clave de cifrado; después pueden iniciar sesión las otras cuentas.
5. Los permisos distinguen administración, medicina, psicología, recepción, laboratorio, imágenes, farmacia y facturación. Un médico solo puede firmar sus propios episodios; la consulta firmada no admite sobreescritura.

**Datos:** `$DSH_HOME/health/clinic.sqlite` (por defecto `~/.dsh/health/clinic.sqlite`). El modo WAL de SQLite requiere un plan de backup consistente y verificación de restauración; **no copie a mano un archivo SQLite mientras el Host siga escribiendo**. La interfaz no usa `localStorage` para datos de pacientes. Las sesiones son cookies HttpOnly, SameSite=Strict y solo válidas en local.

## Integración con PHOENIX ASK (copiloto en el chat)

Los médicos pueden pulsar **Kira · ASK clínico** desde Consultas. La acción abre el chat de PHOENIX y presenta un texto genérico, sin paciente, para solicitar a Kira la herramienta `health_copilot_ask`. Esta herramienta usa el servicio **original** `ctx.userQuestions.ask` y obliga a que todas las decisiones se marquen `sensitive: true`.

Kira puede pedir al profesional que seleccione el modo (Kira/profesional/mixto), realice la evaluación inicial de signos de alarma y gestione preguntas pendientes. Si ASK expira, es omitido o recibe una opción no válida, no se presume un hallazgo negativo ni se registra consentimiento. La opción «Registrar en expediente protegido» indica **un trabajo pendiente**, no confirma que la respuesta se haya guardado.

**Separación de seguridad:** la pestaña ASK de conversación y la página clínica autenticada `/health` NO comparten pacientes ni credenciales. La herramienta ASK del modelo **no puede abrir, leer, modificar ni firmar expedientes**. Las respuestas reales se documentan por el profesional dentro de la sesión clínica cifrada usando Entrevista Kira y el editor SOAP. Nunca copie PHI al chat para forzar una integración: esa conexión requiere autorización, retención, evaluación de proveedor y controles que aún no están implantados.

## Kira y la documentación clínica

El profesional que haya sido asignado explícitamente a un paciente y sea titular del episodio puede abrir **Entrevista Kira** desde la lista de consultas. PHOENIX calcula localmente un conjunto limitado de preguntas dirigidas según el motivo y la especialidad; cada respuesta se registra en el expediente cifrado y la siguiente propuesta excluye las claves ya respondidas. Las respuestas faltantes **no** se interpretan como hallazgos negativos. El motor no formula diagnósticos ni autoriza tratamientos; las alertas y urgencias requieren evaluación humana.

La guía utiliza un algoritmo determinista local (`src/health-interview.ts`) aislado del modelo y no transmite narrativas, nombres o expedientes a proveedores externos. El profesional también puede seleccionar **Documentar**, usar el editor SOAP (anamnesis, exploración, evaluación y plan), guardar borradores versionados y realizar las acciones separadas de revisión y firma. Ninguna respuesta de entrevista equivale por sí misma a una historia revisada o firmada.

## Flujo real de la consulta

- Recepción registra pacientes auténticos, datos de contacto y constancia de consentimiento.
- El profesional abre un episodio con motivo, especialidad y modalidad Kira/profesional/mixta.
- La historia, exploración, valoración y plan se guardan en borrador cifrado.
- El profesional revisa la versión y luego confirma la firma. Las versiones antiguas no se pueden firmar.
- El médico prescriptor crea órdenes de laboratorio/imágenes y recetas vinculadas a una consulta firmada. Laboratorio y radiología pueden registrar resultados, que el profesional revisa.
- Farmacia controla inventario y registra **dispensaciones transaccionales**, descontando existencia solo una vez y solo para la receta correspondiente.
- Agenda registra citas, seguimientos y facturación interna; todo tiene permisos de rol y registro de auditoría.

Kira dispone de la herramienta `health_interview_plan` para orientar el interrogatorio desde el chat **solo con motivos genéricos, sin datos identificables**. El chat general aún no está conectado al expediente cifrado para evitar exposición accidental de información sensible a proveedores de IA.

## Correo real desde Kira (Gmail, solo recordatorios neutrales)

Para usar Gmail debe existir una cuenta institucional de Kira autorizada en el broker Google Workspace de PHOENIX. Establecer `PHOENIX_HEALTH_KIRA_SENDER` con **la dirección REAL verificada de esa cuenta** antes del arranque (nunca usar una identidad inventada). Por ejemplo, en PowerShell:

```powershell
$env:PHOENIX_HEALTH_KIRA_SENDER = "DIRECCION_REAL_VERIFICADA"
```

Al solicitar un recordatorio desde **Agenda**, PHOENIX primero consulta `users/me/profile` y comprueba que el Gmail conectado coincide exactamente con el remitente configurado. Solo el médico asignado a la cita puede confirmar el envío, y el paciente debe tener consentimiento y correo previamente verificado en el registro. El mensaje es **neutro**, sin diagnóstico, receta ni resultados. El Host almacena el estado y recibo del proveedor sin duplicados; si Gmail responde con resultado incierto, no reintenta automáticamente y el profesional debe comprobar la bandeja antes de actuar.

**Esto es envío REAL cuando se satisfacen las credenciales/validaciones, pero no es un sistema de recordatorios automáticos ni entrega segura de recetas.** Recetas, planes y resultados clínicos requieren futuro portal de paciente cifrado y consentimiento adaptado; no se adjuntan a un correo ordinario.

## Acceso por relación asistencial

La cuenta profesional no recibe acceso automático a todos los pacientes. Administración y recepción pueden conceder y revocar asignaciones desde **Equipo asistencial**, indicando el profesional y la finalidad de atención. El servidor valida la institución y la función del destinatario, conserva un registro auditable y oculta los expedientes de pacientes no asignados. Un profesional que crea personalmente un registro de paciente obtiene su relación inicial de atención, también auditada. La interfaz limita las funciones por rol, pero la autorización definitiva ocurre en el servidor.

## Consentimiento de contacto

La creación inicial de un paciente **no** activa por sí misma el permiso de envío, aunque el formulario o una API intenten incluir `emailConsent: true`. Un usuario autenticado de recepción, administración o el clínico autorizado debe utilizar la acción **Consentimiento**, registrar el método de verificación (`in-person`, `signed-document` o `verified-call`) y aportar una referencia documental. La autorización y la revocación generan nuevas versiones de registro y eventos de auditoría. El envío de recordatorio queda bloqueado si falta esa evidencia.

**Importante:** el mecanismo guarda una declaración verificable de personal autenticado. No valida de forma independiente el documento o la titularidad del correo. La verificación externa de identidad y las firmas legales siguen pendientes.

## Respaldo y recuperación

En el área **Respaldos**, el administrador puede solicitar una instantánea local mediante la API de copia online de SQLite; el proceso abre el archivo resultante y exige `PRAGMA integrity_check = ok`. Las copias se guardan en `$DSH_HOME/health/backups/` y los eventos se auditan. Los registros de la copia conservan su cifrado por registro, pero **el archivo SQLite no está cifrado por completo** y puede incluir metadatos operativos; resguardar carpeta, permisos y dispositivos.

La prueba automatizada abre un respaldo como una nueva base y verifica que puede recuperar registros usando la contraseña del administrador original. Para una recuperación real deben detenerse todas las instancias de PHOENIX, archivarse el estado previo completo, probarse la copia en un entorno aislado y seguir un procedimiento institucional de restauración. No se ha implementado todavía el sistema completo de respaldos fuera del equipo, rotación, recuperación de claves ni recuperación ante desastres. Nunca sobrescribir una base abierta ni copiar solo el archivo principal cuando SQLite trabaja en WAL.

El desbloqueo de la clínica verifica la cadena HMAC de auditoría; si detecta modificaciones, rechaza el acceso.

## Límites de la entrega

- No es todavía un EHR certificado ni un sistema sanitario homologado en República Dominicana.
- El control de acceso por relación asistencial y el respaldo local son primeros controles; faltan pruebas de penetración, licencia profesional verificable, controles de emergencia, relación por finalidad y recuperación completa de claves.
- No hay visores DICOM, dispositivos LIS/RIS/PACS, facturación ARS, integración de caja externa, telemedicina ni recuperación ante desastres probada.
- La historia clínica no está aún conectada de extremo a extremo con el razonamiento de Kira. El modelo no puede leerla directamente ni producir prescripciones firmadas.
- Correo real limitado a recordatorios explícitamente aprobados, con Gmail institucional validado; no hay cron automático ni acceso remoto del paciente.
- Antes de cualquier despliegue clínico en producción se necesitan pruebas end-to-end con autorización y aislamiento multiinstitucional, verificaciones de seguridad, protección de datos conforme a RD y revisión de responsabilidad profesional.

## Verificación

```powershell
node --experimental-strip-types --test packages/core/tool-health/tests/*.test.mjs packages/bundle/web-app/tests/health-store.test.mjs
```

Verificar en GitHub las puertas de construcción, typecheck, Windows y tests del HEAD del PR #1192. No declarar el PR listo para `main` o `stable` si hay verificaciones pendientes o fallidas.

## Consulta presencial y recepción local de documentos

La vista **Mi consulta** reúne registro presencial sin cuenta web, continuidad de consultas, indicaciones previas y cronología por paciente asignado. El profesional puede cargar fotografías JPEG, PNG, WebP y documentos PDF desde su equipo (hasta 5 MiB por archivo y 100 por paciente) sin correo ni nube externa. Los originales quedan cifrados dentro de SQLite y se incluyen en sus respaldos consistentes. La visualización y descarga requieren autenticación clínica y relación asistencial.

Todo documento aportado queda **pendiente de revisión médica**; no se interpreta ni notifica automáticamente. El portal de cargas externas, enlaces seguros temporales y análisis asistido sujeto a permisos y consentimiento son capacidades futuras. No introducir datos reales hasta completar las validaciones clínicas, regulatorias y de seguridad.

## Continuidad clínica longitudinal (piloto)

**Mi consulta** muestra el contexto por paciente autorizado: antecedentes, consultas
firmadas, plan anterior, órdenes y resultados pendientes, medicamentos, seguimiento,
cifras numéricas y archivos clínicos. La proyección es local a la clínica y no envía
PHI a Kira/chat general. Las cifras transcritas deben conservar procedencia y documento
de origen; empiezan **sin verificar** y solo el médico puede verificarlas. Las fotos y
los PDF pueden marcarse como **revisados**, lo cual no valida sus conclusiones.
Los valores solo se comparan cuando coinciden nombre de variable y unidad, sin
inferir normalidad o realizar conversión de unidades. El portal de pacientes y la
interpretación automatizada de documentos siguen pendientes.

El servicio `ctx.healthia` y `/health` siguen siendo repositorios distintos: no
crear una segunda copia de paciente ni sincronizar nombres como identidades.

## Modelos anatómicos 3D vinculados al expediente (investigación)

El profesional clínico autorizado puede abrir **Anatomía 3D** desde /health, seleccionar un paciente asignado y archivar un archivo **GLB 2.0 autocontenido de hasta 5 MiB**. Se valida el formato, se rechazan recursos externos y extensiones que requieren decodificadores no instalados; el archivo se cifra mediante el repositorio clínico y solo se entrega al profesional autorizado. El visor 3D obtiene Three.js desde la instalación local privada de PHOENIX sin CDN. El profesional puede girar, acercar y aislar mallas. La revisión médica se documenta y audita con referencia del estudio original, concordancia (consistente, incierta o discordante) y limitaciones. **No certifica la anatomía**, ni la exactitud de la segmentación o un uso diagnóstico.

La segmentación automática de CT/RM sigue siendo un proceso investigativo independiente ejecutado mediante `scripts/phoenix-anatomy-workbench.mjs`, y los modelos grandes no pueden archivarse por el límite piloto de 5 MiB. No existe todavía un puente aprobado que procese estudios DICOM del paciente desde HealthIA, ni certificación de modelos para todas las estructuras humanas. Para investigación con volúmenes mayores se requiere almacenamiento clínico seguro, control de recursos y procesos autorizados; no copie PHI al chat ordinario. El módulo anatómico general de Kira continúa limitado a planificación desidentificada y diagnóstico del entorno, no a expedientes.

## Reconstrucción de regiones afectadas — piloto de investigación

El flujo de **región afectada** nunca infiere por sí solo un diagnóstico. Parte de TC/RM volumétrica y una o varias máscaras NIfTI de estructuras visibles. Para añadir una posible lesión/área de interés, un profesional debe delinear esa región en una máscara NIfTI **en exactamente la misma rejilla (shape, affine RAS/mm)** que las máscaras del órgano. Si no están registradas, el reconstructor se niega a superponerlas.

Ejemplo usando un conjunto **sintético**, fuera del expediente (para datos reales, seleccionar rutas clínicas autorizadas):

```powershell
node .\scripts\phoenix-anatomy-workbench.mjs reconstruct --input "C:\ESTUDIO-AUTORIZADO\ct.nii.gz" --mask-folder "C:\ESTUDIO-AUTORIZADO\organos" --lesion-mask-folder "C:\ESTUDIO-AUTORIZADO\anotaciones-medico" --output "C:\SALIDA-CLINICA-PRIVADA\caso-001" --modality ct --fast --research-only --view
```

- `--mask-folder` no es obligatorio cuando se configura TotalSegmentator. El motor selecciona la tarea de segmentación soportada y usa el caché de pesos de `PHOENIX_ANATOMY_HOME/models`, compartido con el autoinstalador.
- `--lesion-mask-folder` contiene anotaciones clínicas externas: **no detecta lesiones por sí solo**. Se rechazan etiquetas con nombres personales y vínculos simbólicos.
- `--fast` puede reducir resolución de las **mallas de órganos**; las regiones anotadas conservan resolución completa. No sustituye el estudio original.
- La salida `anatomy.glb` es interactiva, con capas de anatomía y regiones anotadas visualmente diferenciadas. `anatomy-manifest.json` registra procedencia de cada máscara, huella SHA-256, modalidad, número de anotaciones, configuración geométrica y tiempo de reconstrucción. Todos los resultados permanecen como **no validados**.
- En **HealthIA → Anatomía 3D**, seleccionar paciente asignado, adjuntar `anatomy.glb` (hasta 24 MiB) y **opcionalmente** su `anatomy-manifest.json`. HealthIA comprueba la huella GLB antes de guardar un resumen de procedencia cifrado. Las huellas verifican correspondencia de archivos, **no** la autenticidad de una anotación ni su exactitud médica.
- El visor puede mostrar superficies pero **no sustituye** revisar la imagen de origen en cortes axial/sagital/coronal. Modelos de lesiones generados automáticamente o evaluados frente a estándares externos se integrarán únicamente cuando existan pesos, validación por tarea y autorización apropiada.

Pruebas sintéticas: `python scripts/test_phoenix_anatomy_validation.py` y `node --experimental-strip-types --test scripts/phoenix-health-anatomy.test.mjs`.

## Interpretación diagnóstica por modalidad: evidencia primero

**Importante:** PHOENIX no dispone de un modelo universal de diagnóstico por imagen validado. La generación de una malla GLB no demuestra que la TC, RM o ecografía original se haya interpretado.

En **HealthIA → Mi consulta → Interpretación de estudios**, el médico autorizado puede enlazar un JPG, PNG, WebP o PDF previamente cifrado en el expediente, declarar la modalidad original (ECG, ultrasonido/Doppler, RX, TC, RM, laboratorio, citología, histopatología u otra), registrar observaciones directas, hipótesis preliminares y riesgo crítico. Este flujo almacena solo una evaluación provisional del **profesional** y **no** ejecuta IA sobre las imágenes.

- Si el archivo original no fue revisado, el sistema impide registrar hallazgos o una impresión diagnóstica. No convierte una descripción de la IA en evidencia.
- Una imagen o PDF puede ser insuficiente: TC/RM requieren series originales y protocolo, ECG trazado calibrado, ecografía cine/Doppler, patología lámina completa, laboratorio unidades e intervalos.
- Ningún GLB se admite como fuente de un diagnóstico clínico. La visualización anatómica es un resultado derivado, no el examen diagnóstico.
- Cada valoración provisional se vincula al archivo original, se cifra con el expediente y queda accesible solo a médicos asignados. Los eventos quedan auditados; no se comparten imágenes con el LLM del chat por este mecanismo.
- Las respuestas de Kira deben separar datos observados, hipótesis, elementos no evaluados y limitaciones. `health_diagnostic_protocol` ofrece criterios de revisión por modalidad pero **no lee píxeles, no emplea pesos entrenados y no puede identificar lesiones**.
- Ante sospecha de hallazgo crítico se requiere reconocer su valoración clínica inmediata; no se registra como normal de forma silenciosa.
- Para incorporar IA diagnóstica real se necesitan motores aprobados o validados específicamente para cada indicación, entrada DICOM/ECG/WSI adecuada, pruebas externas y locales contra un estándar de referencia y revisión médica antes del uso clínico.

Pruebas: `node --experimental-strip-types --test scripts/phoenix-health-diagnostic.test.mjs` y las pruebas del expediente.

## Catálogo universal de entradas diagnósticas · versión inicial

El catálogo de PHOENIX reconoce **243 tipos de entrada en 20 grupos y 23 familias de protocolos de evidencia**, con búsqueda jerárquica en **HealthIA → Mi consulta → Interpretación de estudios**. Kira dispone de `health_diagnostic_catalog(query, group)` y `health_diagnostic_protocol(modality, sourceType)`; el primer comando descubre el ID y el segundo indica requisitos del estudio fuente. Se incluyen RX, TC, RM, ecografía, medicina nuclear, cardiología, neurofisiología, laboratorio, hematología, microbiología, genética, citología, histología, oftalmología, endoscopia, ORL, odontología, dermatología, fisiología, sueño, obstetricia y escalas clínicas.

- Cuando falta una modalidad, el profesional elige **Otro estudio** y escribe el nombre técnico. No se presume ningún motor ni interpretación automática.
- El catálogo **no amplía los formatos aceptados en los adjuntos clínicos**: PNG/JPEG/WebP/PDF; los GLB se procesan en Anatomía 3D. Datos nativos DICOM, EDF, WSI, VCF/FASTQ, HL7/FHIR, ECG digital y vídeos requieren conectores y validación específicos, todavía no incluidos.
- Reconocer una modalidad **no implica tener un algoritmo diagnóstico**. Los protocolos son listas de evidencia, no clasificadores médicos ni pesos entrenados; jamás afirman diagnóstico clínicamente validado.
- Antes de registrar una interpretación, un médico autorizado debe verificar los hallazgos en el estudio fuente, indicar dudas y urgencia. La aplicación conserva el vínculo al archivo fuente dentro del expediente cifrado.
- Futura integración de detectores: por indicación y modalidad exacta, con datos originales y controles de calidad, pesos/versiones reproducibles, calibración y validación externa contra estándar de referencia. No declarar que funcionan por tener una casilla marcada.

Pruebas: `node --experimental-strip-types --test scripts/phoenix-health-diagnostic.test.mjs scripts/phoenix-health-diagnostic-catalog.test.mjs`.
