# PHOENIX Genesis + Fabric — Plan maestro integral v4.0

**Estado:** propuesta técnica y organizativa sustentada en referencias de OMS, SNS, MSP, DIGEPRES y DGCP; **no implementado** ni certificado como sistema hospitalario.  
**Elaboración:** 4 de noviembre de 2026 (RD).  
**Ámbito inicial:** hospital público, privado o mixto en República Dominicana; extrapolable a otros países y sectores.  
**Principio de alcance:** la configuración, áreas aplicables, formularios y obligaciones dependen del tamaño, nivel de atención, naturaleza jurídica, habilitación, contratos y autoridades competentes. No declarar automáticamente que una obligación aplica a todas las instituciones.

> **Misión:** Genesis entiende la institución como un sistema físico, humano, clínico, administrativo, financiero y normativo; crea su gemelo organizacional respaldado por evidencia, recomienda tecnología y talento; Fabric conecta sus instancias y acumula hechos verificables; la inteligencia institucional transforma esos hechos en decisiones, PEI, POA, procedimientos operativos estandarizados (POE), presupuesto, informes y rendición de cuentas.

## 0. Continuidad: todo lo acordado anteriormente permanece

Este documento agrega **Inteligencia Institucional y Gobierno de Datos** al diseño v3; no reemplaza Genesis Discovery, Evidence Engine, Organization Graph, Organization Compiler, Universal Bridge, Deployment Architect, Model Fleet Manager, Adaptive UI, Fabric Orchestrator ni Digital Twin. Preserva los modos **capa sobre HIS**, **híbrido**, **PHOENIX integral** y **migración progresiva**. El texto íntegro de v3 se conserva al final como **Anexo A** para que no se pierdan detalles del plan previo.

La solución distingue seis dimensiones conectadas: 1) mapa físico; 2) mapa organizacional y RRHH; 3) mapa de procesos, normas y comités; 4) mapa tecnológico; 5) mapa jurídico, financiero e institucional; y 6) mapa de datos, indicadores, planeación y decisiones.

**POA** = Plan Operativo Anual; **PEI** = Plan Estratégico Institucional. En este diseño **POE** se toma como *Procedimiento Operativo Estandarizado*; si una institución lo utiliza para otro documento, su glosario local debe declararlo sin mezclar conceptos. El plan operativo estratégico debe vincularse explícitamente con PEI/POA y no sustituir el catálogo de POE.

## 1. Qué debe construir Genesis antes de instalar más PHOENIX

1. **Mandato y alcance legal:** patrocinador, naturaleza pública/privada/mixta, cartera de servicios, unidades habilitadas, autoridades, fines de procesamiento de datos, delegaciones y límites de automatización.
2. **Fuentes documentales y entrevistas:** planos arquitectónicos/eléctricos/redes, contratos, organigramas, manuales de puestos, currículos bajo custodia, nómina controlada, inventario de equipos y mobiliario, POA/PEI previos, POE, reportes, estados financieros, bases de datos y documentos de auditoría.
3. **Verificación en campo:** confirmar que cama, equipo, persona, función, contrato o sistema realmente existe y se encuentra operativo; distinguir plano as-built de proyecto, unidad nominal de unidad habilitada, plaza aprobada de persona activa.
4. **Catálogo AS-IS:** sedes y edificios, puestos y turnos, servicios, activos y mantenimientos, sistemas existentes, procesos, obligaciones, comités y mapas de flujo paciente/datos/insumos.
5. **Mapa de brechas y riesgos:** faltantes físicos, humanos, de procesos, seguridad, licencias, integración, calidad de información y continuidad; con prioridad, gravedad, costo y dueño.
6. **Modelo TO-BE:** organización y servicios futuros, interfaces por jefatura, puestos de trabajo, movilidad, PHOENIX lógicos, nodos persistentes, modelo de costos y gobernanza.
7. **Integración universal autorizada:** APIs/estándares primero, archivos y eventos después, lecturas autorizadas de bases y RPA supervisado al final; pruebas de reconciliación, versionado, idempotencia y reversibilidad.
8. **Presupuestos y planes:** costos iniciales y recurrentes; PEI/POA, PAC según normativa vigente, proyectos de infraestructura, dotación, capacitación y cronograma.
9. **Prueba real de colaboración:** Consulta → Farmacia → Enfermería, Admisión → Camas → Limpieza, Compras → Almacén → Finanzas, etc.; con simulación y autorización profesional.
10. **Operación y cambio continuo:** seguimiento de KPIs, análisis de desviaciones, reportes, actas, acciones correctivas, actualización de contratos y reconfirmación del catálogo institucional.

## 2. Inventario exhaustivo de áreas y responsables de información

Una institución pequeña fusionará varios servicios; un hospital complejo puede añadir más subespecialidades. Este es **un inventario base**, no una lista universal de departamentos obligatorios. Genesis activa solo los que existen o han sido aprobados.

### 2.x Gobierno y estrategia

| Unidad o proceso | Datos esenciales que recoge | Tableros e informes derivados |
| --- | --- | --- |
| Consejo y dirección general | Actas, resoluciones, misión, objetivos, riesgos y decisiones | PEI, POA, memoria, cuadro integral de mando |
| Planificación y desarrollo | Diagnósticos, línea base, iniciativas, metas, responsables y evidencia | PEI, POA, evaluación trimestral, cartera de proyectos |
| Estadística y gestión de información | Catálogo, diccionario, fuentes, cortes, versiones y validaciones | Tableros, RIESS/producción, calidad de datos |
| Control interno y auditoría | Hallazgos, controles, acciones correctivas, evidencias y riesgos | Matriz NOBACI, auditoría, seguimiento de observaciones |
| Asesoría jurídica y cumplimiento | Contratos, licencias, reclamaciones, normas y litigios | Mapa de obligaciones, vencimientos y exposición |
| Calidad y seguridad del paciente | Incidentes, notificaciones, auditorías, infecciones y acciones | Informes de calidad, mejora, seguridad y acreditación |
| Gestión de riesgos y continuidad | Amenazas, impactos, RTO/RPO, simulacros y contingencias | Planes de continuidad, seguridad hospitalaria |
| Comunicación y atención a comunidad | Solicitudes, campañas, alianzas, comunicaciones públicas | Comunicación, educación y rendición institucional |
| Investigación y docencia | Proyectos, protocolos, residentes, investigaciones y avales | Comités científicos, docencia, ética, indicadores académicos |

### 2.x Gestión asistencial

| Unidad o proceso | Datos esenciales que recoge | Tableros e informes derivados |
| --- | --- | --- |
| Admisión, registro y archivo clínico | Identidad, visitas, seguros, consentimientos, MPI, duplicados | Registro, acceso, denominadores asistenciales |
| Consulta externa y teleconsulta | Citas, asistencia, diagnósticos, órdenes, referencias, tiempos | Producción, ausentismo, productividad, continuidad |
| Emergencias y triaje | Llegada, clasificación, primera valoración, destino, reingresos | Demoras, permanencia, severidad, referencia |
| Hospitalización y gestión de camas | Ingreso, censos, traslados, egresos, camas habilitadas, estancias | Ocupación, estancia, rotación, reingresos |
| Enfermería y gestión de cuidados | Turnos, asignación, signos, administración real, incidentes | Cumplimiento de cuidados, cargas de trabajo |
| UCI adulto y pediátrica | Censo, gravedad, dispositivos, ventilación, eventos | Ocupación UCI, resultados ajustados, uso de equipos |
| Quirófanos y anestesia | Agenda, procedimientos, tiempos, cancelaciones, seguridad | Utilización, cancelación, infecciones quirúrgicas |
| Obstetricia, partos y puerperio | Embarazo, partos, cesáreas, complicaciones, egresos | Indicadores maternos, partos y cesáreas |
| Neonatología y pediatría | Nacimientos, prematuridad, cuidados, unidades neonatales | Indicadores neonatales y pediátricos |
| Cardiología y diagnóstico funcional | Pruebas, procedimientos, citas, resultados | Volumen, oportunidad, utilización |
| Nefrología y diálisis | Sesiones, accesos, incidentes, consumo y mantenimiento | Actividad, disponibilidad y seguridad |
| Oncología y hospital de día | Protocolos firmados, ciclos, agenda, reacciones, fármacos | Producción y seguimiento oncológico |
| Salud mental y psicología | Consultas, planes, derivaciones, seguridad, continuidad | Acceso, seguimiento y calidad |
| Rehabilitación y fisioterapia | Planes de rehabilitación, sesiones, objetivos funcionales | Producción, resultados funcionales |
| Nutrición clínica y dietética | Órdenes dietéticas, evaluación, restricciones y alergias | Dietas seguras, cobertura de valoración |
| Odontología | Consultas, procedimientos, odontograma y materiales | Producción, insumos y oportunidad |
| Trabajo social y experiencia del paciente | Necesidades sociales, egreso complejo, quejas y satisfacción | Resolución, barreras de acceso y continuidad |
| Ambulancias y referencia/contrarreferencia | Traslados, ambulancias, tiempos, motivos, aceptación | Oportunidad y resolutividad de referencias |

### 2.x Diagnóstico y terapia

| Unidad o proceso | Datos esenciales que recoge | Tableros e informes derivados |
| --- | --- | --- |
| Laboratorio clínico | Órdenes, muestras, resultados, críticos, reactivos y tiempos | TAT, resultados críticos, rechazos |
| Anatomía patológica | Biopsias, muestras, trazabilidad, informes | Tiempo diagnóstico y calidad |
| Banco de sangre y transfusión | Donantes, componentes, compatibilidad, reacciones | Trazabilidad y hemovigilancia |
| Imágenes / RIS-PACS | Solicitudes, estudios, informes, dosis, equipos | TAT, utilización, rechazo y disponibilidad |
| Endoscopia y procedimientos | Programación, sedación, re-procesamiento, eventos | Volumen, cancelaciones, eventos |
| Esterilización central (CEyE/CSSD) | Ciclos, lotes, instrumental, pruebas, distribución | Trazabilidad, esterilización y faltantes |
| Farmacia clínica y dispensación | Recetas, validación, reserva, dispensación, lote y caducidad | Disponibilidad, consumo, devoluciones, seguridad |
| Central de mezclas y preparación | Preparaciones, lotes, condiciones, controles | Conformidad y trazabilidad |

### 2.x Administración y finanzas

