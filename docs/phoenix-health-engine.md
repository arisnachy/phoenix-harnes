# PHOENIX Health Engine / Clinical Flow (fase inicial)
El motor **es un plugin adicional de PHOENIX**, nunca un reemplazo de Kira, Eclipse, Business, Sports ni de sus sesiones.

## Estado exacto
Esta primera entrega implementa **solo** una base determinista de flujo clínico, interrogatorio sugerido y preflight de correo. Los dos comandos de Kira son **de planificación**. No existe todavía un EHR, base de pacientes, panel clínico, portal seguro, envío real, integración LIS/RIS/PACS, farmacia, agenda sincronizada o recetas electrónicas. No apto para usar con pacientes reales.

## Experiencia prevista
1. Kira abre un episodio bajo una organización, sede y profesional autenticados; busca al paciente en el repositorio clínico aislado.
2. Solicita motivo de consulta mediante pregunta en el chat. El profesional elige **Kira dirige**, **profesional dirige** o **mixto**.
3. Interrogatorio adaptativo con control de ausencias y alertas, antecedentes y examen realizado por el profesional; no inferir negativos.
4. Kira prepara historia clínica estructurada, diferenciales, diagnósticos propuestos, indicaciones, análisis y receta como **borradores**; el profesional decide, corrige y firma.
5. Estado clínico: opened → interviewed → drafted → reviewed → signed → closed. Editar después de revisión invalida esa revisión.
6. El episodio firmado se archiva en el expediente segregado; las órdenes pasan por sus propias validaciones y flujos.
7. Cierre: propuesta de cita y recordatorio, entrega segura de documentos firmados y seguimiento de resultados.
8. El profesional puede activar/desactivar cada ayuda; los módulos de especialidad modifican plantillas, no la política de permisos.

## Correo propio de Kira
- Usar una cuenta institucional real controlada por el operador, por ejemplo una identidad Gmail Workspace **verificada**, conectada al broker ya existente de PHOENIX mediante OAuth. Nunca inventar un correo ni suplantar un remitente. La conexión Gmail del usuario no demuestra que la cuenta de Kira exista.
- Separar una identidad remitente por organización/sede y persistir credenciales **solo** en el almacén del Host. No exponerlas a prompts.
- El adaptador envía notificaciones neutras que enlazan a un portal seguro con sesión/autenticación, vencimiento y registro de accesos; no adjuntar por defecto recetas o resultados sensibles en texto plano.
- Requisitos antes de encolar: senderConnected, senderVerified, recipientVerified, patientConsent, clinicianSigned, clinicianAuthorizedSend, securePortalReady e idempotencyKeyPresent. El transporte debe verificar todo **otra vez al enviar**, usar idempotencia y recibir acuse real del proveedor.
- Para recordatorios de cita, plantillas mínimas sin diagnóstico; cancelación de consentimiento y política local de contacto.
- Gmail **no se invoca** en esta primera entrega: `health_kira_mail_preflight` solo calcula el estado de bloqueo.

## Contratos en uso
- `health_interview_plan`: hasta cuatro preguntas pendientes basadas en el motivo genérico, especialidad y modalidad. No incluir nombres, identificadores ni texto libre que revele a un paciente real.
- `health_kira_mail_preflight`: lista los ocho requisitos y nunca manda correo.
- `advanceEncounter`: función pura de estados para **futuro** servicio con transacciones, control de versiones, autorización granular, auditoría y firma digital.

## Próximas puertas para producción
Persistencia transaccional cifrada con aislamiento multiorganización, roles+atributos, consentimiento, auditable append-only, retención y recuperabilidad; FHIR R4 (Patient, Encounter, ClinicalImpression, Observation, ServiceRequest, MedicationRequest, DocumentReference, Appointment, Task); adaptadores de laboratorio e imágenes DICOMweb; farmacia, cuenta institucional de Kira, cola y portal. Requiere revisión normativa y clínica, evaluaciones de seguridad, simulaciones sintéticas y pruebas end-to-end antes del acceso a datos de pacientes.

## Pruebas
```sh
node --experimental-strip-types --test packages/core/tool-health/tests/clinical-flow.test.mjs
```
