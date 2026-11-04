# HealthIA Chat-First Intake & Patient Identity Architecture

Status: staged implementation. PHOENIX remains a universal agentic harness;
HealthIA is a domain engine, not a fork of the whole assistant.

## Product objective

The clinician should converse with Kira to register, locate, treat, follow up,
communicate with, and bill a patient. The patient must not require a web
account to receive in-office care. The interface adapts to solo physician,
receptionist, nurse, virtual assistant and remote teleconsultation workflows.

**One real clinical record.** A chat profile or a summary is not an EHR chart.
The protected clinical store is the source of truth. Reconciliation between
the existing owner-local conversational provider and /health must precede
any UI claim that the two have been unified.

## Intended interaction in the PHOENIX chat

- Physician: "Kira, register a patient."
- Kira opens a first-party **protected clinical form**, not a text questionnaire.
- The form searches an authorized patient index as the physician types or
  explicitly presses Search. Exact identity and probable matches are distinct.
- If a match exists, the physician opens the existing authorized chart.
  A restricted match goes to an authorized resolution queue.
- Only an authorized clinician can confirm that an apparent match belongs
  to a different person; record the rationale and timestamp.
- The physician chooses "Start visit". The EHR persists the patient and
  encounter and returns only a bounded status receipt to Kira.
- Kira displays the longitudinal card: previous visit, active medication,
  allergies review status, outstanding results, previous orders, pending
  follow-ups, and shortcuts to record observations and upload documents.
- Kira proposes questions, drafts and plans; the physician reviews and signs.
  Never convert a model hypothesis into an accepted clinical fact.

**Privacy boundary:** identifiable field values and supporting documents
travel directly from a secured patient-form client to an authenticated
clinical backend. They must not be interpolated into model prompts, chat
messages, general-agent memory, tool logs or connector telemetry.

## Safe configurable form contract

Every clinic has a versioned schema:
- Stable field ID, localized label, kind, required/optional, display order.
- Optional choices, validation, normalizer, visibility conditions and role.
- Core identity fields have protected system semantics and cannot be removed
  merely by deleting a visual widget.
- Custom fields may be archived from new visits without deleting old values.
- Form changes keep revision and author in an audit trail. A displayed draft
  holds its revision and resolves collisions before submitting.
- Kira's "add/remove/change a field" command produces a **proposed schema
  diff**. Show an exact preview and obtain approval to publish it.
- Field values carry provenance: supplied by patient, entered by physician,
  authenticated external provider, imported system or verified staff.
- No arbitrary JS, network URLs or executable AI-generated code may run
  inside clinical forms. Advanced functions use signed, narrow capability
  manifests with versioned schema and declarative output mapping.

Suggested function categories:
1. Local: format phone, convert units, calculate age from confirmed DOB,
   enforce allowed choices, normalize name for matching.
2. Connector: verify official identity, fetch authorized insurance metadata,
   verify an email/phone, resolve a licensed third-party medical record.
3. Clinical: prepare a draft, suggest relevant questions, flag missing data.
   Physician review remains mandatory for clinical conclusions and signing.

## Identity and duplicate resolution

Maintain immutable Patient ID distinct from every contact or document.
Do not treat a telephone number, email address, name, or document number
as a primary key. Phone/email can be shared, changed, reassigned or revoked.

Detection priorities:
- Exact same document type and normalized number: strong duplicate signal,
  not a substitute for official identity authentication.
- Normalized full name plus date of birth: probable match, review required.
- A phone/email with date of birth: weak probable match, review required.
- Phone/email alone: never merge or permanently link patients.
- If confidence is uncertain: queue "possible duplicate" and offer the
  clinician a safe decision. Do not silently merge longitudinal histories.
- Never reveal unassigned patient demographics to an unauthorized clinician.
- Index document/contact hashes using a keyed HMAC, per tenant, when
  scaling beyond the initial encrypted local-record scan. Preserve exact
  records in encrypted storage, not in logs or public identifiers.