| Unidad o proceso | Datos esenciales que recoge | Tableros e informes derivados |
| --- | --- | --- |
| Presupuesto y tesorería | Apropiación, compromiso, devengado, pagos, ingresos y bancos | Ejecución físico-financiera, caja, desvíos |
| Contabilidad y costos | Asientos, centros de costo, activos, depreciación, costos por proceso | Estados, costeo por unidad, conciliación |
| Facturación, ARS y seguros | Prestación, tarifa, reclamación, glosas, cobros, antigüedad | Facturado, recaudado, glosas, cartera |
| Compras y contrataciones | Requisiciones, procesos, adjudicaciones, órdenes y contratos | PAC/PACC, cumplimiento, proveedores |
| Almacenes e inventarios generales | Productos, movimientos, ubicaciones, lotes, stock y roturas | Inventario, consumo, mermas, quiebres |
| Patrimonio y activos fijos | Activos, ubicación, responsable, mantenimientos, bajas | Inventario patrimonial, reposición |
| Recursos humanos y nómina | Plantilla, plazas, perfiles, turnos, permisos, pago y capacitación | Dotación, ausentismo, productividad, brechas |
| Seguridad ocupacional | Accidentes laborales, exposición, EPP, exámenes y acciones | Incidentes laborales, prevención |
| Servicio al usuario, caja y OAI | Quejas, solicitudes, tiempos, cobros, comunicaciones | Satisfacción, transparencia y respuesta |

### 2.x Operaciones e infraestructura

| Unidad o proceso | Datos esenciales que recoge | Tableros e informes derivados |
| --- | --- | --- |
| Ingeniería clínica y biomédica | Equipos, calibración, mantenimiento, fallos y repuestos | Disponibilidad, MTTR, cumplimiento preventivo |
| Mantenimiento de infraestructura | Órdenes, inspecciones, edificios, riesgos, contratos | Backlog, tiempos de reparación y costo |
| Energía, climatización y gases médicos | Consumo, capacidad, alarmas, cilindros, UPS, combustible | Continuidad, consumos y fallos críticos |
| Agua, saneamiento y ambiente | Calidad de agua, disponibilidad, limpieza, control ambiental | Seguridad ambiental y continuidad |
| Tecnologías de la información y ciberseguridad | Dispositivos, cuentas, backups, red, incidentes y SLA | Disponibilidad, vulnerabilidades y recuperación |
| Limpieza, hotelería y habitaciones | Tareas de limpieza, habitaciones listas, insumos y calidad | Tiempo de preparación y cumplimiento |
| Lavandería, ropería y textiles | Ropa sucia/limpia, lotes, pérdidas, ciclo y compras | Kg por egreso, suministro y pérdidas |
| Cocina, comedor y alimentación | Dietas prescritas, menú, producción, entrega, inocuidad | Raciones, puntualidad, desperdicio y costo |
| Residuos biosanitarios y generales | Clasificación, peso, retiro, transporte y destino | Gestión de residuos, seguridad y costo |
| Seguridad física y control de accesos | Accesos, incidentes, visitantes y rondas | Seguridad, incidentes y tiempos de respuesta |
| Parqueos, movilidad y transporte | Plazas, ocupación, vehículos, ambulancias, combustible | Disponibilidad de estacionamiento y movilidad |
| Recepción, orientación y señalización | Flujo peatonal, espera, accesibilidad, señalización | Orientación, tiempos y barreras |
| Morgue y gestión post mortem | Custodia, notificación, documentos, traslados | Trazabilidad y oportunidad |
| Comunicaciones, telefonía y call center | Llamadas, derivaciones, fallas, solicitudes y mensajería | Abandono, atención y disponibilidad |
| Archivo general, mensajería y correspondencia | Documentos, expedientes, custodia, plazos y valijas | Trazabilidad y cumplimiento |
| Jardinería, exteriores y plagas | Inspecciones, intervenciones, proveedores y áreas | Mantenimiento y eventos ambientales |

## 3. Sistemas de registro: arquitectura de datos completa

### 3.1 Entidades maestras y jerarquías

Genesis generará un **catálogo canónico universal**. Un hospital reutiliza entidades generales (`person`, `organization`, `asset`, `location`, `task`, `document`, `contract`, `payment`) y agrega entidades sanitarias (`patient`, `encounter`, `clinical_order`, `specimen`, `medication`, etc.).

En los reportes, todos los hechos se agrupan por **sede → edificio/planta → servicio → unidad → centro de costo → responsable → período**, con dimensiones opcionales (aseguradora, turno, sexo, edad, municipio, servicio, especialidad) según autorización y reglas de privacidad. Nunca se mezclará la fecha del hecho con la fecha de registro.

| Entidad | Qué representa / campos semánticos mínimos |
| --- | --- |
| organization | Institución, forma de propiedad, órgano rector, régimen |
| site | Sede, dirección, tipo, horario |
| building | Edificio, planta, zona |
| space | Consultorio, habitación, cocina, parqueo, circulación |
| bed | Cama física/habilitada/ocupada y su disponibilidad |
| resource_asset | Mobiliario, equipos, vehículos y otros activos |
| device | Equipo biomédico, medidor, monitor y capacidad |
| employee | Persona empleada/contratista, información mínima |
| position | Plaza, puesto, jefatura y perfil |
| credential | Licencias, formación, habilitación y vigencias |
| shift | Calendario, cobertura, asignación y ausencias |
| policy_document | Manual, protocolo, plano, contrato, versión |
| sop | Procedimiento operativo estandarizado y aprobación |
| committee | Miembros, mandato, periodicidad y agenda |
| decision | Acuerdo, responsable, fecha, verificación |
| patient | Identificación y consentimientos clínicos |
| encounter | Atención, ingreso, seguimiento y alta |
| appointment | Cita y estado de asistencia |
| referral | Referencia, traslado, contrarreferencia |
| observation | Medición, procedencia, fecha y unidad |
| clinical_order | Orden clínica autorizada |
| result | Resultado, criticidad, acuse y firma |
| medication_event | Orden, validación, dispensación y administración |
| nutrition_order | Dieta y restricciones prescritas |
| procedure | Cirugía, prueba, terapia o procedimiento |
| adverse_event | Incidente, gravedad, medidas, seguimiento |
| inventory_item | Artículo, unidad, catálogo, lote, caducidad |
| stock_movement | Entrada, salida, merma, devolución, transferencia |
| vendor | Proveedor, cumplimiento, contrato y evidencia |
| purchase_request | Solicitud, aprobación y necesidad |
| procurement | Proceso contractual y orden de compra |
| invoice_claim | Factura, ARS, cargo, glosa, pago |
| budget_line | Fuente, partida, centro de costo, ejercicio |
| expense_event | Compromiso, devengado, pago, conciliación |
| revenue_event | Cobro, transferencia, facturación y ajuste |
| cost_center | Unidad responsable, reglas de costeo |
| project | PEI, POA, metas, actividades, presupuesto |
| indicator | Definición, numerador, denominador y fuente |
| report_submission | Versión de reporte, firma, envío y acuse |
| maintenance_work_order | Activo, tarea, falla, resolución |
| kitchen_order | Menú, dieta, cantidad, entrega, desperdicio |
| laundry_batch | Lote ropa, peso, ciclo, pérdidas |
| waste_manifest | Tipo residuo, peso, operador y retiro |
| parking_session | Plaza, permiso, ocupación y acceso |
| visitor_access | Entrada/salida visitantes, autorización |
| model_account | Proveedor IA, credencial referenciada, gasto |
| phoenix_instance | Identidad lógica, función, permisos y salud |
| integration_contract | Conector, versión, scopes y protocolo |
| workflow_task | Trabajo, correlación, idempotencia, resultado |

### 3.2 Una sola verdad por dominio, no una megabase que copia todo

**Fuente autorizada de verdad (SoT):** EHR/HIS para episodios si ya existe; LIS para resultados; RIS/PACS para estudios; ADT para localización de pacientes; RRHH/nómina para relación contractual; SIGEF/contabilidad cuando aplique para ejecución financiera; inventario/SALMI para existencia; CMMS para equipos; edificio/activo maestro para espacio. Se define por contrato qué fuente gana en caso de conflicto. Un mismo hecho puede tener vistas agregadas, pero sus identificadores y eventos originales se preservan.

**Capas de plataforma:**

- **Captura transaccional (OLTP):** aplicaciones tradicionales, HealthIA y PHOENIX por rol; validación en origen, marcas de tiempo, identidad y autorización.
- **Interoperabilidad (Bridge):** conectores FHIR/HL7, OpenAPI, DICOMweb, sistemas financieros y logísticos, eventos seguros y transferencias por lotes.
- **Bus duradero:** eventos mínimos, identificadores y referencias; tareas idempotentes y recibos firmados, nunca PHI copiada indiscriminadamente al bus.
- **Identidad y datos maestros (MDM):** identificadores pacientes, empleados, ubicaciones, artículos, proveedores, categorías de gasto y centros de costo; detección de duplicados sin fusión automática de expedientes.
- **ODS y almacén analítico:** snapshots auditables, hechos y dimensiones, tendencias longitudinales, segmentación y retención.
- **Capa semántica de indicadores:** fórmula única versionada, numerador, denominador, elegibilidad, unidad, zona horaria, calendario, corte, filtros, propietario y fuente.
- **Servicio de informes:** paquetes por destinatario, firma, revisión, evidencia, acuses y calendario de obligaciones.
- **Control y observabilidad:** linaje, frescura, completitud, validez, unicidad, conciliación, acceso y costo de procesamiento.

Cada evento importante conserva: `tenantId`, `siteId`, `eventId`, `entityId`, `sourceSystem`, `sourceRecordId`, `eventTime`, `recordedAt`, `effectiveAt` (si aplica), `actorId`, `schemaVersion`, `correlationId`, `classification`, `signature/approvalRef`, `consentOrLegalBasis`, `provenanceRef`, `retentionPolicy`, `qualityState` e `idempotencyKey`. Los campos que contienen datos personales permanecen en sistemas autorizados, no en eventos generales.

### 3.3 Reglas de calidad

1. **Completitud**: campos mínimos obligatorios según hecho, fuente y uso; no confundir `0` con dato ausente.
2. **Validez**: catálogos de diagnóstico, servicio, unidad de medida, fechas y códigos; restricciones de negocio.
3. **Unicidad**: episodios, pacientes, órdenes, facturas y movimientos sin duplicaciones indebidas.
4. **Consistencia**: egresos conciliados con censos; consumo de farmacia con movimientos; facturado con prestaciones; nómina con contratos; devengado con obligaciones.
5. **Oportunidad**: definir SLA de actualización y cortar indicadores por fecha de evento vs. fecha de carga.
6. **Trazabilidad**: ir del número agregado al conjunto de registros fuente, sin revelar PHI a roles no autorizados.
7. **Aprobación**: indicadores o reportes con fallas bloqueantes se etiquetan `no certificado` y no se envían en automático.
8. **Sesgo/representatividad**: muestras, encuestas, ajustes de riesgo clínico y denominadores explícitos.
9. **Correcciones y reenvíos**: versiones inmutables de informes, fe de erratas, historial y acuse.

## 4. Ciclo completo del paciente y conexiones con gestión

