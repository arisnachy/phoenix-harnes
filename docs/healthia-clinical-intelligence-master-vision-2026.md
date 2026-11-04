# PHOENIX HealthIA — Arquitectura integral de inteligencia clínica, documental, familiar y educativa

**Versión del diseño:** 2026-11-04 — **Estado:** especificación y hoja de ruta, no implementación validada.

**Premisa:** PHOENIX es un harness universal; HealthIA es su motor sanitario. La biblioteca, fábrica de herramientas, interfaz conversacional, conectores y automatizaciones son servicios reutilizables para todas las verticales. Los datos sanitarios y decisiones asistenciales permanecen en un dominio especialmente protegido.

## 1. La experiencia clínica que queremos

El médico dice «Kira, tengo un paciente» y aparece **una tarjeta segura dentro del chat**, no una interrogación textual interminable. La tarjeta localiza posibles pacientes existentes, captura datos, pide consentimiento cuando procede, permite revisar/editar y confirma lo que realmente fue guardado en la historia clínica autorizada. Al iniciar la visita muestra antecedentes pertinentes, plan previo, órdenes pendientes, medicamentos, alergias y seguimiento. Cada etapa entrega solamente los controles que hacen falta; un botón abre vista completa si se necesita. La interfaz tradicional queda como respaldo operativo, no como camino principal.

La tarjeta tiene un ciclo de vida: **propuesta → mostrada → borrador → validada → revisada → firmada/guardada**. El modelo puede proponer contenido, pero la interfaz protegida envía datos identificables **directamente al servicio clínico**, fuera del prompt y de la memoria de agentes universales. El comprobante de guardado viene del backend, con ID, versión y autor; jamás de una frase del modelo.

## 2. Registro de pacientes y cédula de RD

Identificador de paciente interno inmutable; documento, email y teléfono **no** son la clave principal. Se admiten números familiares compartidos, documentos múltiples, pacientes menores con representantes, identificadores temporales, deduplicación y cola de revisión. Priorizar coincidencia documental; nombre completo + fecha de nacimiento y otros datos producen alerta de **posible** duplicado. No fusionar expedientes automáticamente. Respetar organizaciones, relación asistencial y permisos.

Los campos se agregan/ocultan mediante plantillas declarativas, con ID, tipo, etiqueta, obligatoriedad, normalizador autorizado, visibilidad condicional, versión, pruebas, controles de privacidad y autorización. Kira propone cambios de esquema y muestra un diff antes de publicarlos. Cada nuevo campo puede llamar **solo funciones declaradas y autorizadas**: formatear teléfono, calcular edad, verificar un dato con un proveedor habilitado, consultar cobertura ARS. No se ejecutan scripts libres del LLM.

En RD se encontró el servicio OGTIC **Cedula Validation** (`GET /citizens/{id}/validate`), sin confirmar que devuelva todos los datos biográficos; tampoco se verificó el supuesto endpoint de MIREX. Un adaptador debe identificar exactamente el proveedor, contrato, campos permitidos, costo, consentimiento y procedencia. No usar portales de terceros que expongan fotografías, direcciones o datos personales mediante scraping no autorizado.

## 3. Historia clínica longitudinal profesional

Formularios adaptativos y reutilizables:

- **Consulta:** motivo, evolución de enfermedad actual, fechas, dolor, síntomas positivos, negaciones explícitas, factores agravantes/aliviantes y signos de alarma.
- **Antecedentes personales patológicos:** enfermedades, hospitalizaciones, cirugía, alergias, transfusiones, traumatismos, antecedentes farmacológicos, dispositivos, vacunas, comorbilidades y tratamiento actual con conciliación.
- **No patológicos:** hábitos, tabaco, alcohol, sueño, alimentación, actividad física, ocupación, exposiciones, vivienda, agua/saneamiento y soporte social.
- **Revisión por sistemas** con módulos según edad, especialidad, motivo; distinguir «no preguntado» de «negado».
- **Gineco-obstétricos:** menarquia, ciclos, FUM, G/P/A/C o TPAL según configuración, embarazos previos, partos, cesáreas, pérdidas, nacidos vivos, anticoncepción, lactancia, complicaciones y gestación actual. Edad gestacional/FPP con método, fecha fuente y reglas ACOG; ecografía temprana tiene prioridad en circunstancias especificadas.
- **Pediatría:** nacimiento y gestación, percentiles y crecimiento por referencia adecuada, vacunación, desarrollo, neurodesarrollo, alimentación, pubertad, familia y escuela.
- **Geriatría/funcionalidad:** cognición, caídas, ADL/IADL, fragilidad, polifarmacia, cuidadores, riesgos del hogar.
- **Discapacidad y salud mental:** diagnósticos confirmados, instrumentos validados, intervenciones, objetivos de funcionalidad, adaptaciones y seguimiento.
- **Signos vitales y exploración:** medidas reales con fecha/unidad/autor, comparación y visualización longitudinal; exploración por sistemas documentada por el profesional.

