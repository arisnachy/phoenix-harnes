# `@phoenix-ai/dsh-tool-healthia`

[English](README.md) | [中文](README.zh.md)

On-demand HealthIA patient-scoped tools. PHOENIX keeps one small global activator; only explicitly requested personal care or patient record work should mount the clinical toolset. Simulated cases, literature reviews, academic clinical reports, and general medicine questions use research tools without opening patient records.

The scoped foundation tools cover patient-profile discovery/create/update, bounded longitudinal snapshots, provenance-bearing health facts, patient-scoped record queries, and clinical episodes. Patient profiles in chat are separate from signed professional /health records.

## Native HealthIA chat cards

A successful `healthia_activate` receipt changes available capabilities but does not fetch patient identities or render any patient card. A `health_patient_list` result is background metadata only and likewise produces no UI.

Only the explicit `health_patient_workspace` tool displays the patient-selection and new-demo-profile interface, following a request to browse, open, create or manage profiles. A verified `health_patient_create` receipt may show a created-profile confirmation, while `health_patient_snapshot` may show a bounded patient summary. Foreign, invalid and failed receipts never authorize UI. No form saves a patient without a successful first-party create operation.

## Model Experience

### Global HealthIA activation

#### What the model sees

The global `healthia_activate` tool is for personal patient care, longitudinal follow-up or explicit patient record management only. Do not activate for academic reviews, simulated clinical cases, medical quizzes or guideline research.

#### Token effect

Fixed, small tool schema outside patient-record workflows.

#### KV Cache effect

Prefix-stable until an eligible patient workflow activates HealthIA.

### Activated clinical scope

#### What the model sees

Patient record tools include read-only `health_patient_list`, explicitly visual `health_patient_workspace`, and patient create/update/snapshot, records and episodes. The activator does not return patient lists. Parent and sibling agents do not automatically inherit these tools.

#### Token effect

Clinical schemas and guidance are included only in the activated agent scope.

#### KV Cache effect

Activation deliberately changes the selected agent's tool prefix; unrelated work retains the general configuration.

## Known Limitations and Deferred Work

- **Model-selected activation** — the foundation still depends on choosing the correct tool; an explicit separate patient workspace prevents accidental intake UI even if an activation is invoked during research.
- **Foundation tools only** — specialist medication, evidence, imaging, devices, prevention and clinical-judge capabilities require further integration.
- **No prescription authority** — the tools cannot independently change medication or establish a definitive diagnosis.
