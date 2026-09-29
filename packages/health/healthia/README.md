# `@phoenix-ai/dsh-healthia`

[English](README.md) | [中文](README.zh.md)

Provider-neutral longitudinal health capability seam for PHOENIX.

HealthIA is additive: it does not replace PHOENIX, change the Web layout, own a
model provider, or make conversation history the medical record. It exposes
`ctx.healthia`; a provider owns durable storage and consumers add clinical
reasoning, device, evidence, community, appointment, and other health
capabilities over that seam.

## Core contract

The first layer stores three deliberately small primitives:

- isolated patient profiles;
- provenance-bearing canonical health records;
- longitudinal clinical episodes.

Every record carries `patientId` and provenance. A consumer must never persist
a model hypothesis as a patient fact. `snapshot()` returns a bounded view for
reasoning; it is reconstructed from canonical state rather than chat history.

The service emits `healthia/patient`, `healthia/record`, and
`healthia/episode` only after a provider has committed the corresponding
change.

## Model Experience

### Longitudinal health service

#### What the model sees

`ctx.healthia` contributes no prompt, tool schema, or patient data by itself;
model-facing consumers decide which bounded patient projection enters a request.

#### Token effect

No model tokens are added by this service definition alone. HealthIA consumers
pay only for the clinical context they explicitly project.

#### KV Cache effect

The seam is prefix-neutral by itself. Cache behavior changes only when a
model-facing HealthIA consumer mounts prompt content or patient-scoped tools.

## Known Limitations and Deferred Work

- **Foundation schema only** — FHIR/DICOM projection, device ingestion,
  medication/evidence engines, preventive-care rules, community navigation,
  benefits, appointments, clinical judging, and HealthIA ONE mission adapters
  build on this canonical patient boundary in later packages.
- **No autonomous diagnosis or prescribing authority** — a future clinical
  reasoner may assist with differential reasoning and evidence review, while
  sensitive diagnosis/treatment changes retain explicit human/clinical
  authority and emergency escalation.