**Descubrimiento de demanda** (referencia/campaña) → **cita/orientación** → **admisión/identificación** → **triaje/consulta** → **diagnóstico y órdenes** → **laboratorio/imágenes/farmacia** → **hospitalización/quirófano/UCI cuando aplique** → **enfermería y nutrición** → **alta** → **referencia/seguimiento** → **facturación/ARS** → **calidad y estadísticas**.

Cada etapa tiene registro clínico, recurso asociado, centro de costo, responsable, timestamps y eventos de transición. También consume energía, agua, equipo, limpieza, mantenimiento y logística; esos costos se asignan según reglas contables defendibles. **No se infiere la atención realizada a partir de una orden ni se infiere una dispensación desde una prescripción.** La prestación real, la administración real y el devengado financiero tienen sus propios eventos firmados.

### 4.1 Flujos operativos cruzados mínimos

1. Admisión ↔ Identidad ↔ Aseguradora ↔ Historia clínica.
2. Urgencias → Triaje → Box → Resultados → Alta/ingreso/traslado.
3. Consulta → Orden validada → Farmacia → Enfermería → Reconciliación de administración.
4. Consulta/UCI → Laboratorio/Imágenes → Resultado crítico → Acuse profesional.
5. Ingreso → Asignación cama → Dieta prescrita → Cocina → Entrega conformada.
6. Alta → Limpieza → Supervisión → Cama disponible → Nueva admisión.
7. Programación quirúrgica → Equipo → Implantes → Esterilización → Quirófano → Recuperación.
8. Consumo de farmacia → Reposición → Compras → Recepción lote → Inventario → Pago.
9. Necesidad de cobertura → RRHH → Turnos → Autorizaciones → Nómina → Centro de costo.
10. Falla equipo → Ingeniería clínica → Repuesto → Compra → Prueba → Activo habilitado.
11. Resultado de indicador → Comité → Acta → Acción correctiva → Evidencia de cierre → POA.
12. Producción asistencial → Auditoría de cuentas → Facturación ARS → Objeción/glosa → Cobro → Conciliación.
13. Consumo de recurso → Centro de costo → Presupuesto → Desviación → Propuesta de ajuste.
14. Evento epidemiológico → Epidemiología → Notificación según norma → Seguimiento y retroalimentación.
15. Reporte institucional → Validación por jefes → Aprobación dirección → Envío autorizado → Acuse.

## 5. Inteligencia directiva: preguntas que PHOENIX debe poder responder

- **Director:** ¿qué servicios tienen mayor demanda y mayores tiempos de espera, con qué dotación y costo? ¿Qué riesgos comprometen la atención esta semana?
- **Dirección médica:** ¿qué diagnósticos, procedimientos y resultados cambian por especialidad? ¿Dónde hay demoras o brechas de calidad?
- **Enfermería:** ¿cuántas camas realmente habilitadas existen, quién está ingresado, qué tareas vencen, qué turnos faltan y qué suministros se necesitan?
- **Finanzas:** ¿qué se aprobó, comprometió, devengó, pagó y cobró, por fuente, programa y centro de costo? ¿Dónde están las glosas y cuentas vencidas?
- **Compras:** ¿qué stock se agotará antes del plazo de reposición? ¿Qué contratos y partidas autorizan la compra?
- **RRHH:** ¿qué servicios tienen brechas de cobertura por turno, qué certificaciones vencen y qué competencias faltan?
- **Ingeniería clínica:** ¿qué equipos no pueden utilizarse, cuánto cuestan y qué mantenimiento preventivo vence?
- **Cocina:** ¿cuántas dietas distintas están prescritas para el próximo reparto, con qué restricciones, stock y costo por ración?
- **Hostelería:** ¿qué camas y habitaciones están pendientes de limpieza y cuánto tarda su preparación?
- **Parqueos:** ¿cuáles son horas pico, capacidad, accesos prioritarios y circulación segura?
- **Comités:** ¿qué decisiones del último encuentro siguen abiertas, cuáles vencieron y qué evidencia demuestra su cumplimiento?
- **Autoridades externas:** ¿qué indicadores se solicitan, bajo qué diccionario y fecha, con qué validaciones y firma?

**Principio decisional:** Genesis ofrece diagnóstico, opciones, supuestos, escenarios, costo, impacto estimado y riesgos; el titular con autoridad aprueba. Prohibido presentar predicciones especulativas como hechos confirmados.

## 6. Planeación estratégica, anual y presupuestaria: automatización responsable

### 6.1 PEI — Plan Estratégico Institucional

**Entradas:** diagnóstico AS-IS, marco legal, necesidades de población, demanda histórica, cartera de servicios, recursos, calidad, riesgos, presupuesto plurianual, entrevistas a responsables. **Salidas:** misión, visión, ejes, objetivos, resultados esperados, líneas de base, KPIs, metas plurianuales, cartera de proyectos, responsables y mecanismos de seguimiento.

Cada objetivo exige `objectiveId`, población/alcance, indicador, línea base, meta/año, recursos, dependencias, dueño y evidencia de aprobación. Genesis redacta propuestas y apoya su evaluación, no suplanta decisiones del consejo.

### 6.2 POA — Plan Operativo Anual

**Entradas:** objetivos PEI, productividad y resultados anteriores, demandas por servicio, brechas de infraestructura, plantilla y turnos, necesidades de mantenimiento, inventarios, costos, proyectos, fuentes de financiamiento y riesgos. **Salidas:** objetivo, producto, actividad, entregable, responsable, fecha, indicador, línea base, meta trimestral, costo RD$, fuente de financiamiento, adquisición vinculada, riesgo, medio de verificación y fecha de aprobación. El POA se construye de abajo arriba (jefaturas) y se consolida por planificación, finanzas y dirección.

Un algoritmo debe reconciliar `POA > actividad > presupuesto > compra > ejecución financiera > producto físico > resultado`. Si una actividad no tiene presupuesto o su compra no está autorizada, Genesis no la marca como ejecutable. En instituciones públicas usar la estructura y metodología oficial vigente; en privadas, el formato de gestión adoptado.

**Muestra ficticia (NO datos reales):**

| ID | Eje | Objetivo | Unidad | Línea base | Meta | Unidad medida | Presupuesto RD$ | Responsable |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OBJ-01 | Acceso y oportunidad | Reducir tiempo mediano de espera en consulta | Consulta externa | 60 | 45 | min | 400000 | Dirección médica |
| OBJ-02 | Seguridad del paciente | Ampliar cumplimiento higiene de manos | IPC | 65 | 85 | % | 250000 | Calidad |
| OBJ-03 | Suministros | Reducir quiebres de medicamentos críticos | Farmacia | 24 | 10 | días | 175000 | Farmacia |
| OBJ-04 | Gestión financiera | Mejorar cierre de conciliaciones | Finanzas | 70 | 100 | % | 95000 | Finanzas |
| OBJ-05 | Continuidad | Probar recuperación servicio clínico esencial | TIC y continuidad | 2 | 8 | número | 350000 | TIC |

### 6.3 POE — Procedimientos Operativos Estandarizados

Cada procedimiento tendrá código, unidad, objetivo, alcance, roles, disparador, entradas, pasos, límites, excepciones, autorizaciones, registros producidos, criterios de calidad, vínculo a formularios PHOENIX, referencia normativa, versión, aprobación, formación y revisión periódica. Genesis podrá transformar un manual aprobado en un flujo **propuesto**, que después valida el responsable. La IA no cambia un protocolo clínico aprobado por inferencia propia.

### 6.4 Plan anual de contrataciones (PAC/PACC)

Vincular necesidad, especificación, cantidades, costo estimado, centro de costo, unidad solicitante, cronograma, apropiación, método de contratación autorizado y evidencia. El marco jurídico dominicano de 2026 debe revisarse con el área jurídica: la Ley 47-25 y su reglamentación actualizan contrataciones públicas. No asumir que una plantilla histórica es automáticamente vigente.

### 6.5 Programa de recursos humanos

Plantilla/puestos, carga de trabajo, coberturas por turno, licencias, rotación, ausentismo, capacitación, sustituciones, residencia y necesidades por especialidad; proponer plazas y formación con justificativos, evitando automatizar decisiones de empleo. Costear salarios/compensaciones y vincular nómina al centro de costo según autorizaciones.

### 6.6 Programa de inversiones y patrimonio

Mapas físicos, seguridad hospitalaria, equipo, ciclo de vida, criticidad, fallos, mantenimiento, expansión, repuestos, costos y continuidad. Clasificar CAPEX/OPEX y priorizar por riesgo/beneficio con revisión técnica.

## 7. Contabilidad hospitalaria y finanzas integradas

### 7.1 Fuentes y clasificación

- **Ingresos:** presupuesto/transferencias, facturación a ARS, pagos privados, capitación cuando proceda, convenios, donaciones, proyectos y otros, identificando su régimen legal.
- **Gasto:** personal, fármacos, dispositivos e insumos, suministros de mantenimiento, energía, agua, oxígeno, servicios contratados, lavandería, alimentación, tecnología, arrendamientos, depreciación y obras.
- **Dimensiones financieras:** ejercicio, fuente, programa, partida/objeto del gasto, centro de costo, servicio, proyecto, tipo costo directo/indirecto, proveedor, contrato y estado.
- **Ciclo para entidad pública:** apropiación → cuota/afectación preventiva cuando aplique → compromiso → devengado → pago, más conciliación; no llamar 'gastado' indiscriminadamente a todo el presupuesto autorizado.
- **Tesorería:** bancos, arqueos, proyecciones de caja, cuentas por cobrar/pagar, vencimientos y conciliaciones.
- **ARS/facturación:** servicios efectivamente documentados, codificación, tarifa, autorización, presentación, objeción/glosa, respuesta, reenvío, cobro y ajustes.
- **Costos:** asignación de sueldos, tiempo, insumos, consumos y costos indirectos al servicio, caso o unidad. Declarar método de prorrateo, exclusiones y costes sin asignar.

### 7.2 Planificación y análisis financiero automatizado

`Presupuesto vigente − compromisos válidos = saldo de compromiso estimado` (sujeto al procedimiento oficial y cuotas); `Gasto devengado / presupuesto vigente` mide ejecución devengada, no pago; `Cobrado / facturado elegible` mide recaudación en cohorte definida, no rentabilidad; `Costo servicio = costos directos + costos indirectos asignables`. Se deben mostrar fórmulas y filtros.

Genesis puede ofrecer alertas por sobreejecución, caja insuficiente, cartera vencida, insumos próximos a agotarse, contratos próximos a vencer y proyectos sin financiación. El pago, contratación, compromiso o ajuste contable requiere aprobación y herramientas autorizadas; nunca ejecutar transacciones financieras desde texto no validado.

## 8. Comités y órganos colegiados