Cada hallazgo posee `source`, `observedAt`, `enteredBy`, `verifiedBy`, `confidence/status`, `encounterId` y revisión. La interfaz permite examinar la fuente y comparar cambios con consultas anteriores.

## 4. Kira como redactora clínica, nunca inventora de hallazgos

**Pipeline:** nota original → extracción de información expresada → normalización terminológica y cronológica → narrativa profesional → comprobación de contradicciones → propuesta de diagnósticos diferenciales y preguntas faltantes → revisión médica → firma.

Ejemplo fuente: «motivo cefalea mareos; tiene dolor 3 días, náuseas, vómitos de contenido alimentario, fiebre 3 días».

**Salida aceptable:** «Motivo: cefalea y mareos. Historia de la enfermedad actual: paciente refiere cefalea de tres días de evolución, asociada a sensación de mareo, náuseas, vómitos de contenido alimentario y fiebre referida durante el mismo período. No se documentan localización, intensidad, signos neurológicos ni temperatura medida». Ofrecer preguntas sobre signos de alarma y urgencia de evaluación si procede.

**Salida prohibida:** «Examen físico normal», «sin rigidez nucal», «diagnóstico confirmado de X» o tratamiento administrado si ninguno de esos hechos fue documentado. Hipótesis y sugerencias se almacenan separadas del diagnóstico o plan confirmado. Permitir aceptar, editar, descartar y anotar justificación.

## 5. Calculadoras y prescripción farmacológica

La IA puede **invocar calculadoras deterministas versionadas**, no inventar números. Registro de herramientas: IMC adulto, antropometría/percentiles pediátricos OMS/CDC, presión arterial media, TFG según indicación, superficie corporal, escalas y scores clínicos validados, edad gestacional y FPP, curvas prenatales, cálculos de rehabilitación.

**Pediatría:** peso realmente registrado en **kg**, edad, indicación, medicamento, dosis específica por indicación y ficha técnica, fórmula mg/kg/dosis o mg/kg/día claramente distinguida, frecuencia, máximo, vía, concentración mg/mL, conversión a mL, redondeo, función renal/hepática, alergias/interacciones y verificación final del profesional. Registrar fuente y versión farmacológica; abstenerse si faltan datos. No emitir receta automáticamente a partir de la masa corporal.

**Receta premium:** membrete y licencia, identidad verificada, fecha, medicamento genérico/marca cuando procede, presentación, concentración, dosis, vía, frecuencia, duración, cantidad e instrucciones; firma profesional válida, ID, estado y QR de verificación que no exponga datos médicos. Preview en el chat; imprimir/exportar PDF/entregar digital con permiso y consentimiento. También órdenes de imagen/laboratorio, resultados, incapacidades, certificados, derivaciones y resúmenes clínicos.

## 6. Archivo universal PHOENIX + bóveda clínica separada

Biblioteca PHOENIX universal: documentos, imagen, audio, videos, juegos, modelos 3D, proyectos, presentaciones, código, herramientas y plantillas; propietario, etiquetas, versión, origen, colecciones, permisos, índice, búsqueda, respaldo y restauración.

**HealthIA Clinical Vault:** partición cifrada y con autorización propia: Institución → Paciente → Episodio → Notas, recetas, órdenes, resultados, imágenes, consentimientos, facturas y documentos. El mismo objeto clínico no debe duplicarse en el chat u otro HealthIA de distinto almacén.

Soporte archivos PDF, fotos y DICOM; OCR con valor/unidad/fuente pendientes de revisión; recuperación con índice textual local y, si procede, búsqueda semántica autorizada/local. Nunca producir embeddings externos de información sanitaria por defecto. Exportar expediente completo o parcial en PDF imprimible + paquete FHIR (`Composition` / `Bundle` / `DocumentReference`) con manifiesto, firma, adjuntos, fecha y permisos. Los documentos firmados deben ser inmutables o admiten adendas auditadas.

