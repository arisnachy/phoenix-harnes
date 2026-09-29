# Health

Optional native health capability family for PHOENIX.

| Package | Role | Context key |
|---|---|---|
| `@phoenix-ai/dsh-healthia` | Service Definition for patient-isolated longitudinal health data | `ctx.healthia` |

HealthIA is additive. Phoenix Core must remain fully operational when the health group is absent, disabled, degraded, or upgraded independently.

The health group will contain separate provider and consumer roles as they land: encrypted persistence, health-context resolution, clinical interview and reasoning, medication/evidence review, device and FHIR/DICOM adapters, monitoring, prevention, community/benefits navigation, appointments, and patient-specific tools.

## Model Experience

The group itself adds no model context. Individual consumers own bounded, patient-scoped model-visible inputs.

## Known Limitations and Deferred Work

Only the Service Definition exists in the initial foundation. No plaintext health persistence is permitted as a temporary shortcut.