La existencia formal, composición, facultades y frecuencia se verifican según el hospital y las normas vigentes. No todas las unidades son obligatorias en todos los centros. Genesis crea una instancia/capacidad de secretaría documental que gestiona convocatoria, agenda, quorum, deliberaciones autorizadas, acta, acuerdos, responsables, vencimiento, evidencia, seguimiento y escalamiento. Los comités clínicos reciben la mínima información pertinente y, cuando sea posible, datos agregados/desidentificados.

| Comité propuesto/verificable | Responsable funcional | Cadencia orientativa | Productos del comité |
| --- | --- | --- | --- |
| Consejo de administración y comité ejecutivo | Dirección general | Mensual | PEI, POA, presupuesto, riesgos, acuerdos |
| Comité de calidad y seguridad del paciente | Calidad | Mensual | Eventos, resultados, planes de mejora |
| Comité de infecciones y prevención y control (IAAS) | Epidemiología / IPC | Mensual y eventos | Vigilancia, brotes, adherencia, acciones |
| Comité farmacoterapéutico | Farmacia clínica / Dirección médica | Mensual/trimestral | Formulario, disponibilidad, farmacovigilancia |
| Comité de optimización antimicrobiana (PROA/AMS) | Infectología / Farmacia | Mensual | Consumo, resistencia, adecuación |
| Comité de mortalidad y morbilidad | Dirección médica | Mensual | Auditorías de casos, causas, oportunidades |
| Comité materno-perinatal | Obstetricia / Pediatría | Mensual | Resultados, mortalidad, cesáreas, oportunidades |
| Comité de transfusión y hemovigilancia | Banco de sangre | Trimestral | Reacciones, trazabilidad, disponibilidad |
| Comité de cirugía y seguridad quirúrgica | Quirófanos | Mensual | Cancelaciones, listas, eventos |
| Comité de ética asistencial y bioética | Ética / Dirección | Por agenda | Consultas, deliberaciones protegidas |
| Comité de investigación y docencia | Docencia | Trimestral | Protocolos, residentes, formación |
| Comité de gestión de camas y flujo | Admisión / Enfermería | Diario o semanal | Ocupación, espera, traslados |
| Comité de emergencias y desastres | Dirección / Continuidad | Trimestral y eventos | Simulacros, capacidad, fallos |
| Comité de salud y seguridad en el trabajo | RRHH / Seguridad ocupacional | Trimestral | Accidentes, riesgos, acciones |
| Comité de compras y contrataciones | Administración | Según norma y proceso | Expedientes de contratación, aprobaciones |
| Comité de presupuesto y control de gestión | Finanzas / Planificación | Mensual | Desvíos, caja, metas, proyectos |
| Comité de tecnología, datos y ciberseguridad | TIC / Datos | Mensual | Accesos, incidentes, calidad, continuidad |
| Comité de equipos e infraestructura | Ingeniería clínica | Mensual | Mantenimiento, reemplazos, incidentes |
| Comité de residuos y ambiente | Servicios generales | Trimestral | Residuos, agua, inocuidad, cumplimiento |
| Comité de experiencia y derechos del paciente | Atención al usuario | Trimestral | Quejas, encuestas, acciones |

## 9. Catálogo central de indicadores y reportes

Las fórmulas propuestas requieren armonización con definiciones oficiales por nivel y servicio. **Nunca usar porcentajes sin denominador verificable ni comparar instituciones con diferencias de complejidad como si fueran equivalentes**. Indicadores de mortalidad y eventos requieren definiciones clínicas, factores de ajuste cuando corresponda y examen de calidad de datos.

El archivo Excel adjunto a este plan incluye el **diccionario completo** de los indicadores (código, unidad, fórmula, fuente, dueño, periodicidad, cautela) y formularios de trabajo. Esta tabla muestra el índice agrupado:

| Dominio | Indicadores propuestos |
| --- | --- |
| Acceso y flujo | 23 |
| Calidad y seguridad | 12 |
| Cirugía y maternoinfantil | 12 |
| Diagnóstico y terapia | 11 |
| Finanzas y compras | 18 |
| Gobierno y transformación | 15 |
| Infraestructura y soporte | 22 |
| Medicamentos e insumos | 11 |
| Recursos humanos | 11 |

### 9.1 Paquetes de reporte e integración con gobiernos y pagadores

Antes de configurar un envío, Genesis resuelve: **¿aplica a hospital público o privado?, ¿qué entidad lo exige?, ¿cuál versión de formulario?, ¿qué canal autorizado?, ¿qué periodicidad y fecha límite vigentes?, ¿quién firma?, ¿qué evidencia y acuse recibimos?**.

La siguiente matriz es un **catálogo de potenciales requerimientos**, no una declaración de obligaciones legales idénticas para todo centro. Los plazos que no se verificaron se mantienen como `por confirmar`.

| ID | Informe | Receptor interno/externo | Periodicidad propuesta o normativa | Datos principales | Dueño | Validación |
| --- | --- | --- | --- | --- | --- | --- |
| R01 | Producción hospitalaria por servicio | SNS/RIESS o autoridad aplicable | Mensual/trimestral | Visitas, ingresos, egresos, cirugías, estudios, nacimientos | Estadística | Confirmar vía, plantilla y obligación según centro |
| R02 | Notificación de eventos de vigilancia epidemiológica | DIGEPI / SINAVE | Según evento normado | Casos, eventos, fechas, clasificaciones y variables requeridas | Epidemiología | No sustituir notificación clínica urgente por batch |
| R03 | Nacidos vivos y defunciones | MSP / registros correspondientes | Según normativa | Nacimiento, defunción, causa y certificación | Estadística / Registro | Validar registro, canal y oportunidad |
| R04 | Morbilidad y egresos | SNS/MSP según modalidad | Según requerimiento | Episodios, diagnósticos, egresos | Estadística | Códigos y denominadores normalizados |
| R05 | Producción y seguimiento materno infantil | SNS/MSP/SRS | Periódico | Partos, cesáreas, neonatal y seguimiento | Obstetricia / Estadística | Validar definiciones oficiales |
| R06 | Recursos humanos sanitarios | SNS/MAP/SASP donde corresponda | Según norma | Dotación, categoría, plazas, cambios | RRHH | Separar datos individuales y agregados |
| R07 | Ejecución presupuestaria físico-financiera | Autoridad financiera / SIGEF según entidad | Mensual/trimestral | Apropiado, comprometido, devengado, pagado, metas | Finanzas | Distinguir fuente oficial y reportes internos |
| R08 | POA: metas, avances y evidencias | SNS/SRS/planificación institucional | Trimestral/según calendario | Producto, indicador, meta, avance, evidencia | Planificación | Requiere validación por responsables |
| R09 | Seguimiento PEI | Dirección / SNS | Semestral/anual | Objetivos, indicadores, línea base, riesgos | Planificación | Alineación con PEI vigente |
| R10 | Plan Anual de Contrataciones (PAC) | DGCP / plataforma aplicable | Anual/actualizaciones | Necesidades, categorías, montos, cronograma | Compras | En 2026 validar marco Ley 47-25 y reglamento |
| R11 | Ejecución de contrataciones y contratos | DGCP/órganos de control | Según régimen | Adjudicaciones, contratos, proveedores, pagos | Compras | Publicar solo por canal habilitado |
| R12 | Medicamentos e insumos: SUGEMI/SALMI | SNS/SRS según aplicabilidad | Periódico | Disponibilidad, consumo, lotes, expiraciones | Farmacia | Confirmar instrumentos regionales |
| R13 | Facturación, objeciones y cobros ARS | ARS/SeNaSa / administración | Por ciclo de factura | Prestaciones, cargos, glosas, pagos | Facturación | Formato depende del contrato |
| R14 | Calidad y seguridad del paciente | Dirección/comités/regulador según norma | Mensual/trimestral | Incidentes, eventos, medidas, acciones | Calidad | Desidentificar reportes ejecutivos |
| R15 | Infecciones asociadas a atención | Vigilancia interna/autoridades | Según evento | IAAS, exposición, denominadores | IPC | Tasas requieren vigilancia y definición |
| R16 | Farmacovigilancia/tecnovigilancia | Autoridad competente | Según obligación | Evento, causalidad, lote, dispositivo | Farmacia / Ingeniería | Proteger identificación de casos |
| R17 | Evaluación de dotación y formación | Dirección / RRHH | Mensual/trimestral | Plazas, turnos, brechas, formación | RRHH | No automatizar decisiones laborales |
| R18 | Estados y conciliaciones financieras | Finanzas / control/autoridad competente | Mensual/anual | Bancos, libro mayor, cuentas y activos | Contabilidad | Sujeto a marco contable aplicable |
| R19 | Inventarios y activos fijos | Dirección / control | Mensual/anual | Movimientos, conteos, diferencias, depreciación | Almacén / Activos | Inventarios físicos periódicos |
| R20 | Servicios generales y continuidad | Dirección / comité de riesgos | Mensual | Energía, agua, gases, mantenimiento, contingencias | Operaciones | Inspecciones y datos de equipos |
| R21 | Gestión de residuos y ambiente | Autoridad ambiental/sanitaria si aplica | Según norma | Clasificación, volumen, gestión y manifiestos | Servicios generales | Comprobar licencias y operador |
| R22 | Accidentes laborales y salud ocupacional | Autoridad laboral/seguridad social si aplica | Según evento | Exposición, accidente, seguimiento | Seguridad ocupacional | Canal y plazo normativo |
| R23 | Transparencia y libre acceso | OAI / portal institucional público | Según norma | Solicitudes, respuestas, publicación | OAI | No publicar datos protegidos |
| R24 | Informes de comités | Dirección/comités | Según calendario | Actas, recomendaciones, plazos y acciones | Secretaría de comité | Evidencia de quorum y aprobación |
| R25 | Tablero ejecutivo integral | Consejo y dirección | Diario/mensual | Calidad, acceso, finanzas, RRHH, operación | BI / Dirección | Datos con fecha, meta y responsable |
| R26 | Memoria institucional y rendición anual | Consejo / SNS según entidad | Anual | Logros, indicadores, gasto, inversiones | Planificación / Dirección | Conciliar cifras interdepartamentales |
| R27 | Reclamos, quejas y satisfacción | Dirección / Atención al usuario | Mensual | Entradas, clasificación, resolución, encuesta | Usuario | No inferir satisfacción de ausencia de quejas |
| R28 | Auditoría interna y acciones correctivas | Control interno | Trimestral | Hallazgos, responsables, vencimientos | Auditoría | Pruebas de cierre verificadas |
| R29 | Costos por servicio y centro de costo | Finanzas / Dirección | Mensual | Costos directos, indirectos, actividad | Costos | Metodología estable y documentada |
| R30 | Proyectos de inversión / SNIP si aplica | Planificación / autoridad pertinente | Según proyecto | Capex, cronograma, obra, resultados | Planificación | Validar normas de inversión pública |
| R31 | Accesibilidad y atención a población vulnerable | Dirección / Calidad | Trimestral | Barrera, ajustes, tiempos, experiencia | Calidad | Agregación y privacidad |
| R32 | Formación, investigación y docencia | Dirección / academia | Semestral | Actividades, residentes, publicaciones | Docencia | Ética y acreditación vigentes |
| R33 | Protección de datos y ciberseguridad | Comité TIC / auditoría | Mensual/evento | Incidentes, accesos, respaldos, pruebas | TIC | No incluir secretos en informes |
| R34 | Indicadores por unidades y jefaturas | Jefes de departamento | Semanal/mensual | Metas locales, producción, recursos, acciones | Cada jefatura | Definición única corporativa |

