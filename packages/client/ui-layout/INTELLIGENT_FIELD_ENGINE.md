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

## Healthia (authenticated clinical console)

Healthia is registered **automatically on the loopback-only Host**, with its encrypted store initialized lazily when /health is visited. No PowerShell or environment-variable enablement is required; explicit PHOENIX_HEALTH_ENABLED=0 remains an operator opt-out. No default clinical account or password is created. Existing administrator setup, clinician login, ownership, CSRF, review and signing rules remain in force. Patient portal invitations remain a separately authorized operation.

- **Proponer HEA desde entrevista** always works without a model. It structures only recorded facts, without inventing negative findings, and never saves or signs automatically.
- **Modelo de IA disponible en PHOENIX** enumerates real loopback Ollama text models and provider/model routes already registered in PHOENIX's LLM service, including local Phoenix, OAuth (e.g., Codex), and API-key-backed providers. No API keys, OAuth bearer tokens or user-configured endpoint URLs are returned to the clinical frontend.
- The default selection is **a local route only** (Ollama preferred, then the registered Phoenix Local route). Registered remote providers are visible but never selected or invoked as a fallback without the clinician explicitly choosing one.
- At invocation time the server re-checks the registered model route, the owning clinician/unsigned encounter, and consent for this exact request. A local model requires confirmation; any external model displays an explicit outbound clinical-data disclosure and requires a separate external-processing acknowledgement.
- The LLM request uses PHOENIX's **existing authenticated model adapter**, not a second credential store. An auth failure is reported as a failure; no provider fallback is attempted.
- The returned data is **phoenix-model-unverified**. The clinical UI verifies encounter version and unchanged source; it presents a proposal plus numeric discrepancy warnings. The professional must explicitly accept, edit, save and later review/sign within the protected clinical system.
- When a model is unavailable, Healthia retains the deterministic HEA builder. The Host does not silently download models, turn on external transmission or invent a usable provider.

**Important:** Registering a model does not prove that its credentials are currently valid, that it is capable of the requested clinical text task, or that its provider has approved data handling for clinical records. Local model processes must be vetted for privacy and hardware suitability before real-patient use.

## Validation and safeguards

- pnpm run test:adaptive:ui (generic field configuration, proposal validation and approval).
- pnpm run test:healthia:note (recorded facts, authorization, no persistence, local Ollama and hallucinated number warnings).
- pnpm run test:adaptive:all (all adaptive, clinical, privacy and Windows recovery checks).
- Required CI, clinical security and Windows tests must succeed before any PR can be merged/promoted.

Not implemented: silent model calls from form controls, clinical patient-to-chat copying, automatic clinical diagnosis, note sign-off, arbitrary external API execution or unreviewed model-suggested UI code.
