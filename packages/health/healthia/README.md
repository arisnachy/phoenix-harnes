# @phoenix-ai/dsh-healthia

Native longitudinal health capability contract for PHOENIX.

HealthIA is **additive**. It does not replace Phoenix, change the chat layout, or become a Phoenix boot dependency. When a HealthIA provider is composed, health-specific consumers can maintain patient-isolated longitudinal records and use them for clinical interviewing, monitoring, evidence review, multimodal analysis, prevention, community navigation, benefits, appointments, and generated patient tools.

The service intentionally does not define a plaintext persistence implementation. Health data is sensitive; a provider must own encrypted durable storage, provenance, consent boundaries, and deletion semantics.

## Model Experience

### Longitudinal health context

#### What the model sees

Nothing by loading this package alone. Model-visible clinical context must be contributed by a separate scoped consumer for an explicitly resolved patient and current health task.

#### Token effect

Zero until a HealthIA consumer contributes bounded patient context.

#### KV Cache effect

Zero for this Service Definition. Consumers should keep snapshots bounded and stable when the underlying patient state has not changed.

## Architectural invariants

- Patient observations always carry an opaque PatientId.
- Health records remain separate from general Phoenix memory.
- Every clinical observation carries time and provenance.
- Phoenix Core must boot and operate normally without HealthIA.
- UI changes are not required for HealthIA activation.
- Providers must not persist clinical records in unencrypted ad-hoc JSON.

## Known Limitations and Deferred Work

- This package is the Service Definition only. The encrypted local provider, clinical-context resolver, model tools, FHIR/DICOM/device adapters, evidence engine, and proactive monitoring consumers are separate capability roles and land independently.
