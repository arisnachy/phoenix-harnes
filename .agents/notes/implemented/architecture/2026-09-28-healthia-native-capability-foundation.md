# HealthIA native capability foundation

## Decision

HealthIA is a native, optional Phoenix capability rather than a separate application, preset, or UI mode. Phoenix keeps its existing interface and core behavior. Health-specific behavior activates through normal plugin composition and model/tool extension points.

## Boundary

The first package, @phoenix-ai/dsh-healthia, is a state-free Service Definition. It establishes patient isolation, longitudinal observation provenance, bounded snapshot reads, and deletion semantics without choosing a persistence medium.

A provider must supply encrypted durable storage. Clinical consumers (interview, reasoning, medication/evidence review, multimodal analysis, prevention, devices, community/benefits, scheduling, tool generation) depend on the service instead of changing agent-loop.

## Why

Health information must not be folded into generic conversational memory. A typed patient boundary prevents cross-person contamination and lets future FHIR, DICOM, wearable, laboratory, and EHR adapters normalize into one longitudinal record.

Keeping Phoenix Core independent means HealthIA can fail, be absent, or be upgraded without preventing Phoenix from starting.

## Follow-up seams

1. encrypted local provider with explicit key ownership and provenance invariant;
2. health-context resolver that identifies the active patient without UI changes;
3. bounded model-context consumer and clinical interview tools;
4. event-driven monitoring and baseline/pattern detection;
5. FHIR/SMART, DICOM, device and laboratory adapters;
6. evidence/medication intelligence;
7. prevention, community resources, benefits, forms, maps and appointment orchestration;
8. patient-specific Tool Forge workflows.

## Safety and observability

Derived findings must retain their input provenance and uncertainty. Correlation is not stored as causation. Clinically important model-visible outputs require an independent health judge before they are treated as verified findings.