### 9.2 Tipos de documentos y productos de dirección

- **Diario:** censo de camas y servicios, personal de guardia, operaciones críticas, seguridad, incidentes, necesidades inmediatas, caja operativa cuando aplica.
- **Semanal:** flujo de pacientes, retrasos, quiebres de inventario, cobertura de personal, equipos críticos, decisiones de comités y riesgos.
- **Mensual:** productividad por área, facturación y cobro, costos, insumos, RRHH, mantenimiento, presupuestos, calidad, ejecución POA y cuentas vencidas.
- **Trimestral:** evaluación PEI/POA, ejecución físico-financiera, comités, controles, proyectos, inversión, satisfacción y paquetes regulatorios correspondientes.
- **Anual:** memoria institucional, presupuesto y PEI revisados, POA próximo año, PAC, talento humano, activos, auditorías, seguridad y continuidad.
- **Por evento:** SINAVE según caso aplicable, eventos adversos, resultado crítico, accidente laboral, muerte con causa verificable, incidente de seguridad, daño a instalaciones o fallos de continuidad.

El **Report Compiler** debe generar PDF/Excel/CSV/JSON/plantilla institucional, incluir fecha de corte, indicadores y definiciones, firma humana, anexos, hash de versión y trazabilidad, realizar comprobaciones previas, solicitar autorización, enviar solo por API o canal aprobado y registrar acuse, rechazo, corrección y reenvío. Si no hay canal programático, preparar archivo para entrega manual; **no afirmar que fue entregado**.

## 10. Interfaces inteligentes por responsabilidades

| Usuario o función | Interfaz operativa | Decisiones asistidas | Restricciones |
|---|---|---|---|
| Consejo / director | Mapa hospital, semáforos estratégicos, PEI/POA, presupuesto, riesgos, actas | Reasignación propuesta, inversión, calidad, metas | Datos clínicos agregados salvo autorización específica |
| Dirección médica | Oferta, demanda, médicos, calidad, especialidades, cirugías, auditorías | Carga asistencial, mejoras, rutas de atención | Decisiones clínicas a profesionales habilitados |
| Dirección de enfermería | Camas vivas, turnos, cuidados, medicamentos, incidentes | Dotación, traslados, necesidades de farmacia | Acceso por servicio/relación asistencial |
| Jefatura de servicio | Producción, listas de trabajo, calidad, inventario, POA de área | Agendas, turnos y propuestas de proceso | Sin acceso transversal no justificado |
| Finanzas / contador | Presupuesto, SIGEF cuando proceda, caja, bancos, costos, contratos | Proyección, desvíos, control | Segregación de funciones y doble aprobación |
| Compras y almacenes | Necesidad, stock, licitaciones, recepción, contratos | Reposición y compras propuestas | No adjudicar o pagar sin autorización |
| RRHH | Plantilla, turnos, licencias, formación, acreditaciones | Capacitación y brechas | Currículos y expedientes restringidos |
| Planificación | PEI, POA, metas, evidencias, portafolio proyectos | Seguimiento, prioridades, reportes | Definiciones vigentes y aprobación |
| Calidad y comités | Incidentes, actas, planes, riesgos, hallazgos | Mejoras y seguimiento | Confidencialidad/anonimización |
| Farmacia | Prescripciones validadas, lotes, inventario, interacciones | Reserva, dispensación supervisada | Cierre por profesional autorizado |
| Cocina | Raciones, dietas válidas, alérgenos, existencias, turnos | Preparación y compra | Nunca rediseñar dieta clínica arbitrariamente |
| Ingeniería / mantenimiento | Plano, activos, sensores, OT, criticidad | Programas preventivos, repuestos | Ingeniería certificada para cambios críticos |
| Seguridad / parqueos | Entradas, aforos, eventos, circulación | Asignación y respuesta | Sin exposición de expedientes médicos |
| TIC y Genesis | Instancias, conectores, servidores, modelos, costo, seguridad | Despliegue, recuperación, credenciales | Sin acceso automático a datos clínicos |

Un PHOENIX conserva el núcleo universal de Kira, pero su **identidad, propósito, capacidades y UI** cambian por permiso y asignación. La visibilidad de un botón no equivale a autorización en backend.

## 11. Componente nuevo: PHOENIX Institutional Intelligence Engine

**Submódulos:**

1. **Institutional Data Catalog:** define fuentes, entidades, contratos, responsables, calidad y accesos.
2. **Clinical Activity Ledger:** hechos de producción y resultados clínicos; no sustituye la historia clínica.
3. **Cost and Resource Ledger:** gasto, consumo, activo, personal, costo y presupuesto.
4. **Master Data & Semantics:** identificadores, vocabularios, catálogo de indicadores y jerarquías.
5. **Decision Intelligence:** tendencias, escenarios, riesgos y recomendaciones explicables.
6. **Planning Studio:** PEI, POA, programas operativos y proyectos con presupuestos.
7. **SOP/POE Studio:** versión, flujo, aprobación, formación y auditoría.
8. **Committee Workspace:** agenda, actas, decisiones, responsables y seguimiento.
9. **Reporting Gateway:** generación, validación, firma y remisión autorizada a entidades externas.
10. **Executive Digital Twin:** visión integrada física, humana, asistencial y financiera.

**Ejemplo de trazabilidad:** `POA-2027-OBJ03` → `KPI-DisponibilidadMedicamento` → `movimiento lote/almacén` → `orden de compra` → `compromiso` → `devengado` → `acta de recepción` → `evidencia de meta`. Si una pieza falla, indicar causa y no ofrecer un avance ficticio.

## 12. Requisitos particulares de República Dominicana

- **SNS y Servicio Regional de Salud:** validar pertenencia a la red, dependencia y formatos de producción, POA y evaluaciones. RIESS publica categorías concretas de producción, recursos humanos y gasto.
- **MSP/DIGEPI:** vigilancia epidemiológica y notificaciones según evento y normativa; verificar versión del reglamento y canales SINAVE.
- **SUGEMI / SALMI:** cumplimiento y disponibilidad de medicamentos e insumos donde aplique; no inventar API ni capacidad de integración sin revisar el proveedor.
- **DIGEPRES/SIGEF:** vincular presupuesto, ejecución físico-financiera y reportes **solo cuando la entidad y sus competencias lo exijan**. No todos los hospitales operan directamente SIGEF.
- **MAP/SASP:** datos de empleo público según aplicabilidad, sin duplicar ni revelar datos sensibles.
- **DGCP:** verificar obligaciones de contratación pública según régimen legal 2026; Ley 47-25 y su reglamento vigente; PAC/plan de contrataciones y canal correspondiente.
- **ARS/SeNaSa:** los acuerdos, tarifas, autorizaciones, glosas y facturación son específicos de cada pagador y tipo de establecimiento.
- **Transparencia/OAI/control interno:** publicaciones, solicitudes, normas y auditorías según naturaleza jurídica; NOBACI para instituciones sujetas a ese marco.
- **Registro de nacimientos/defunciones:** validar instrumentos específicos de estadística vital y órganos de registro.
- **Datos personales y de salud:** jurisdicción, finalidad, derecho de acceso, confidencialidad y base legal. Evaluación jurídica y técnica antes de migración o uso de proveedores de IA.

**Distinción institucional:** reporte interno a dirección ≠ entrega a SRS/SNS ≠ vigilancia a MSP/DIGEPI ≠ declaración al regulador/pagador ≠ difusión pública. Cada una tiene alcance y aprobación propios. No inventar plazos ni plantillas no consultadas.

## 13. Seguridad, gobernanza, accesibilidad y sostenibilidad

**Roles y RACI:** responsable de captura (unidad); dueño semántico (jefatura); custodio de fuente (TI/aplicación); responsable de validación (estadística/finanzas); responsable legal (jurídica); responsable de liberación (autoridad designada). Segregar permisos de lectura, extracción, análisis, aprobación, publicación y envío.

**Protecciones:** tenant/site isolation; cifrado y gestor de secretos; política de retención; exportación mínima; anonimización con evaluación de riesgo de reidentificación; MFA para roles críticos; bitácoras; doble firma financiera; revisión de accesos; recuperación; monitoreo de ciberseguridad; integridad documental; segregación operativa y analítica.

**Seguridad clínica:** decisiones de diagnósticos, tratamiento, medicación, triaje y dispensación requieren controles profesionales y canales clínicos. Alarmas de dispositivos no dependen de inferencia. Indicadores comparativos clínicos sensibles se ajustan por complejidad si procede. El sistema de incidentes debe favorecer aprendizaje y no castigo automático.

**Accesibilidad y trato:** orientación, señalética, idioma, discapacidad, rutas a urgencias, experiencia usuario, apoyo social y participación de pacientes; no limitar el diseño a escritorio en dirección.

**Sostenibilidad:** gestionar agua, energía, residuos, compras sostenibles, equipos eficientes, consumo de nube y modelos, resiliencia ante tormentas e interrupciones, costos totales de propiedad.

## 14. Desarrollo y pruebas de aceptación para no dejar áreas invisibles

| Etapa | Componente | Criterio comprobable |
|---|---|---|
| G0 | Genesis + identidad | Organización, sedes y roles guardados y aislados |
| G1 | Evidence Engine y entrevistas | Documentos con origen, versión, contradicciones, campos pendientes |
| G2 | Graph 360° físico, RRHH, POE y procesos | Caminos de recursos/puestos/activos comprobables contra fuentes |
| G3 | Catálogo de datos y calidad | Identificadores, eventos y cinco verificaciones de calidad automatizadas |
| G4 | Bridge Factory | HIS, nómina o inventario sintético conectado con read-only y pruebas |
| G5 | PEI/POA/PAC/POE Studio | Plan con metas, presupuesto, compras, responsables y evidencias |
| G6 | Model Fleet + Deployment Architect | Estaciones, PHOENIX, proveedores, escenarios CAPEX/OPEX |
| F0 | Fabric Registry, Task Protocol y permisos | Despertar y coordinar instancias; test de acceso cruzado negativo |
| F1 | Adaptive UI por perfil | Director, jefatura, farmacia, enfermería, finanzas y RRHH |
| H1 | Flujos clínicos y farmacia | Orden firmada, validación, reserva, acuse; cero duplicados |
| H2 | Gemelo de camas, cocina y mantenimiento | Cama real vinculada, dieta válida, limpieza y equipo verificado |
| H3 | Gestión financiera y administrativa | Conciliar producción, costo, presupuesto y ejecución sin doble conteo |
| I0 | BI y calidad | Indicadores reproducibles con fuente, denominador y fecha de corte |
| I1 | Report Compiler | Reporte preparado con firma y acuse; no enviar sin autorización |
| I2 | Comités y decisiones | Acta→tarea→responsable→evidencia→cierre comprobado |
| U1 | Segunda industria | Reutilización de núcleo, nuevas reglas de dominio, cero cambios al Core por cada UI |

