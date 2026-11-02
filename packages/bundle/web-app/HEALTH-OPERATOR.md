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
