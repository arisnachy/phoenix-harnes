# HealthIA: catálogo maestro de capacidades y plan de adopción

**Estado:** arquitectura de producto y lista de aceptación; no implica que estas funciones estén implementadas. **Última revisión:** 2026-11-03.

## Alcance invariable

PHOENIX es un harness de IA universal y modular. **HealthIA es un motor especializado**; todo control de datos asistenciales debe vivir en HealthIA y utilizar solo las interfaces del harness que sean necesarias. No se convierte PHOENIX Core en un producto exclusivamente médico.

Se revisaron como referencias públicas Epic, Oracle Health, MEDITECH, athenaOne, eClinicalWorks, NextGen, ModMed, Practice Fusion, OpenEMR, OpenMRS, Bahmni, GNU Health, InterSystems, Dedalus, MV, Practo, Docplanner y otros proveedores. Las capacidades dependen de edición, licencia, país y configuración. No copiar interfaces propietarias. El análisis completo por plataforma se mantiene en el documento de investigación PHOENIX HealthIA Benchmark Global de 2026-11-03.

## Catálogo de dominios — 23 grupos de trabajo

| Dominio | Objetivo de aceptación | Estado |
|---|---|---|
| 01. Identidad y maestro de pacientes | Relación asistencial, homónimos, búsqueda y conciliación sin duplicados | Parcial |
| 02. Agenda y recepción | Turnos, colas, recordatorios, ausencias, reprogramación | Parcial |
| 03. Admisión clínica | Registro presencial, paciente, profesional, enfermería, Kira | Parcial |
| 04. Consulta y documentación | SOAP, entrevista, signos, codificación, revisión y firma | Parcial |
| 05. Continuidad longitudinal | Un paciente, problemas, encuentros, evidencias, órdenes y resultados | Parcial |
| 06. Farmacoterapia | Conciliación, alergias, dosis, interacciones, renovaciones y prescripción segura | Parcial |
| 07. Laboratorio | Solicitud, muestra, resultado, revisión, comunicación y seguimiento | Parcial |
| 08. Imágenes y documentos | Captura, cifrado, extracción revisable, informe y PACS | Parcial |
| 09. Interconsultas | Referencias, contrarreferencias y cierre de coordinación | Pendiente |
| 10. Portal de paciente | Cuenta, representante, consentimiento, trámites y documentos | Pendiente |
| 11. Telemedicina | Identificación, preconsulta, pago, video, documentación y seguimiento | Pendiente |
| 12. Facturación y ARS | Tarifario, cobro, cartera, reclamaciones, glosas y e-CF | Parcial |
| 13. Finanzas | Libro mayor, conciliación, gastos, presupuesto y rentabilidad | Pendiente |
| 14. Farmacia e inventario | Lotes, caducidad, dispensación, compras y trazabilidad | Parcial |
| 15. Hospitalización | Admisión, camas, enfermería, cirugía, alta, urgencia y quirófano | Pendiente |
| 16. Especialidades | Plantillas clínicas validadas por cada ámbito asistencial | Pendiente |
| 17. Población y calidad | Indicadores, población, cohortes, prevención y reportes | Pendiente |
| 18. Copiloto Kira | Investigación con fuentes, contexto autorizado y borradores con supervisión | Parcial |
| 19. Interoperabilidad | FHIR R4, SMART, HL7 v2, DICOMweb y adaptadores locales | Pendiente |
| 20. Seguridad y gobierno | Autenticación, autorización, auditoría, copias, restauración y consentimiento | Parcial |
| 21. Operaciones y UX | Consultorio unipersonal, equipos, rendimiento y resiliencia | Parcial |
| 22. Sitio profesional y presencia digital | Web premium, alojamiento, dominio, agenda y precio mensual controlado | Pendiente |
| 23. Investigación clínica | Evidencia, cohortes desidentificadas y evaluación de calidad | Pendiente |

Los estados "Parcial" no acreditan aptitud para uso clínico real.

## Flujo que debe poder completar un médico sin auxiliares

1. Identificar a la persona sin exigir cuenta o teléfono, impedir duplicados y comprobar permisos.
2. Crear y consultar expediente longitudinal con fuente, tiempo y autor.
3. Revisar plan previo, medicaciones, alergias, resultados y pendientes.
4. Documentar signos y valores numéricos con unidades; nunca asumir datos faltantes negativos.
5. Revisar fotografías o PDF aportados presencialmente, con procedencia y autoría.
6. Abrir encuentro, documentar SOAP, investigar de forma consentida y preparar órdenes/recetas.
7. Firmar decisiones como profesional, entregar instrucciones y registrar seguimiento.
8. Conciliar la facturación, los cobros y las tareas de resultados sin perder casos abiertos.

## Corte de entrega actual — continuidad clínica del piloto local

Se añade una **proyección del expediente clínico por paciente** a partir de la base cifrada y autenticada del piloto. La UI ya no necesita combinar todos los registros organizacionales en el navegador para componer su vista de consulta.

Se incorpora registro de **observaciones numéricas** con fuente, fecha, unidad, intervalo de referencia opcional, vínculo a documento cuando se transcriben y estado pendiente de verificación. El médico verifica explícitamente la cifra; solo las verificadas aparecen en la tendencia resumida. Se permite marcar una fotografía o PDF como leído por el médico, sin confundir esa lectura con su validación diagnóstica.

**No se ha fusionado físicamente** el almacén propietario del servicio `ctx.healthia` y el SQLite del piloto `/health`. Se necesita un adaptador explícito de identidad, consentimiento, migración y transacciones antes de proclamar fuente de verdad unificada. Queda prohibido sincronizar expedientes mediante identificadores/nombres coincidentes o por chat.

## Gate de seguridad y calidad

- Permisos de lectura/escritura por paciente, profesional y organización.
- Pruebas de acceso denegado entre médicos y datos cifrados.
- Firma clínica y revisión de medicamentos con reglas que no pueda omitir la UI.
- Trazabilidad de cada documento y resultado, incluida la fuente.
- Nada de resultados OCR automáticos como hechos confirmados.
- Sin exposición de PHI al chat general, conectores o correo sin autorización explícita.
- Copias restaurables y pruebas en Windows; evaluación normativa antes de datos reales.
- La adopción requiere pruebas con pacientes ficticios en todo el recorrido, no solo compilación.

## Entregas siguientes, con salida verificable

1. Maestro de identidades y migración clínica compatible con `ctx.healthia`, sin duplicación de fuentes.
2. Catálogo de condiciones y episodios por problema, medicación estructurada y conciliación.
3. Circuito cerrado de órdenes, informes, revisión, comunicación, tareas y confirmación.
4. Extracción local OCR de informes con verificación en pantalla y validación de unidades.
5. Paciente Connect, cuenta/representante, QR de carga temporal, sala de video y cobro.
6. Operación autónoma financiera, ARS, inventario y catálogo farmacológico validado.
7. FHIR/SMART/HL7/DICOMweb con puente local y proveedores autorizados.
8. Operaciones multiprofesionales y hospitalización por fases.

**No afirmar que los 23 dominios, ni las 363 capacidades candidatas del benchmark, están implementados.**