### 14.1 Escenario integral de certificación

**Hospital sintético de varias plantas** con consultas, urgencias, UCI, farmacia, laboratorio, cirugía, cocina, hotelería, parqueos, RRHH, finanzas, administración, dirección, comité de calidad, sistema HIS tradicional y presupuesto ficticio.

1. Genesis recibe planos, manuales, CV ficticios, contratos, POA anterior, plan de compras, 50 activos, 20 camas, inventario y expedientes simulados.
2. Detecta conflictos (plano 20 camas vs 18 habilitadas; turno sin cobertura; farmacia con caducidad; ingreso no facturado) y solicita validación.
3. Reconoce puestos y construye mapa de jefaturas, responsabilidades y perfiles PHOENIX sin revelar expedientes a otros departamentos.
4. Propone implementación híbrida, calcula clientes web, instancias, servidores, límites de IA y presupuesto con contingencia.
5. Prueba conectores y produce cada evento con ID verificable.
6. Completa Consulta → Farmacia → Enfermería; Egreso → Limpieza → Cama habilitada; Requisición → Compra → Recepción → Factura.
7. Reconcilia consultas/egresos con producción; costos con centros, inventario y nómina; presupuesto con compromisos y pagos.
8. Produce **POA preliminar**, cinco POE propuestos, informe de presupuesto, tablero del director, informe de comité e informe de producción de ejemplo.
9. Comprueba bloqueo de envío externo si falta firma, si hay duplicados clínicos o si no existe formato oficial verificado.
10. Apaga instancias, restaura colas, mide latencia y valida ausencia de pérdidas, tareas duplicadas, accesos no autorizados y reportes indebidamente enviados.

El prototipo podrá demostrar diseño y pruebas con datos sintéticos; **no equivaldrá a certificación clínica, contable ni regulatoria de un hospital real**.

## 15. Documentos de implantación que Genesis debe producir

1. Acta de alcance y autorización de diagnóstico.
2. Inventario de sedes, edificios, planos, zonas, accesibilidad y ocupación.
3. Inventario de hardware, redes, servidores, software y equipamiento biomédico.
4. Inventario de mobiliario, cocina, lavandería, seguridad, flota y parqueos.
5. Plantilla de RRHH, organigrama, manual de puestos, turnos y formación.
6. Catálogo de POE, procesos, formularios, comités y permisos.
7. Catálogo maestro de datos, indicadores, fuentes, fórmulas y calidad.
8. Matriz de obligaciones internas/externas, destinatarios, plazos, firmas y acuses.
9. Mapa organizativo AS-IS y TO-BE con brechas de recursos y riesgos.
10. Arquitectura tecnológica y diagrama de integraciones autorizadas.
11. Plan de ubicaciones, estaciones, PHOENIX lógicos, modelos y conexiones.
12. Presupuesto CAPEX/OPEX por escenario y centro de costo.
13. PEI y POA preliminares con evidencia, actividades y compras vinculadas.
14. Plan anual de contratación y programa de inversiones aplicable.
15. Planes de seguridad del paciente, control interno, ciberseguridad y continuidad.
16. Manual de operación, matriz RACI y actas de capacitación.
17. Plan de migración y conciliación para software tradicional; rollback.
18. Plan de pruebas, resultados, fallos y aceptación por unidad.
19. Sistema de reportes internos, oficiales y cuadros de mando.
20. Plan de evolución y rediseño periódicos, con solicitudes y aprobaciones.

## 16. Bibliografía y evidencia investigada

| Fuente | URL oficial | Uso en el diseño |
| --- | --- | --- |
| OMS RHIS datos de servicios | https://www.who.int/data/data-collection-tools/health-service-data | Marco de datos asistenciales y recursos |
| OMS evaluación HHFA | https://www.who.int/publications/i/item/9789240086043 | Evaluación de capacidad y preparación hospitalaria |
| OMS indicadores núcleo | https://www.who.int/publications/m/item/core-health-facility-indicators | Diseño de indicadores y calidad |
| OMS uso integrado RHIS | https://www.who.int/publications/i/item/9789240060616 | Análisis y dashboards |
| OMS seguridad del paciente | https://www.who.int/news-room/fact-sheets/detail/patient-safety/ | Calidad, riesgos, notificación y aprendizaje |
| OMS continuidad hospitalaria | https://www.who.int/publications-detail-redirect/hospital-emergency-response-checklist | Continuidad y desastres |
| SNS RIESS tipos de datos | https://repositorio.sns.gob.do/acerca-del-ries/principales-tipos-de-datos-y-temas/ | Producción, RRHH, finanzas |
| SNS RIESS fuentes | https://repositorio.sns.gob.do/acerca-del-ries/fuentes-de-informacion/ | SINAVE, SIGEF, SASP, SeNaSa, SIRNAI |
| SNS SUGEMI | https://sns.gob.do/sugemi/ | Suministro de medicamentos e insumos |
| SNS informes POA | https://sns.gob.do/wpfd_file/informe-poa-sns-t1-2025/ | Ejemplo oficial de monitoreo trimestral |
| SNS datos abiertos producción | https://sns.gob.do/transparencia/datos-abiertos/ | Series de producción hospitalaria |
| SNS organigrama hospital referencia | https://sns.gob.do/descargas/1025/resoluciones/45062/resolucion-no-004-2021-aprueba-la-estructura-del-hosp-dr-vinicio-calventi-3.pdf | Ejemplo no universal de unidades hospitalarias |
| DIGEPRES ciclo | https://digepres.gob.do/presupuesto-ciudadano/ciclo-presupuestario/ | Presupuesto público por etapas |
| DIGEPRES gasto SIGEF | https://digepres.gob.do/presupuesto-ciudadano/destino-de-los-recursos-del-presupuesto/ | Apropiación, compromiso, devengado y pago |
| DGCP legislación | https://www.dgcp.gob.do/sobre-nosotros/marco-legal/leyes-y-decretos/ | Normativa y vigencia de contrataciones públicas |
| DGCP metodología PACC | https://www.dgcp.gob.do/sobre-nosotros/marco-legal/metodologia-pacc/ | Plantillas históricas; validar actualización Ley 47-25 |
| MSP EIS resolución | https://repositorio.msp.gob.do/handle/123456789/1461 | Contexto expediente integrado de salud |
| OMS calidad de datos | https://www.who.int/data/data-collection-tools/health-service-data | Auditoría, calidad y completitud |
| OMS seguridad de hospitales | https://www.who.int/publications/i/item/9789241548984 | Seguridad física y resiliencia |

## 17. Trazabilidad del alcance y pendientes de investigación por hospital

No puede afirmarse que una arquitectura es «completa» sin descubrir las características concretas del centro. La especificación cubre un **catálogo de partida amplio**; Genesis deberá llevar un registro de **servicio existente / no existe / tercerizado / pendiente**, y **dato disponible / faltante / inferido / validado / contradictorio**.

Antes de habilitar un módulo, verificar: (a) naturaleza jurídica y dependencias; (b) oferta real y cartera autorizada; (c) normas y licencias; (d) jefe responsable; (e) datos y fuente de verdad; (f) hardware/red/equipos; (g) permisos; (h) POE aprobado; (i) presupuesto y compras; (j) conectores probados; (k) indicadores definidos y validados; (l) reportes y responsables; (m) continuidad de negocio; (n) aceptación formal.

**Regla de producto:** todo nuevo requisito detectado entra a un `gap register`, tiene prioridad, responsable, documento soporte, decisión y estado. Genesis nunca confunde diseño propuesto con ejecución efectuada, conexión con compatibilidad nominal, resultado simulado con dato real ni envío preparado con informe recibido por el gobierno.

---

# ANEXO A — Plan maestro v3.0 íntegro (conservado sin recortes)

El texto que sigue es la versión anterior. Sus numeraciones pertenecen a v3 y se conservan como antecedente íntegro, de forma que las ampliaciones v4 no borren decisiones existentes.

# PHOENIX Genesis + Fabric — Plan maestro integral v3.0

**Estado:** especificación propuesta para diseño y desarrollo; no equivale a software implementado, integrado, desplegado ni validado clínicamente.  
**Primer sector:** hospital / HealthIA. **Alcance del núcleo:** cualquier organización.  
**Fecha de elaboración:** noviembre de 2026.

## 0. Visión y principios

El primer PHOENIX de cada empresa será **Genesis**, arquitecto organizacional universal. Recibe una descripción o encuentra documentos, descubre lo que existe, identifica contradicciones y necesidades, propone una arquitectura tecnológica y humana, calcula costos, prepara instalaciones, conecta sistemas autorizados, verifica pruebas y entrega el funcionamiento a **Fabric**, que coordina instancias PHOENIX en la operación diaria. Genesis permanece disponible para evolución, mantenimiento y reorganización.

Una instancia PHOENIX conserva las capacidades universales de PHOENIX Core. Su contexto operativo, interfaz, herramientas y autorizaciones cambian según su identidad, rol, situación, institución y propósito. Se distinguen **usuarios, sesiones, dispositivos físicos, instancias lógicas, servicios permanentes y modelos/proveedores de IA**. No es necesario un LLM dedicado por PC. Las alarmas y operaciones clínicas críticas no dependen exclusivamente de inferencia LLM.

El diseño es sectorialmente neutro: un núcleo de personas, ubicaciones, activos, capacidades, eventos, tareas, contratos, documentos, aprobaciones y datos; los **paquetes de dominio** (HealthIA primero) añaden semántica y reglas específicas.

## 1. Ciclo integral de Genesis

