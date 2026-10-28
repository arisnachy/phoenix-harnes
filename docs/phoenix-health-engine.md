# PHOENIX Health Engine / Clinical Flow (piloto)

English | [中文](phoenix-health-engine.zh.md)

PHOENIX Health es un módulo **opcional** del Host. No sustituye a Kira, Eclipse ni a los demás motores. Su interfaz clínica local está deshabilitada por defecto y **no está aprobada para atender pacientes reales**.

## Estado implementado

- `PHOENIX_HEALTH_ENABLED=1` habilita `/health` únicamente cuando el Host escucha en `127.0.0.1`.
- El expediente usa SQLite persistente con contenidos clínicos cifrados mediante AES-256-GCM, versiones y auditoría encadenada por HMAC. El archivo SQLite y los metadatos no están cifrados por completo.
- La clínica exige autenticación local de personal, roles, CSRF, permisos por organización y asignación explícita de equipo asistencial por paciente.
- Admite episodios, documentación SOAP, revisión y firma registrada, recetas, solicitudes y resultados, inventario transaccional, agenda, caja y seguimiento.
- El consentimiento de comunicaciones requiere evidencia y puede revocarse; una marca de verificación aislada no equivale a consentimiento.
- Las copias locales usan backup consistente de SQLite y verificación de integridad; no reemplazan respaldos cifrados externos ni recuperación formal de claves.
- Gmail permite únicamente recordatorios neutros y autorizados, después de verificar el perfil real de la cuenta remitente; no adjunta datos clínicos.

## Flujo profesional y ASK

1. El profesional accede al portal clínico y a un paciente asignado bajo una sesión autenticada.
2. Kira propone preguntas genéricas con `health_interview_plan` y `health_copilot_ask`; el ASK existente pregunta si guía Kira, el profesional o ambos.
3. ASK marca las preguntas como sensibles y no confirma respuestas automáticas, caducadas o ausentes; los datos clínicos reales se introducen en el expediente protegido.
4. El profesional documenta el episodio en SOAP y verifica antecedentes, alergias, urgencias, exploración y resultados. La IA no puede inventar negativos.
5. Las órdenes, recetas y notas requieren los controles y revisiones del servidor; la firma queda ligada a la versión revisada.
6. La agenda y los recordatorios se ejecutan solo cuando se cumplen permisos, evidencias de consentimiento e identidad del remitente.

## Límites de seguridad y producción

- `health_copilot_ask` no lee ni envía datos identificables del expediente a modelos; falta un broker seguro de contexto clínico con permisos y consentimiento.
- La revisión de alergias, dosis e interacciones exige atestación humana; no existe aún un catálogo farmacológico de República Dominicana validado automáticamente.
- Faltan verificación de licencia e identidad profesional, firma electrónica legal, pruebas E2E reales de navegador, auditoría independiente y validación clínica y jurídica.
- Faltan conexiones FHIR/HL7, LIS, PACS/DICOMweb, ARS, portal paciente seguro, redundancia y recuperación formal fuera del equipo.
- La activación para uso real exige seguridad, privacidad, pruebas y autorizaciones normativas adicionales; **el PR #1192 no constituye certificación de producción**.

## Activación para ensayos sintéticos

```powershell
$env:PHOENIX_HEALTH_ENABLED = "1"
pnpm phoenix
```

Consulte `packages/bundle/web-app/HEALTH-OPERATOR.md` para los controles del piloto. No use información real de pacientes hasta completar la validación.
