# PHOENIX Fabric: agentes universales colaborativos por rol — arquitectura futura

> **Actualización arquitectónica:** [Plan maestro Genesis + Fabric v4](./phoenix-genesis-fabric-master-plan-v4.md) — investigación institucional integral, 60 áreas, 135 indicadores, 20 comités y 34 informes. [Universo abierto y red LAN/entre sedes](./phoenix-fabric-universal-network.md). Ya existe un planificador offline con pruebas en `scripts/phoenix-genesis-fabric.mjs`; la federación real, la instalación remota y la orquestación clínica distribuida **aún no están implementadas**.

**Estado:** visión aprobada para diseño futuro, NO implementada en esta entrega.
**Propietario:** PHOENIX Universal Harness. **Primer motor vertical:** HealthIA.
**Principio invariable:** cada instancia es PHOENIX completo; la función activa y las capacidades autorizadas dependen del contexto, no de un modelo distinto ni de un producto cerrado.

## 1. Idea

En una organización existe un **tejido de instancias PHOENIX**, cada una con identidad técnica, perfil de función, equipo, privilegios, capacidades y herramientas, que se despiertan y colaboran mediante tareas declarativas.

Ejemplos: PHOENIX Consulta, PHOENIX Enfermería, PHOENIX Farmacia, PHOENIX Emergencias, PHOENIX UCI, PHOENIX Quirófano, PHOENIX Hospitalización, PHOENIX Laboratorio, PHOENIX Imagenología, PHOENIX Nutrición/Cocina, PHOENIX Administración, PHOENIX Dirección, PHOENIX Autoridad Sanitaria. La misma infraestructura servirá más adelante a restaurantes, comercios, educación, logística y sector público. Ninguna instancia pierde funciones universales: únicamente ejecuta acciones permitidas para su rol activo.

No se trata de copiar el historial clínico entero a cada agente. El contexto llega **por capacidad, propósito, paciente e institución**, con acceso mínimo, consentimiento y autoría.

## 2. Contratos estables

* \`InstanceIdentity\`: tenant, site, instanceId, operator/service principal, display name, trust domain, residency policy.
* \`RoleContext\`: role profile, capabilities, active assignment, work queue, current location, privileges and time-bound purpose.
* \`CapabilityManifest\`: version, input/output schema, granted scopes, billing/cost, availability and clinical approval gate.
* \`WorkflowTask\`: taskId, correlationId, initiator, target capability, reference IDs (never raw PHI in the event bus), deadline, idempotency key, desired receipt.
* \`TaskReceipt\`: accepted/rejected/started/pending-approval/completed/failed, actor, signed version, result reference, audit ID.
* \`EscalationPolicy\`: when a human physician/pharmacist/nurse/dietitian/administrator must approve.
* \`UIProfile\`: adaptive views and contextual cards for consultant, nurse, pharmacist, patient, finance, ICU, etc., with a universal command palette.

A request from Consulta to Farmacia is not a command to dispense. It is a **typed service request** validated against an authenticated signed prescription, stock, formulary, relevant allergies and professional authority. The pharmacy actor may reserve, ask questions, refuse, or obtain human confirmation.

## 3. Communications and activation

1. Event from an authorized clinical action (e.g. signed medication request).
2. Route to the *capability registry*, not to the first available model.
3. Authorize initiator, receiver, tenant, patient-care relationship and purpose before reading protected details.
4. Wake the specialist instance on demand with a minimal clinical context reference.
5. Specialist evaluates constraints, optionally offers an action preview and obtains required professional approval.
6. Execute via typed tools with concurrency control and idempotency.
7. Produce a durable receipt and a status update visible in the original consulta.
8. Audit and expire delegated authorization; do not keep credentials in prompt memory.

Prefer asynchronous tasks with queues, retries, compensation, backpressure and explicit failure states. Emergent clinical critical alerts cannot depend on a best-effort LLM call alone.

## 4. HealthIA vertical mapping

* **Consulta:** schedule, intake, longitudinal chart, diagnosis/assessment draft, professional signature, prescriptions, referrals and follow-ups.
* **Farmacia:** signed orders, prior authorizations, inventory by location/lot/expiry, interactions/allergies, reservation, dispensing and stock movements; never autonomous uncontrolled dispensing.
* **Enfermería:** bed/ward status, shift handover, real vital observations, medication administration record, task queue, fall risks, documentation and escalation.
* **Hospitalización:** actual admission/transfer/discharge events (ADT), available beds and care teams, isolation restrictions and occupancy with real audit.
* **Emergencias:** triage support, time-to-clinician, alerts, clinical notes, urgent orders and safe routing; human triage decision and escalation.
* **UCI:** connection to authorized patient-monitor interfaces, units/time-series, threshold validation, duplicate suppression, alarm latency and caregiver acknowledgment. No fictional normal readings.
* **Cirugía:** preoperative checks, consent, safety checklist, operating-room schedule, implants, anesthetic record, recovery and postoperative tasks.
* **Nutrición y cocina:** verified diet orders with allergies, swallowing/aspiration precautions, fluid restrictions and other clinical requirements; approval by responsible professional.
* **Laboratorio/Imágenes:** specimen/worklist/PACS, critical results, image studies and clinician acknowledgment.
* **Administración:** staffing, purchasing, invoices, payer rules, inventory, audits and finance; no access to unrelated diagnosis detail.
* **Dirección/ministerio:** approved aggregate indicators, planning and quality governance, with strong de-identification and legal authority; never unrestricted access to identifiable EHR.

## 5. Digital twin of the hospital is an operational view, not a video game

A ward map may display visual bed occupancy with consent and role-appropriate data. Each icon is connected to an actual bed / encounter / admission record. Use anonymized state for visitors. A patient icon must not imply actual vital measurements unless received, timestamped and verified from authorized devices. Virtual representation is never an independent source of clinical truth.

Example closed workflow: nurse anticipates pharmacy demand from **valid future medication schedules**; Kira suggests a reservation, pharmacist approves dispensing, signed administration documents actual delivery. A nutrition order follows a valid prescribed diet and kitchen receives only needed operational details.

## 6. Security, tenancy and interoperability

* Shared identity federation but separate roles per clinic/site/service; no automatic organization-wide record sharing.
* Consent, legal basis, clinician relationship, purpose-of-use, least privilege, audit, session limits and immutable clinical receipts.
* No patient data copied into general Kira memory, prompts or generic business library.
* FHIR R4, SMART, HL7 v2, DICOMweb, IHE profiles and jurisdiction-specific standards where applicable.
* Authenticated local bridge / secure outbound agent for existing systems; never blind scanning of internal networks or automatic privilege escalation.
* Per-event schema versioning, replay protection, message integrity, idempotency, observability and deterministic fallback when model is offline.
* Multi-tenant encryption, clinical residency, backup/restore, retention, incident response and temporary access review.

## 7. Delivery strategy and non-goals

1. Complete the single-professional protected clinical experience and longitudinal record first.
2. Define the universal capability/task/receipt protocol without hardcoding the health domain into PHOENIX Core.
3. Prototype **Consulta → Farmacia** request/acknowledge with synthetic data and two independent authorized instances.
4. Add nursing + bed board, then lab/imaging, dietary orders and hospital management using verified workflows.
5. Introduce public-health aggregates and other industries only after the core orchestration is reliable.

This document records the user's multi-instance vision for future expansion. **No distributed autonomous hospital actors, pharmacy dispenser, monitoring devices, real patients or cross-enterprise messaging are delivered by the current PR.**
