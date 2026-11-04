# `@phoenix-ai/dsh-tool-healthia`

[English](README.md) | [中文](README.zh.md)

On-demand HealthIA model surface.

PHOENIX keeps only one small global tool, `healthia_activate`. When the current
request is genuinely health-related, that tool mounts the richer clinical
toolset and its safety/continuity guidance into the calling agent's scope.
Other conversations keep their normal tool catalog and do not pay the token
cost of the full HealthIA surface.

The scoped foundation tools cover:

- patient-profile discovery/create/update;
- bounded longitudinal snapshots;
- provenance-bearing health facts;
- patient-scoped record queries;
- open/update clinical episodes.

The clinical prompt explicitly requires patient isolation, adaptive interviewing,
red-flag prioritization, separation of fact/inference/evidence, longitudinal
comparison, and human authority for prescription/diagnosis-sensitive decisions.
It also tells HealthIA to use the rest of PHOENIX — evidence search, multimodal
analysis, maps, scheduling, browser/computer, connectors and Tool Forge — when
those capabilities are available and relevant.

## Model Experience

### Global HealthIA activation

#### What the model sees

One global tool schema named `healthia_activate`. Its description tells the
model to activate HealthIA before substantive reasoning for symptoms,
medications, labs, medical images/documents, vital signs, prevention,
condition-specific lifestyle work, devices, care navigation and longitudinal
follow-up.

#### Token effect

Fixed and small outside health conversations: only the activator schema.

#### KV Cache effect

Prefix-stable until HealthIA activation. Activating HealthIA changes the
calling agent's tool set for later steps in that conversation.

### Activated clinical scope

#### What the model sees

After activation, the calling agent receives the HealthIA clinical guidance and
the patient/record/episode tools documented above. Parent/sibling agents do not
receive those scoped registrations automatically.

#### Token effect

Conditional. The larger health schema and guidance are present only after a
health context activates them.

#### KV Cache effect

Activation intentionally changes the request prefix for that agent because its
capability set has changed. Non-health agents preserve their prior prefix.

## Known Limitations and Deferred Work

- **Model-selected activation in the foundation** — the activator is explicit
  and cheap. A later Health Context Resolver can add deterministic/auxiliary
  routing for ambiguous cases without changing the scoped clinical toolset.
- **Foundation tools, not the complete HealthIA specialty** — dedicated
  medication, evidence, imaging, device/FHIR, prevention, risk, community,
  benefits, appointment and clinical-judge packages remain to be layered over
  the same patient record.
- **No prescription authority** — tools record and retrieve evidence; they do
  not grant autonomous medication-change or definitive diagnostic authority.

## Native HealthIA chat cards

First-party tool receipts from `healthia_activate`, `health_patient_list`,
`health_patient_create` and `health_patient_snapshot` can be presented as
schema-validated `ui_canvas` cards by the PHOENIX conversation renderer.
The cards do **not** depend on Kira authoring JSON in a text response:

- activation/list: bounded patient selection and a field to draft a new demo
  patient request through the existing chat composer;
- successful create: a confirmed profile with follow-up actions;
- snapshot: profile identity and counts without dumping sensitive clinical
  observations in the card.

No card claims a patient was saved without a successful first-party creation
receipt with a validated patient identifier. A failed or foreign tool result
cannot publish a HealthIA card. Buttons only draft follow-up instructions in
the chat composer and do not bypass model tools, server validation or consent.

**Important:** Conversational HealthIA uses its owner-local health-data
provider. This is separate from the authenticated clinician workstation
`/health`; a chat profile is **not** a signed EHR patient or consultation.
We must not synchronize identities by labels or imply that the two stores
are already unified. Test only with fictional profiles.