El **Context Broker** entrega a Kira solo la información mínima aprobada y devuelve resultados de búsqueda autorizados sin revelar PHI a modelos no habilitados.

## 7. Imágenes médicas, informes y educación

Visor DICOMweb con OHIF/Cornerstone: RX, US, TC, RM, ECG y fotografía clínica; zoom, orientación, ventanas, medidas, anotaciones, evolución, visualización comparada. Distinguir modos:

1. **Almacenamiento/organización:** captura, OCR, clasificación, metadata, revisión.
2. **Docencia:** explicar anatomía, técnicas, planos, artefactos y señalizaciones sobre imágenes didácticas con bibliografía.
3. **Análisis clínico:** detección/interpretación asistida solo cuando el modelo y la indicación estén evaluados/validados, mostrando límites y requiriendo revisión profesional. La interpretación diagnóstica de imagen puede tener exigencias regulatorias de software sanitario.

## 8. Auditoría médica, glosas y preparación internacional

Motor de reglas por aseguradora/jurisdicción/contrato y versión, no una plantilla idéntica para todo el mundo. El flujo es: encuentro documentado → requisitos del pagador → evidencia existente → faltantes reales → preguntas para el médico/paciente autorizado → preparación de anexos → revisión y firma → envío oficial → acuse → respuesta/glosa → conciliación → apelación si procede.

**RD:** reglas de SISALRIL y ARS/IDOPPRIL, contratos, plan/cobertura, procedimiento, autorizaciones, códigos y plazos. Considerar normativa de auditoría médica y glosas aplicada en 2026, pero las reglas deben mantenerse actualizadas.

**EE. UU.:** interoperabilidad/PA mediante HL7 Da Vinci CRD/DTR/PAS y X12 cuando corresponda; para veteranos, recopilar evidencia y formularios oficiales DBQ, distinguiendo condiciones actuales, antecedentes y nexo exigible para distintos reclamos. No inventar evidencia ni asegurar aprobación/«cero glosas». Cualquier envío automático requiere autorización, canal habilitado, firma, acceso y comprobante.

## 9. Genograma, ecomapa y visita domiciliaria

Genograma de 3+ generaciones con relaciones biológicas, adoptivas, de convivencia y tutela **separadas**; estructura de parentescos, personas fallecidas, consanguinidad, embarazos, enfermedades, edad de inicio, factores hereditarios, varias personas afectadas, simbología de pedigree de NSGC. Un vínculo familiar no confiere automáticamente permiso para ver una historia clínica ajena.

Ecomapa familiar y redes de apoyo: centro médico, escuela, trabajo, cuidadores, rehabilitación y recursos sociales, vínculos y apoyos. Croquis del hogar con barreras, accesibilidad, saneamiento, riesgos de caídas, habitaciones/cuidadores, fecha de visita y contexto social; editable y exportable PDF/SVG. Compartición por consentimiento y propósito, resguardo reforzado de terceros.

## 10. HealthIA para pacientes, discapacidad y familia

El paciente puede cargar informes, consultar su propia historia autorizada, llevar síntomas y medicamentos, entender resultados con su fuente, pedir atención y preparar preguntas para el médico; puede recibir orientación educativa y alertas de evaluación profesional, **no prescripciones automáticas**. Para familias con discapacidad/neurodesarrollo: seguimiento de terapias, escuela, objetivos, instrumentos validados, novedades científicas con calidad de evidencia, trámites de apoyos y cuidados con permisos de tutores. Para niños, consentimientos y protección especiales.

## 11. Modo tutor médico y productor multimedia

Kira explica guías, técnicas, lectura de ecografía, radiografía, laboratorio, epidemiología y procedimientos con bibliografía; hace preguntas, casos sintéticos y evaluación de competencias. Genera charlas, clases, presentaciones editables, notas para expositor, voz/narración cuando el servicio esté disponible y materiales educativos para pacientes. No utilizar imágenes ni historias de pacientes reales en cursos sin autorización específica/desidentificación suficiente. El conocimiento se conserva en la biblioteca PHOENIX con atribución y control de versiones.

## 12. Fábrica universal de herramientas inteligentes