1. **Consentimiento y alcance.** Definir patrocinador, responsables, base legal, sedes, objetivos, perfiles autorizados, exclusiones y límites de descubrimiento.
2. **Entrevista inicial.** Obtener naturaleza, tamaño, servicios, instalaciones, personal, software y expectativas; generar preguntas dinámicas, no un formulario fijo e interminable.
3. **Recolección de evidencias.** Solicitar, importar o conectar documentos y registros; aceptar documentos parciales y ausencia de información.
4. **Investigación y verificación.** Analizar sitio web, manuales, organigramas, planos, inventarios, sistemas y conversaciones con responsables; marcar procedencia y confianza.
5. **Mapa institucional AS-IS.** Reconstruir edificio, organización, equipos, empleados, procedimientos, aplicaciones, gobernanza y flujos reales.
6. **Diagnóstico de brechas.** Comparar la situación actual con normativas, capacidades operativas deseadas, riesgos y restricciones presupuestarias.
7. **Diseño TO-BE y modalidades.** Ofrecer capa PHOENIX sobre sistemas tradicionales, entorno híbrido, PHOENIX integral o migración progresiva, combinables por área.
8. **Plan de despliegue.** Dimensionar estaciones, sesiones, instancias, nodos, red, infraestructura, roles, integraciones, modelos y proveedores.
9. **Presupuesto y aprobación.** Elaborar CAPEX, OPEX, escenarios, supuestos, alternativas y riesgos; solo ejecutar cambios autorizados.
10. **Preparación técnica.** Crear identidades, asignar permisos, configurar conectores y secretos, instalar nodos y generar interfaces.
11. **Pruebas de aceptación.** Comprobar conectividad, integridad, no duplicación de órdenes, seguridad, desempeño, resiliencia y capacitación de usuarios.
12. **Activación gradual.** Enviar trabajos autorizados a Fabric, registrar aprobaciones, detectar fallos, recuperar operaciones y actualizar el modelo organizacional.

## 2. Catálogo 360° de fuentes a solicitar

### 2.1 Identidad institucional y gobernanza

- Identidad jurídica, sedes, misión, cartera de servicios, licencia, autoridades y responsables de tratamiento.
- Organigramas formales, atribuciones, comités, contratos, convenios, indicadores y planes estratégicos.
- Políticas de protección de datos, retención, acceso, archivos, seguridad, calidad, riesgos y continuidad.
- Normativa y compromisos específicos de la jurisdicción; revisión legal por responsable autorizado.

### 2.2 Arquitectura, espacios y entorno físico

- **Planos arquitectónicos**: PDF, imágenes, DWG/DXF, IFC/BIM y otros formatos con importadores autorizados; versión construida (*as-built*) y proyecto teórico diferenciados.
- Plantas, niveles, zonas, accesos, circulación pública y restringida, habitaciones, consultorios, camas, quirófanos, almacenes, depósitos, emergencias, evacuación, accesibilidad.
- Plano de redes, cableado, racks, Wi-Fi, alimentación eléctrica, UPS, redundancia, telecomunicaciones, climatización, equipos biomédicos y su ubicación.
- Mobiliario: camas, camillas, armarios, escritorios, impresoras, carros de paro, terminales, puntos de atención y otros activos.
- Metadatos: ID de espacio, área, planta, destino, capacidad, ocupación validada, responsable y plano de origen.
- Para BIM, usar IFC como formato abierto cuando exista; información de seguridad física y ubicación de dispositivos con acceso restringido. Ninguna inferencia sobre evacuación o seguridad humana se considera ingeniería aprobada.

### 2.3 Recursos humanos y organización del trabajo

- Organigrama real versus aprobado, plantillas, departamentos, plazas, vacantes y relaciones de supervisión.
- Manuales generales de RR. HH., descripciones de puestos, perfiles, escalas, competencias, turnos, calendario, vacaciones, guardias y coberturas.
- Currículos, diplomas, certificados, licencias de ejercicio, acreditaciones, fechas de vencimiento, capacitación, evaluación de competencias **solo con acceso justificado**.
- Expedientes contractuales, régimen laboral y datos de nómina separados del directorio operativo. No copiar salarios, documentos de identidad o historiales disciplinarios a memorias generales, prompts o modelos externos no autorizados.
- Verificación oficial de credenciales cuando exista fuente legítima; un CV no prueba por sí solo una habilitación profesional.
- Planes de inducción, formación, acreditación y cobertura ante ausencias.
- Recomendaciones de distribución, capacitación o dotación como propuestas para revisión humana. Nunca selección, despido, sanción, ascenso o discriminación exclusivamente por IA.

### 2.4 Manuales y procesos clínicos, administrativos y de servicio

- Manuales operativos, SOP, protocolos de admisión, triaje, consulta, hospitalización, UCI, cirugía, farmacia, laboratorio, imágenes, nutrición y alta.
- Reglas de autorización y firma; lista de medicamentos, alergias, interacciones, cadena de suministros, lotes, caducidades, dietas y procedimientos.
- Compras, facturación, cuentas, autorizaciones de aseguradoras, mantenimiento, limpieza, esterilización, lavandería, seguridad, traslados y gestión de residuos.
- Control de versiones, responsable del documento, fecha de aprobación, vigencia, excepción y evidencia de aplicación real.

### 2.5 Tecnología y sistemas existentes

- Computadoras, servidores, clientes web, dispositivos móviles, GPU, sistema operativo, RAM, espacio, red y conectividad por sede.
- HIS/EHR/EMR, farmacia, LIS, RIS/PACS, ERP, RR. HH., nómina, inventarios, contabilidad, CRM, gestión documental y otros productos.
- Fabricantes, versiones, licencias, API, SDK, documentación, intercambio de archivos, integración, base de datos autorizada, soporte y límites contractuales.
- Sitio web, dominio, portal de pacientes, intranet, correo, identidad corporativa, certificado TLS, respaldos, recuperación y monitoreo.
- Dispositivos clínicos solo mediante interfaces autorizadas, con unidades, fuente, marcas de tiempo y conexión verificadas.

### 2.6 Finanzas, logística y mercado

- Presupuestos, contratos, cotizaciones, costos de activos, consumo eléctrico, conectividad, licencias, compras, inventarios, proveedores y ciclos de adquisición.
- Costos actuales y futuros, volumen de servicios, estacionalidad, picos de concurrencia y planes de expansión.
- Fuentes externas autorizadas, proveedores de servicios, empresas de seguros, servicios subcontratados y autoridades sanitarias.

## 3. Motor de documentos y evidencia (Genesis Evidence Engine)

**Pipeline:** carga/conector autorizado → identificación de propietario y clasificación de sensibilidad → antivirus/cuarentena de contenido activo → extracción (texto, tablas, imágenes o BIM) → revisión de calidad y contexto → normalización → reconciliación de entidades → propuesta de hechos con referencia exacta → validación humana → publicación en Organization Graph.

Soportar PDF, DOCX, XLSX, CSV, JSON, XML, imágenes, escaneos, CAD/BIM compatibles y exportaciones de software. En documentos escaneados puede requerirse inspección asistida y confirmación humana. Los documentos externos y sus instrucciones embebidas son **datos no confiables**, jamás órdenes para operar herramientas.

Cada hecho debe almacenar `sourceDocumentId`, archivo/versión, página/región, actor que lo corroboró, fecha, `effectiveFrom`, jurisdicción, clasificación, caducidad, confianza y estado (verificado, declarado, inferido, conflictivo, pendiente). Al actualizar un manual o plano, generar impacto y solicitar confirmación de cambios antes de aplicar políticas.

La búsqueda semántica se limitará por permisos desde la recuperación; no indexar indiscriminadamente expedientes personales, datos clínicos o credenciales. Cuando una fuente no exista, entrevistar a un responsable y documentar la incertidumbre. Anotar las discrepancias entre manuales, sistemas y práctica real, sin esconderlas.

## 4. Organization Graph y modelo universal

**Objetos base:** `Organization`, `Site`, `Building`, `Floor`, `Space`, `Resource`, `Asset`, `Device`, `Person`, `Employment`, `Role`, `Assignment`, `Competency`, `Document`, `Policy`, `Process`, `Workflow`, `Service`, `Application`, `Connector`, `DataSource`, `DataSteward`, `AIProvider`, `PhoenixInstance`, `UIProfile`, `Task`, `Approval`, `AuditRecord`.

**Relaciones:** pertenece-a, está-en, administra, ejerce-rol, requiere-competencia, opera-equipo, usa-software, produce-dato, consume-dato, valida, solicita, entrega, restringe, deriva-de, está-regido-por.

**Capas sincronizadas:** espacial / organizativa / procedimental / digital / normativa. Separar hechos físicos estáticos de eventos operacionales (`Encounter`, ocupación, órdenes, movimientos de inventario). IDs institucionales estables, versiones y event sourcing donde corresponda; cada dominio tiene **sistema de registro** explícito.

En salud, mapear entidades compatibles con FHIR R4 cuando aplique: `Organization`, `Location`, `Practitioner`, `PractitionerRole`, `HealthcareService`, `Encounter`, `Task`, `MedicationRequest`, `NutritionOrder`, etc. El modelo PHOENIX no debe reemplazar arbitrariamente la semántica clínica de los sistemas existentes.

## 5. Entrevista inteligente y gestión de brechas

Genesis crea preguntas en función de datos faltantes, impacto y coste de incertidumbre. Ejemplos: ¿son planos ejecutados o de proyecto?, ¿cuántas camas están realmente habilitadas?, ¿quién gestiona identidades?, ¿qué software es dueño del padrón de pacientes?, ¿hay procedimientos aprobados?, ¿cuántos turnos trabajan?, ¿quién autoriza gastos?, ¿se permite conectar a Internet las redes clínicas?, ¿cuántas cuentas de IA pueden utilizarse?, ¿qué limitaciones de residencia de datos existen?

Reglas: no repetir respuestas válidas; no inventar ausencias; permitir `desconocido`; solicitar evidencias cuando las respuestas se contradicen; ofrecer propuestas provisionales. Informar la **completitud del levantamiento** y criticidad de cada vacío.

## 6. Modalidades de adopción y PHOENIX Bridge

**A. Capa sobre software existente:** conservar HIS/EHR y otros sistemas como fuente de verdad; PHOENIX lee, analiza y solicita acciones con permisos.  
**B. Híbrido:** algunas áreas nativas y otras externas; políticas de sincronización, propiedad de datos y compensación.  
**C. Integral:** PHOENIX gestiona interfaces, datos y procesos validados mediante servicios empresariales.  
**D. Migración progresiva:** fases de lectura, coexistencia, reconciliación, corte revisable y reversión; sin sustitución prematura.

**Orden de descubrimiento de conectores:** API oficial → estándares (FHIR, SMART, HL7, DICOMweb) → OpenAPI/SDK/conector compatible → eventos/webhooks → réplica o vistas de base autorizadas → archivos seguros → automatización de UI autorizada como última opción.

**Conector industrial:** inventario del producto, fabricante y versión; método de autorización; modelo de entidades; campos y unidades; pruebas contractuales; datos sintéticos; solo lectura primero; verificación posterior a escritura; rate limiting; idempotencia; reconciliación; auditoría; monitoreo y apagado. Nunca suponer compatibilidad universal de productos cerrados ni saltarse restricciones legales/contractuales.

## 7. Dimensionamiento e instalación

