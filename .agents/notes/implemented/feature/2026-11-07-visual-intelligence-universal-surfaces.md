# Agent Note: Universal visual intelligence surfaces

Status: implemented

## Problem

PHOENIX had separate generic canvases, spreadsheet widgets, clinical forms and maps, but no unified bounded contract for deciding between views, exploring larger datasets, editable drafts, multimedia, cited evidence, authenticated same-origin live metrics or safe local sharing. A static result often forced the user to ask the model again for a basic search, sort or visualization change.

## Decision

Introduce `visual_intelligence` as a separately validated `generative-ui` block, with inspectable intent resolution for tables, comparisons, charts, galleries/Bento, dashboards, document editors, clinical smart forms and maps. Preserve the existing `ui_canvas`, clinical calculation engine, real map renderer, and sports surfaces. Local table operations, chart exploration, document revisions, and CSV/Excel-XML/JSON/print-to-PDF exports require no model roundtrip.

Source links are displayed as **declared evidence**, not silently promoted to verified truth. Only approved HTTPS image origins can render; other HTTPS links open only following a user click. Spreadsheet exports neutralize formula injection. UI actions travel through the existing user-action callback; no generated JavaScript, arbitrary tool execution or fake success receipts are accepted. Remote live panels accept same-origin `/api/...` routes and show a connected state only after an actual response. Routes query public OSRM only following an explicit user click, transmitting the two selected coordinates.

An optional encrypted local library uses PBKDF2 plus AES-GCM with a passphrase supplied at use time and supports explicit encrypted export/import for manual transfer between devices. No passphrase or plaintext response is stored. **This is not automatic multi-device cloud sync**: a properly authenticated service with ownership/roles and audit records is still necessary for secure institutional deployment. Print-to-PDF is the browser print flow; Excel is SpreadsheetML XML, not a forged XLSX package.

## Alternatives considered

**Let the model output executable HTML, SVG script, URLs or callbacks.** Rejected: it permits injection, private requests and unapproved actions.

**Make UI views call the model for every filter, sort, zoom or navigation.** Rejected: deterministic interactive state is faster, cheaper and auditable in the client.

**Use browser localStorage as a patient-record backend or claim cloud sync from a file import.** Rejected: sensitive information requires encrypted storage, explicit authorization and authenticated host services.

**Make map routing and live sports appear available by default.** Rejected: those must be conditioned on a verifiable response from a real provider.

## Consequences

PHOENIX can render composable, context-selected interactive surfaces in the conversation. The schema has strict limits on record count, source URLs, coordinates, metric values and available actions; malformed blocks fall back to the existing explicit parser path. Changes include focused parser and rendered-behavior tests. Production use of sensitive clinical data requires host-backed access control, institutional audit and secure synchronization. Network routing, authentic live feeds, cross-browser print behavior and full app integration require separate verified checks.
