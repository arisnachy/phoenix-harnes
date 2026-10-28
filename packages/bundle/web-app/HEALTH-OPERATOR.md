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

## Límites de la entrega

- No es todavía un EHR certificado ni un sistema sanitario homologado en República Dominicana.
- No hay visores DICOM, dispositivos LIS/RIS/PACS, facturación ARS, integración de caja externa, telemedicina ni recuperación ante desastres probada.
- La historia clínica no está aún conectada de extremo a extremo con el razonamiento de Kira. El modelo no puede leerla directamente ni producir prescripciones firmadas.
- Correo real limitado a recordatorios explícitamente aprobados, con Gmail institucional validado; no hay cron automático ni acceso remoto del paciente.
- Antes de cualquier despliegue clínico en producción se necesitan pruebas end-to-end con autorización y aislamiento multiinstitucional, verificaciones de seguridad, protección de datos conforme a RD y revisión de responsabilidad profesional.

## Verificación

```powershell
node --experimental-strip-types --test packages/core/tool-health/tests/*.test.mjs packages/bundle/web-app/tests/health-store.test.mjs
```

Verificar en GitHub las puertas de construcción, typecheck, Windows y tests del HEAD del PR #1192. No declarar el PR listo para `main` o `stable` si hay verificaciones pendientes o fallidas.