Genesis calcula por separado: estaciones físicas, usuarios activos, sesiones simultáneas, instancias lógicas, servidores/nodos, conectores y capacidad de IA. Escoge cliente web predeterminado, cliente de escritorio cuando requiere funciones locales, nodo institucional permanente, nube opcional y aplicación móvil de rol.

**Variables de dimensionamiento:** simultaneidad por turno, tareas por hora, latencia máxima, calidad de Wi-Fi, red segregada, RAM/CPU, GPU, espacio cifrado, disponibilidad, conectividad externa, sistema de respaldo, requisitos de operación desconectada y accesibilidad.

**Ceremonia de incorporación:** instalar/registrar → asignar identidad → autenticar nodo → verificar salud y versión → conceder capacidades → probar conexiones → validar política de modelos → test de aceptación por rol → activación gradual. Entregar comprobante firmado, versión y registro de mantenimiento. No confundir “conector instalado” con “flujo probado”.

## 8. Model Fleet Manager y presupuesto

Soportar cuentas de API organizacionales, varias cuentas por proveedor, credenciales por servicio, modelos locales, nube o mezcla. No usar cuentas personales o suscripciones de interfaz como credenciales empresariales sin confirmar que lo permiten los contratos. Guardar secretos cifrados en un vault, nunca dentro del prompt.

Asignación por tipo de tarea, sensibilidad, coste, latencia, autorizaciones, localización de datos, capacidad y respuesta de contingencia. Evitar llamar modelos cuando SQL, reglas deterministas o APIs ofrecen resultados correctos.

**Presupuesto:** CAPEX de estaciones, servidores/GPU, redes, energía, periféricos; OPEX de API/tokens, nube, mantenimiento, soporte, seguridad, copias, licencias y conectividad; implantación, formación, pruebas, migración y contingencias. Escenarios de inversión mínima, equilibrado y alta disponibilidad, con rango e incertidumbres. Separar recursos existentes y nuevas compras; registrar precios con fecha y proveedor, no inventar cotizaciones.

## 9. Adaptive UI y gemelo digital

Biblioteca autorizada de componentes declarativos: formularios, camas/espacios, inventarios, kanban, líneas de tiempo, documentos, planos, turnos, empleados, organigramas, aprobación, alertas, indicadores y conversación. Un `UIManifest` decide qué mostrar por rol, tarea, datos y permisos, con vistas persistentes, historial y recuperación de borradores.

**Hospital:** Consulta, Admisión, Enfermería, Farmacia, Urgencias, UCI, Cirugía, Laboratorio, Imágenes, Nutrición/Cocina, Servicios Generales, Recursos Humanos, Administración y Dirección. Los paneles de camas y pacientes solo representan registros verificados; visibilidad mínima por rol. El plano del hospital puede mostrarse visualmente con BIM o reconstrucción validada.

La web institucional, intranet, portal del paciente, escritorio, móvil y consola Genesis son productos diferenciados, aunque comparten identidad, UI Runtime y servicios cuando sea apropiado.

## 10. Fabric Orchestrator y colaboración activa bajo demanda

Genesis instala roles y capacidades. Fabric ejecuta el ciclo de vida de tareas: evento autorizado → política y autorización → descubrimiento de capacidad → activación de instancia → solicitud tipada → aceptación/denegación → ejecución con controles → comprobante inmutable → actualización del solicitante. Estados: queued, accepted, running, pending-approval, completed, failed, cancelled.

Desacoplar **instancia lógica** de proceso LLM residente. Servicio ligero de cola disponible, con reintentos, deduplicación, límites, pruebas de desconexión y recuperación. Las alertas clínicas vitales no dependen de Fabric como único canal.

**Flujos:** Consulta→Farmacia→Enfermería (receta firmada, validación farmacéutica, entrega, administración real); Enfermería→Cocina (dieta autorizada, preparación y entrega); Admisión→Hospitalización (cama validada, asignación, traslado); Laboratorio→Consulta (resultado validado, acuse clínico); Dirección→Finanzas (indicadores agregados y presupuestos).

## 11. Privacidad, seguridad, recursos humanos y seguridad clínica

- Control por institución, sitio, departamento, rol, relación asistencial y finalidad; autenticación multifactor cuando corresponda.
- Cada documento se etiqueta por sensibilidad: público, interno, restringido, RR. HH. confidencial, clínico protegido, financiero, secreto técnico.
- Datos de CV, nómina, evaluaciones, datos familiares y personales sensibles solo cuando sean estrictamente necesarios, con retención limitada y base de tratamiento legal. Acceso a fichas de rol/competencias no implica acceso automático al CV original.
- Ninguna decisión desfavorable de personal se adopta exclusivamente por clasificación del modelo. Controles de calidad, trazabilidad y apelación/revisión humana.
- Protección frente a prompt injection documental, gestión de secretos, registros auditables, copias verificadas, cifrado en tránsito y reposo, separación entre entornos de pruebas y producción.
- En salud: aprobaciones profesionales, cero administración ficticia de medicación, fecha/fuente de mediciones, validación de alergias y dietas y continuidad operativa sin LLM.
- Cumplimiento según jurisdicción y operación; revisión jurídica, clínica y técnica antes de producción.

## 12. Entregables de Genesis por organización

1. **Pasaporte organizacional:** alcance, sedes, modelo de servicio y responsables.
2. **Dossier de fuentes:** archivos, fechas, permisos, versiones y calidad.
3. **Mapa físico:** planos, áreas, camas, equipos, mobiliario y redes con trazabilidad.
4. **Organigrama AS-IS / TO-BE:** puestos, departamentos, funciones y autoridades.
5. **Matriz de personal y competencias:** cobertura, turnos, vacantes, acreditaciones verificadas y necesidades de capacitación, con acceso restringido.
6. **Mapa de procesos:** procedimientos actuales, excepciones, tiempos, cuellos de botella y rediseño propuesto.
7. **Inventario TI / biomédico:** estaciones, servidores, modelos, software, red, dispositivos y estado.
8. **Catálogo de aplicaciones y conectores:** compatibilidad, pruebas, propietarios y restricciones.
9. **Mapa de datos y sistema de registro:** propietarios, calidad, permisos, sincronización y retención.
10. **Plan de ubicación PHOENIX:** instancias, puntos de acceso, estaciones, nodos y perfiles de UI.
11. **Modelo de IA:** proveedores, cuentas, cuotas, políticas de coste, local/nube/híbrido.
12. **Presupuesto:** CAPEX/OPEX, escenarios, cotizaciones, incertidumbre y retorno estimado justificable.
13. **Plan de migración/coexistencia:** fases, conciliación, responsables, corte, reversión.
14. **Plan de seguridad y continuidad:** roles, aprobación, respaldos, RTO/RPO, recuperación, incidentes.
15. **Certificado de aceptación:** resultados de pruebas de flujos, fallos, excepciones y autorizaciones.
16. **Roadmap:** prioridades, dependencias, formación y evolución mensual.

## 13. Secuencia de desarrollo sin perder la arquitectura anterior

| Fase | Implementación | Prueba de aceptación |
|---|---|---|
| G0 | Genesis Foundation, organización e identidad | Perfil guardado, aislado y reanudable |
| G1 | Evidence Engine: documentos, organigramas, manuales, planos y RR. HH. | Extractor con trazabilidad y validación, sin filtrar información privada |
| G2 | Organization Graph, entrevista inteligente y reconciliación | Mapa AS-IS, brechas y fuentes verificables |
| G3 | Planificador físico/tecnológico/humano y presupuestos | Propuesta de estaciones, roles, modelos y costos con escenarios |
| G4 | Bridge Factory y sistema de registro | Integración de aplicación tradicional sintética, lectura y prueba de escritura autorizada |
| F0 | Fabric: identidades, capacidades, tareas, receipts y activación | Dos instancias se encuentran, delegan y concluyen una tarea sin duplicados |
| F1 | Adaptive UI Runtime | Diferentes roles, misma plataforma, vistas durables y permisos correctos |
| H1 | Consulta + Farmacia | Prescripción firmada → revisión → reserva → resultado |
| H2 | Enfermería / camas y nutrición | Gemelo visual con ADT real o sintético y dietas verificadas |
| H3 | Laboratorio, UCI, cirugía, urgencias, dirección | Flujos integrales probados, alarmas fuera de dependencia LLM |
| U1 | Paquete para segunda industria | Restaurante o universidad usando Genesis/Fabric sin reescribir Core |
| S1 | Multi-sede, recuperación, mejora continua | Pruebas de aislamiento, caída, reanudación y escalado |

Etapas en paralelo solo si no comprometen contratos compartidos. No se afirma que estos hitos estén implementados.

## 14. Primera prueba de extremo a extremo

Hospital sintético, con planos de varias plantas, organigrama, manual de puestos, manuales de procedimientos, inventario de equipos, archivos de personal ficticio, sistema HIS ficticio con API, farmacia y enfermería. Genesis deberá:

1. Clasificar fuentes y crear mapa de evidencia.
2. Hallar una discrepancia intencional entre plano y registro de camas, y pedir verificación.
3. Identificar puestos y credenciales de personal ficticio sin publicar CV completos a otros roles.
4. Detectar sistema tradicional, decidir conectividad, probar lectura y registrar responsable de datos.
5. Proponer PHOENIX Consulta, Farmacia y Enfermería, acceso web e infraestructura adecuada.
6. Configurar al menos dos políticas de modelo distintas y demostrar ruta sin IA.
7. Construir presupuesto con supuestos explícitos y plan de implantación.
8. Provisionar instancias ficticias, autenticar y ejecutar pruebas de conectividad/autoridad.
9. Completar flujo de orden firmada → reserva farmacéutica → notificación a Enfermería, con aprobación y trazabilidad.
10. Apagar una instancia, reactivarla y demostrar recuperación y no duplicación.
11. Generar certificado de aceptación y lista de brechas para producción.

**Criterios bloqueantes:** ningún acceso transversal indebido; ninguna decisión clínica o laboral adversa sin autorización humana; ningún paciente o vital fabricado; cero pérdidas de registros confirmados en pruebas de reinicio; conexiones verificadas, no supuestas.

## 15. Referencias de diseño

- buildingSMART IFC: https://technical.buildingsmart.org/standards/IFC/
- ISO 19650 (gestión de información BIM): https://www.iso.org/es/contents/data/standard/06/80/68078.html
- HL7 FHIR R4 PractitionerRole: https://hl7.org/fhir/R4/practitionerrole.html
- OpenAPI: https://www.openapis.org/faq
- NIST Privacy Framework: https://www.nist.gov/privacy-framework
- NIST definición de minimización: https://csrc.nist.gov/glossary/term/minimization

**Límite expresado:** el diseño no implica que PHOENIX tenga hoy todas las capacidades de importación, integración, despliegue o autonomía aquí propuestas. La entrega válida requerirá implementación incremental y pruebas reales de punta a punta.
