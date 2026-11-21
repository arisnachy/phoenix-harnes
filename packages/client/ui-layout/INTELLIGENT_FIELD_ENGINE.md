# PHOENIX Intelligent Field Engine — deployment and limits

## Generic App Studio

- Each generic text or textarea field has optional AI configuration (disabled by default), four tasks (polish, summarize, structure, extract), and up to 320 characters of supplementary instructions.
- The user presses "Proponer con Kira"; the existing conversation composer receives a draft that the user must review and send. The model is not silently invoked by a field.
- Kira returns an adaptive_field_result v1 block. The chat offers "Mostrar diferencia en el formulario". The exact request ID, installed generic app ID, section, field, form revision and unchanged original text must match. The form shows before/after and the user must explicitly accept or discard.
- Kira can propose an adaptive_control v1 operation set-field-ai with appId, sectionId, fieldId, expectedRevision, enabled, skill and instruction. The revision belongs to the per-field AI policy. The existing two-phase preflight and approval gate applies.
- Form values remain in React memory. Only field AI configuration metadata is stored in a scoped, versioned browser snapshot with backup and rollback. This path must not receive PHI, passwords or other secrets.

Example configuration command:
    {"component":"adaptive_control","version":1,"props":{"appId":"app-inventario","sectionId":"inicio","fieldId":"field-1","operation":"set-field-ai","expectedRevision":0,"enabled":true,"skill":"polish","instruction":"Conservar cantidades y unidades."}}

Example response (the exact requestId and form revision must match a request created on screen):
    {"component":"adaptive_field_result","version":1,"props":{"appId":"app-inventario","sectionId":"inicio","fieldId":"field-1","requestId":"field-1234567890000","expectedRevision":1,"text":"Texto propuesto","missingInformation":[]}}

## Healthia (protected clinical console)

The authenticated clinical console /health uses its existing encrypted record store, clinician assignment and authorship rules, same-origin POST and CSRF. This is independent of generic App Studio and its chat.

- "Proponer HEA desde entrevista" structures only recorded complaint/answers. It is deterministic local software, NOT a model. It lists omissions, does not generate clinical negatives and does not save or sign anything.
- "Mejorar con IA local (opcional)" is disabled by default. When an operator enables it, it sends the currently documented clinical draft to only http://127.0.0.1:11434/api/generate, never to an arbitrary URL or to the general Kira chat. The operator specifies an installed model, and each clinician request requires an explicit confirmation.
- The returned model text is UNVERIFIED, with warnings for numerical values absent from its input. The professional verifies the before/after and either discards the suggestion or copies it into the local SOAP editor. The existing save, review and signature workflow remains mandatory. A signed note cannot be changed by this feature.
- Loopback is not a guarantee against an Ollama model delegating to cloud. The operator is responsible for vetting the local model, prompts/log retention and clinic policies; cloud-tagged model names are rejected.

PowerShell session running the PHOENIX Host:

    ollama list
    $env:PHOENIX_HEALTH_LOCAL_AI_ENABLED="1"
    $env:PHOENIX_HEALTH_LOCAL_AI_MODEL="<exact-local-model-name>"
    pnpm phoenix

Replace the placeholder with an actual locally installed and approved Ollama model. These variables are opt-in. To disable, unset PHOENIX_HEALTH_LOCAL_AI_ENABLED or set it to 0. Never use real patient data without adequate authorization, privacy impact review and clinical validation.

## Validation and safeguards

- pnpm run test:adaptive:ui (generic field configuration, proposal validation and approval).
- pnpm run test:healthia:note (recorded facts, authorization, no persistence, local Ollama and hallucinated number warnings).
- pnpm run test:adaptive:all (all adaptive, clinical, privacy and Windows recovery checks).
- Required CI, clinical security and Windows tests must succeed before any PR can be merged/promoted.

Not implemented: silent model calls from form controls, clinical patient-to-chat copying, automatic clinical diagnosis, note sign-off, arbitrary external API execution or unreviewed model-suggested UI code.