Toda herramienta tiene manifest firmado/validado con `id, version, owner, scope, input/output schema, roles, consent, costs, reference sources, tests, UI template, audit policy` y estados **propuesta → pruebas en sandbox → revisión profesional → aprobada → activa → retirada**. Kira puede proponer nuevos inputs, calculadoras, documentos, e integraciones; herramientas no verificadas no ejecutan código arbitrario ni modifican prescripciones o expedientes firmados. La plantilla permanece en la biblioteca como activo reutilizable. Cargos externos y cuota mensual siempre visibles con límites y aprobación previa.

## 13. Mapa técnico y criterios de seguridad

**PHOENIX Core (universal):** motor de conversación, tarjetas/UI, biblioteca general, permisos de herramientas, fábrica de capacidades, vault de conectores, workflows, observabilidad y búsqueda autorizada.

**HealthIA (dominio sanitario):** Identity Master, Clinical Context Broker, Forms/SDC, Longitudinal Record, Clinical Copilot, Medication/Orders/Results, Document Factory, Clinical Vault, Payer Rules, Family Graph, Telehealth, Educational Mode y API FHIR/HL7/DICOM.

**Estándares:** FHIR R4 con Questionnaire/Response y SDC, Composition/Bundle/DocumentReference, Provenance/AuditEvent, SMART on FHIR, DICOMweb, LOINC/SNOMED/CIE con licencias aplicables, catálogo de fármacos validado y vocabulario local.

**No negociables:** no inventar examen físico/diagnósticos, no mezclar pacientes, no tratar contacto como identidad, no convertir IA sugerida en orden firmada, no enviar datos médicos a herramientas no autorizadas, revisión profesional de dosis, alertas críticas, firma auditada, copias restaurables y pruebas con pacientes sintéticos antes de datos reales. El motor no es aún un producto sanitario clínicamente validado.

## 14. Prioridad de entregas

| Etapa | Entrega comprobable | Resultado para el usuario |
|---|---|---|
| P0 | Identidad única, esquema y almacenamiento canónico, Clinical Context Broker, permisos | No duplica historias ni expone PHI |
| P1 | Tarjetas clínicas reales en el chat, antecedentes adaptativos, vitales y SOAP fiable | Una consulta completa sin navegar 12 menús |
| P2 | Registro de herramientas reutilizables, calculadoras verificadas, recetas y certificados imprimibles | Kira produce acciones clínicas útiles y seguras |
| P3 | Biblioteca universal y bóveda clínica, búsqueda, PDF/FHIR, adjuntos, OCR revisable | Todo organizado, recuperable y exportable |
| P4 | Pacientes/portal, contactos y consentimientos, telemedicina, pagos y finanzas | Consultorio autónomo viable |
| P5 | ARS/VA/Da Vinci, glosas, sistemas médicos existentes, genogramas, imágenes | Interoperabilidad y auditoría asistida |
| P6 | Educación, multimedia, familia/discapacidad, desarrollo de herramientas por agente | Ecosistema sanitario completo y expandible |

Los hitos no implican que todas las funciones estén construidas hoy. El primer obstáculo a resolver es **unificar de forma segura el chat HealthIA y el expediente profesional /health**: no son aún el mismo almacén de pacientes.

## Referencias principales

- OGTIC Cedula Validation: https://developer.digital.gob.do/apis/ff9ce928-e16e-4ea9-9ce9-28e16e1ea96e
- HL7 SDC: https://hl7.org/fhir/uv/sdc/
- HL7 FHIR Documents R4: https://hl7.org/fhir/R4/documents.html
- SMART App Launch: https://www.hl7.org/fhir/smart-app-launch/app-launch.html
- FHIR FamilyMemberHistory: https://hl7.org/fhir/R4/familymemberhistory.html
- OHIF: https://docs.ohif.org/
- SISALRIL auditoría 2026: https://www.sisalril.gob.do/sisalril-pone-en-marcha-la-normativa-de-auditoria-medica/
- HL7 Da Vinci DTR: https://hl7.org/fhir/us/davinci-dtr/
- VA DBQ: https://www.benefits.va.gov/compensation/dbq_publicdbqs.asp
- FDA CDS Guidance: https://www.fda.gov/regulatory-information/search-fda-guidance-documents/clinical-decision-support-software
- CDC crecimiento: https://www.cdc.gov/growthcharts/index.htm
- ACOG datación gestacional: https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2017/05/methods-for-estimating-the-due-date
- NSGC pedigree 2008/2022: https://pubmed.ncbi.nlm.nih.gov/18792771/ ; https://pubmed.ncbi.nlm.nih.gov/36106433/