- Do not trust a cédula alone as login authentication.

## Dominican Republic identity verification

The JCE, not MINERD, is the official authority for cédula identity verification.
JCE regulations describe formal request, approval, and a service agreement
for institutional lookup access:
https://jce.gob.do/portaltransparencia/Base-Legal-Instituci%C3%B3n

Do not assume a public website that responds to a cédula is an authorized,
free or stable API. Without an approved service contract, provide format
validation and human review only; never claim "identity verified by JCE".

Clinical records in the Dominican Republic require confidentiality,
purpose limitation, role restriction, audit and an appropriate legal basis.
See the current Ley 172-13:
https://www.msp.gob.do/web/Transparencia/documentos_oai/28/leyes/19505/ley-172-13.pdf

## Patient communication and login

Contacts and communication permissions are separate data models:
- ContactPoint: channel (phone/email/WhatsApp), normalized value, verifiedAt,
  owner, preferred channel, effective/revoked state and timestamps.
- CommunicationConsent: permitted purpose, channel, language, captured by,
  evidence reference, date, expiry/revocation and responsible practitioner.
- OutboundMessage: approved template, recipient proof, encounter/case scope,
  estimated and actual cost, scheduledBy, authorizedBy and delivery state.

An appointment reminder must not reveal diagnosis or private clinical details.
Patient portal login should support passkeys or strong credential + second
factor for sensitive records; short-lived one-time appointment access links
can be paired with an appropriate identity verification step. Add rate limits,
replay protection, device/session management and audit logs.
Never use the national ID as a password or publish medical record URLs
containing a plain identity number.

Video appointments, results and billing use the same patient identity and
explicit consent state. Any paid SMS/WhatsApp/verification service must have
a transparent monthly cost view and an approved per-clinic budget cap.

## PHOENIX integration design

PHOENIX generic harness:
- conversation renderer and tool/card adapter
- role-aware, typed action dispatcher
- auth vault and connector discovery
- audit/event bus and human approval
- app/vertical capability registry

HealthIA-specific engine:
- patient master, identity links and duplicate-resolution queue
- protected patient form compiler + schema registry
- medical record and encounter lifecycle
- consent, contact and communication orchestration
- clinical copilot, orders, imaging, prescriptions, follow-ups, billing
- optional integration ports for JCE, FHIR/HL7 and authorized EHR platforms

Kira can discover and propose connector manifests. Read access to an
existing EHR is separate from write access; only authenticated and scoped
capabilities can execute. Network discovery must be opt-in and must not
scan unrelated devices or expose patient data without authorization.

## Work performed in first slice

The initial protected /health implementation includes:
- a customizable, versioned per-clinic intake template;
- validated custom fields persisted in encrypted patient records;
- optional document capture with format validation (not JCE verification);
- server-side organization-scoped duplicate checks and an explicit review
  route for probable distinct identities;
- a local authenticated patient-match endpoint and template endpoint;
- clinical role checks, CSRF boundary and audit entries;
- reusable forms for in-office registration with a private medical record.

The secure native in-chat editor, LLM-to-EHR consented bridge, third-party
identity integrations, digital patient login, outbound communications,
same-phone multi-person reconciliation and cross-system FHIR connectors
are **not implemented by this slice**. They are separate deliverables.

## Next delivery

1. A protected first-party chat card communicating with the same /health
   authenticated clinical service without passing PHI into prompts.
2. Deterministic schema diff proposals from Kira; explicit clinician approve,
   publish, test and rollback actions.
3. A dedicated identity-resolution queue plus blind-indexed lookup that
   scales and supports multiple organizations and external registries.
4. Consent-driven patient contact management, verified messaging and
   patient portal credentials with no unavoidable per-message charges.
5. Connected medical-system adapters with FHIR/HL7 mapping, provenance,
   authorization, and reconciliation workflows.
