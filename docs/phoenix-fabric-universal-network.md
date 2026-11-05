# PHOENIX Fabric — universo abierto, red LAN y federación segura entre sedes

**Estado:** arquitectura y contratos iniciales. El planificador está implementado en
\`scripts/phoenix-genesis-fabric.mjs\`, pero todavía **no instala nodos, no inicia
conexiones ni presta servicios clínicos en red**. No confundir un plan aprobado con
una conexión verificada. Plan institucional completo:
[Genesis + Fabric v4](./phoenix-genesis-fabric-master-plan-v4.md).

## 1. Principios no negociables

1. **Universo abierto:** no codificar hospital, farmacia, doctor ni una industria
   concreta dentro de Fabric Core. Un \`industry\`, un rol y una capacidad
   son identificadores declarativos, versionados y extensibles. HealthIA es
   únicamente el primer paquete de dominio.
2. **Cada PHOENIX conserva su potencia universal:** el rol activo determina la
   interfaz y los permisos de operaciones, nunca elimina la capacidad general
   del asistente. Cambiar de rol revoca permisos previos antes de conceder otros.
3. **Dispositivo ≠ identidad ≠ sesión ≠ modelo:** un hospital con 100 PC puede
   utilizar clientes web, docenas de instancias lógicas y uno o varios nodos
   compartidos. La concurrencia real determina el dimensionamiento de cómputo.
4. **Descubrimiento por consentimiento:** Genesis puede solicitar planos,
   organigramas, manuales, currículos, inventarios, infraestructura, software,
   políticas y reportes. No escanea redes ni utiliza credenciales sin autorización.
5. **Plan, simulación y despliegue son estados distintos:** no presentar como
   conectado, actualizado o interoperable algo no probado.
6. **Los conectores son de alcance mínimo:** el software tradicional conserva
   la autoridad sobre sus datos hasta un traspaso confirmado y conciliado.
7. **No se distribuye información clínica en el bus de eventos:** las tareas
   remiten a referencias autorizadas, no a historias completas o secretos.

## 2. Topologías de red

| Modo | Dónde viven los nodos | Conectividad permitida | Condición |
| --- | --- | --- | --- |
| \`isolated\` | Equipo o instalación aislada | Ninguna entre sedes | Operación local |
| \`lan\` | Red privada del hospital | LAN privada con mTLS | Acceso por identidad y rol |
| \`overlay\` | Hospitales o sucursales | VPN/overlay privado con mTLS | Alta explícita de cada sede |
| \`relay\` | Nodos detrás de NAT/firewall | Salida autenticada a relay autorizado | Sin abrir puertos públicos |

Para conexiones fuera de la red local, el objetivo es una red privada
superpuesta, o un relay institucional con conexiones **salientes**. No
habilitar puertos públicos ni permitir un \`http://\` sin cifrar para enviar
datos sensibles. TLS mutuo, identidad de servicio, certificado validado, pin
de huella SHA-256 durante enrolamiento, autorización por sede y rotación de
credenciales. Evitar confianza automática en dispositivos de la misma LAN.

La modalidad \`lan\` no permite enlaces intersede; un enlace aprobado entre
sedes exige \`overlay\` o \`relay\`. La conexión externa debe aprobarse de
manera explícita y se mantiene \`not-connected\` hasta comprobar identidad y
canal reales. Los dispositivos médicos se alojan en redes segmentadas y nunca
dependen del éxito de un LLM para sus alarmas esenciales.

### 2.1 Federación con organizaciones independientes

Una sede del mismo hospital pertenece a su propia organización; una farmacia
externa, ARS, laboratorio contratado, proveedor, universidad o ministerio
**no** adquiere esa misma identidad. Una federación externa necesita:

- Identidad institucional distinta, propietario de la conexión y convenio
  de intercambio de datos verificado.
- Capacidades concedidas una a una, propósito, vigencia y clasificación de
  información; todos los demás permisos permanecen denegados.
- Transporte privado \`overlay\` o \`relay\`, huella del certificado del par,
  autenticación mutua y prueba efectiva antes de marcar el enlace conectado.
- Intercambio mínimo de referencias y comprobantes, con consulta autorizada
  al registro de origen. Para reportes de gobierno usar agregados aprobados,
  nunca una réplica masiva de expedientes identificables.
- Revocación inmediata, auditoría bilateral, política de residencia, límites
  de tasa y procedimientos de continuidad independientes de la IA.

El planificador reconoce \`network.partners\` separados de
\`network.peers\` y rechaza redes externas sin aprobación, convenio y
capacidades concretas. El estado sigue siendo \`not-connected\`: **es un
contrato de diseño, no una conexión instalada**.

## 3. Descubrimiento y enrolamiento de un nuevo PHOENIX

1. Genesis registra organización, sedes, dominios de confianza y responsables.
2. El administrador define nodos, estaciones, roles, fuentes de información y
   rutas de red autorizadas; el sistema puede sugerir, no aprobar por sí solo.
3. Se genera una invitación de enrolamiento de un único uso, expirable.
   La aceptación se vincula a una identidad de servicio y certificado.
4. El nodo realiza una conexión saliente hacia el registro/relay autorizado,
   o al endpoint privado permitido por la LAN/overlay.
5. El registro verifica origen, certificado, versión, organización, sede,
   capacidades declaradas y políticas de acceso.
6. Se prueba latencia, heartbeat, disponibilidad, compatibilidad de esquemas,
   revocación, credenciales y permisos en ambos sentidos.
7. El nodo publica capacidades mínimas y su estado; no anuncia secretos,
   pacientes ni inventarios confidenciales.
8. Las tareas usan colas duraderas, idempotencia y comprobantes firmados;
   al desconectarse un nodo las tareas esperan o fallan explícitamente.
9. Ante revocación se cierran autorizaciones; la desconexión y pérdida de
   confirmaciones se distinguen del éxito.
10. El acta de aceptación incluye el estado real de cada prueba y un rollback.

**No usar descubrimiento de puertos o inventario de redes sin autorización.**
Se pueden importar inventarios, DHCP/DNS autorizados, CMDB y catálogos de
dispositivos del responsable informático.

## 4. Contratos mínimos

\`OrganizationSpec\`: identidad, dominio, estructura y adopción
(\`existing-overlay\`, \`hybrid\`, \`phoenix-native\`,
\`progressive-migration\`).

\`EvidenceRecord\`: fuente, versión, propietario, fecha, sensibilidad,
autoridad, calidad y relación con el Organization Graph.

\`InstanceIdentity\`: organización, sede, instancia, operador autorizado,
certificado, permisos y vigencia.

\`CapabilityManifest\`: identificador de capacidad, versión, entradas,
salidas, riesgos, autorización humana, costo y proveedor autorizado.

\`NetworkPolicy\`: \`isolated|lan|overlay|relay\`, enlaces expresamente
aprobados, huellas de pares, rutas, clasificación de datos y revocación.

\`TaskEnvelope\`: referencias no sensibles, destino por capacidad,
correlación/idempotencia, plazo, aprobación y alcance institucional.

\`TaskReceipt\`: aceptación, rechazo, progreso, aprobación, finalización o
fallo, emisor, versión, prueba, sello temporal y auditoría.

\`UIManifest\`: vistas declarativas de componentes aprobados, indicadores,
permisos y fuentes; prohibir inyección de código libre en vistas operativas.

El módulo de planificación implementa un subconjunto **validado y offline**
de \`OrganizationSpec\`, \`NetworkPolicy\` y \`TaskEnvelope\`. No incluye un
servidor de tareas distribuido ni garantías de entrega.

## 5. Despliegues que Genesis debe recomendar

- **Una sola PC:** PHOENIX personal; operación local e interfaz contextual.
- **Consultorio pequeño:** clientes web opcionales, nodo compartido, identidad
  por profesional y expedientes con permisos.
- **Hospital LAN:** servidor institucional y recuperación, clientes web,
  agentes de integración locales para HIS/LIS/RIS/finanzas y segmentación.
- **Red de hospitales:** sedes aisladas por dominio/tenant, conectividad
  privada, gobierno central de capacidades, reglas de residencia de datos.
- **Corporación no sanitaria:** mismas interfaces/contratos; cambian los
  paquetes de dominio, activos, flujos, regulación y plantillas de informes.

Genesis calcula estaciones faltantes, instancias lógicas, proveedores y
presupuesto solo con datos y precios autorizados. Nunca asignar precio a un
modelo o hardware que no haya sido cotizado. Centralizar reportes solamente
cuando el origen, período y reglas de agregación estén validados.

## 6. Requisitos transversales adicionales

- Mapas físicos, administrativos, humanos, tecnológicos, contractuales,
  financieros, ambientales, riesgos y procesos; evidencia con procedencia.
- Gestión de personal y turnos con mínimos privilegios; nunca divulgar CV,
  nómina o evaluaciones laborales al resto de instancias.
- Planificación PEI, POA, POE, compras, cronograma financiero y reportes a
  autoridades, usando versiones y plantillas oficiales según jurisdicción.
- Centros de costos, facturación, contratación, seguros, parqueos, cocina,
  lavandería, residuos, transporte, energía, mantenimiento, biomédica y
  continuidad: componentes genéricos y dominios extensibles.
- Catálogo de 60 áreas, 135 indicadores, 20 comités y 34 tipos de informes
  en el documento v4: **catálogo inicial ampliable, no límite artificial**.
- Panel de costo por proveedor/rol/sede, consumo, productividad, disponibilidad,
  latencia, incidentes, calidad de datos y concordancia de reportes.
- Operación sin conexión según tarea, reconciliación al reconectar, reglas
  explícitas de conflicto, respaldo cifrado y recuperación probada.
- Privacidad diferencial por propósito y paciente; acceso extraordinario
  (break-glass) auditado y revisable, no permisos implícitos.

## 7. Hitos de implementación real

1. **Entregado en este cambio:** plan institucional completo, planificador
   de arquitectura local independiente de sector, contratos y pruebas
   automatizadas del comportamiento de política.
2. Persistencia transaccional del Organization Graph, evidencias, inventario,
   presupuestos y catálogos institucionales cifrados por tenant.
3. Servicio de registro y enrolamiento con CA institucional/PKI, mTLS,
   rotación, comprobantes y permisos efectivos.
4. Transporte LAN y overlay/relay con colas, heartbeat, comprobantes, reintentos
   e idempotencia respaldados en almacenamiento durable.
5. Integración segura con software tradicional: primero lectura, después
   conciliación y escritura aprobada; pruebas de sincronización.
6. Adaptive UI con vistas por contexto, roles, mapas de recursos y métricas.
7. Primer flujo demostrable HealthIA con datos sintéticos
   Consulta → Farmacia → Enfermería; posteriormente todo el hospital.
8. Validación de segundo sector (comercio/educación), sin cambios en Core.

**Criterios bloqueantes:** no declarar online una instancia no probada,
no publicar puertos externos automáticamente, no ejecutar acciones clínicas
o financieras no autorizadas, no inventar información, no duplicar efectos
tras reintentos, no divulgar información fuera del dominio permitido.
